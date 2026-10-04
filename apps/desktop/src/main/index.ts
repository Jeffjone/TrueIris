import { setTransportMode } from './transport';
import { privateFetch as fetch } from './transport';
import { DemoClient } from './demo';
import { ExperimentClient } from './experiments';
import {
  app,
  dialog,
  BrowserWindow,
  ipcMain,
  session,
  powerMonitor,
  systemPreferences,
  utilityProcess,
  type IpcMainInvokeEvent,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEMO_CHANNELS,
  EXPERIMENT_CHANNELS,
  VOICE_CHANNELS,
  REASONING_CHANNELS,
  CONTEXT_CHANNELS,
  STATUS_CHANNEL,
  SENSOR_CHANNELS,
  STORAGE_CHANNELS,
  BASELINE_CHANNEL,
  TIMELINE_CHANNEL,
  ACTIVITY_CHANNEL,
} from '@trueiris/shared';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { createLogger } from '@trueiris/shared/logging';
import { getDesktopStatus } from './status';
import {
  voiceOptionsSchema,
  voiceAudioSchema,
  type CurrentState,
  experimentActionSchema,
  experimentIdSchema,
  reconstructionQuerySchema,
  askQuerySchema,
  contextOptionsSchema,
  activitySchema,
  baselineQuerySchema,
  timelineQuerySchema,
  type RecordedActivity,
  sensorStartSchema,
  type SensorSnapshot,
} from '@trueiris/schemas';
import { SensorController, SensorStartError } from './sensor/controller';
import {
  MeasurementQueue,
  createBatchSender,
  storageConfigured,
} from './storage/queue';
import { exportMeasurements } from './storage/files';
import { VoiceClient } from './voice';
import { ReasoningClient } from './reasoning';
import { getBaselines } from './baseline';
import { getTimeline } from './timeline';
import { ContextController } from './context/controller';
import { NativeContextProvider, MockContextProvider } from './context/provider';
import { createContextQueue } from './context/queue';
import { MockSensorProvider } from './sensor/mock';
import { PresageSensorProvider } from './sensor/presage';

if (!app.isPackaged) loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
setTransportMode(env.TRUEIRIS_DEMO_MODE);
const reasoning = new ReasoningClient(
  env.TRUEIRIS_API_URL,
  env.TRUEIRIS_INGEST_TOKEN,
);
const logger = createLogger('trueiris-desktop', env.LOG_LEVEL);
const directory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let sensor: SensorController;
let context: ContextController;
const demo = new DemoClient(
  env.TRUEIRIS_DEMO_MODE,
  env.TRUEIRIS_API_URL,
  env.TRUEIRIS_INGEST_TOKEN,
);
const experiments = new ExperimentClient(
  env.TRUEIRIS_API_URL,
  env.TRUEIRIS_INGEST_TOKEN,
);
const voice = new VoiceClient(
  env.TRUEIRIS_API_URL,
  env.TRUEIRIS_INGEST_TOKEN,
  (event) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed())
      mainWindow.webContents.send(VOICE_CHANNELS.update, event);
  },
);
function currentState(): CurrentState {
  const sensed = sensor.get(),
    desktop = context.get();
  return {
    sensor: sensed.phase,
    reading: sensed.reading,
    context: desktop.phase,
    contextSource: desktop.provider === 'mock' ? 'mock' : 'live',
    application: desktop.application?.name ?? null,
    activity,
    saving: storageStatus().enabled,
  };
}
const storage = new MeasurementQueue(
  storageConfigured(env.TRUEIRIS_API_URL, env.TRUEIRIS_INGEST_TOKEN),
  createBatchSender(env.TRUEIRIS_API_URL, env.TRUEIRIS_INGEST_TOKEN),
);
const contextStorage = createContextQueue(
  env.TRUEIRIS_API_URL,
  env.TRUEIRIS_INGEST_TOKEN,
  storageConfigured(env.TRUEIRIS_API_URL, env.TRUEIRIS_INGEST_TOKEN),
);
function storageStatus() {
  const a = storage.get(),
    b = contextStorage.get();
  const priority = { off: 0, idle: 1, saving: 2, retrying: 3, blocked: 4 };
  return {
    ...a,
    state: priority[a.state] >= priority[b.state] ? a.state : b.state,
    queued: a.queued + b.queued,
    saved: a.saved + b.saved,
    dropped: a.dropped + b.dropped,
    lastSavedAt:
      [a.lastSavedAt, b.lastSavedAt]
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null,
  };
}
async function enableSaving(enabled: boolean) {
  if (enabled && env.TRUEIRIS_DEMO_MODE) {
    const status = await getDesktopStatus(
      env.TRUEIRIS_API_URL,
      app.getVersion(),
      true,
    );
    if (!status.demo?.enabled)
      throw new Error('Start the API in demo mode before enabling demo saving');
  }
  context.setSaving(enabled);
  await Promise.all([
    storage.setEnabled(enabled),
    contextStorage.setEnabled(enabled),
  ]);
  return storageStatus();
}
function spawnContext() {
  const workerEnvironment: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'SYSTEMROOT',
    'WINDIR',
    'DISPLAY',
    'XDG_SESSION_TYPE',
    'XDG_RUNTIME_DIR',
    'WAYLAND_DISPLAY',
  ])
    if (process.env[name]) workerEnvironment[name] = process.env[name];
  const child = utilityProcess.fork(join(directory, 'context-worker.js'), [], {
    env: workerEnvironment,
    stdio: 'pipe',
    serviceName: 'TrueIris desktop context',
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
let managingData = false;
let activity: RecordedActivity | null = null;
let exportAbort: AbortController | null = null;
let exportOperation: Promise<void> | null = null;
let lastPhase: SensorSnapshot['phase'] = 'off';
function assertTrusted(event: IpcMainInvokeEvent) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  )
    throw new Error('Untrusted IPC sender');
}
function spawnSensor() {
  const workerEnvironment: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'SYSTEMROOT',
    'WINDIR',
    'DISPLAY',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
  ]) {
    if (process.env[name]) workerEnvironment[name] = process.env[name];
  }
  if (app.isPackaged) {
    const library =
      process.platform === 'darwin'
        ? 'libsmartspectra_capi.dylib'
        : process.platform === 'win32'
          ? 'smartspectra_capi.dll'
          : 'libsmartspectra_capi.so';
    workerEnvironment.SMARTSPECTRA_CAPI_PATH = join(
      process.resourcesPath,
      'smartspectra',
      library,
    );
  }
  const child = utilityProcess.fork(join(directory, 'presage-worker.js'), [], {
    env: workerEnvironment,
    stdio: 'pipe',
    serviceName: 'TrueIris camera sensor',
  });
  // Drain vendor output without logging potentially sensitive native messages.
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 680,
    minHeight: 560,
    title: 'TrueIris',
    backgroundColor: '#f5f5f0',
    show: false,
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error({ event: 'renderer_stopped', reason: details.reason });
    voice.stop();
    reasoning.cancel();
    activity = null;
    context?.setManual(null);
    context?.stop();
    void sensor.stop();
  });
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      voice.stop();
      reasoning.cancel();
      activity = null;
      context?.setManual(null);
      context?.stop();
      void sensor.stop();
    }
  });
  window.webContents.on('did-fail-load', (_event, code) =>
    logger.error({ event: 'renderer_load_failed', code }),
  );
  window.once('ready-to-show', () => window.show());
  window.once('closed', () => {
    mainWindow = null;
    voice.stop();
    reasoning.cancel();
    activity = null;
    context?.setManual(null);
    context?.stop();
    void sensor.stop();
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(directory, '../renderer/index.html'));
  }
}

void app
  .whenReady()
  .then(() => {
    context = new ContextController(
      env.TRUEIRIS_CONTEXT_PROVIDER,
      () =>
        env.TRUEIRIS_CONTEXT_PROVIDER === 'mock'
          ? new MockContextProvider()
          : new NativeContextProvider(spawnContext()),
      () =>
        env.TRUEIRIS_CONTEXT_PROVIDER === 'mock'
          ? 0
          : powerMonitor.getSystemIdleTime(),
      (snapshot) => {
        if (mainWindow && !mainWindow.webContents.isDestroyed())
          mainWindow.webContents.send(CONTEXT_CHANNELS.update, snapshot);
      },
      (interval) => contextStorage.enqueue(interval),
      () => contextStorage.get(),
    );
    powerMonitor.on('suspend', () => {
      void sensor?.stop();
      voice.stop();
      context.stop();
    });
    powerMonitor.on('lock-screen', () => {
      void sensor?.stop();
      voice.stop();
      context.stop();
    });
    ipcMain.handle(CONTEXT_CHANNELS.get, (event) => {
      assertTrusted(event);
      return context.get();
    });
    ipcMain.handle(CONTEXT_CHANNELS.start, (event) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      return context.start();
    });
    ipcMain.handle(CONTEXT_CHANNELS.stop, (event) => {
      assertTrusted(event);
      return context.stop();
    });
    ipcMain.handle(CONTEXT_CHANNELS.options, (event, input: unknown) => {
      assertTrusted(event);
      const options = contextOptionsSchema.parse(input);
      if (
        options.windowTitles &&
        !context.get().options.windowTitles &&
        env.TRUEIRIS_CONTEXT_PROVIDER === 'desktop' &&
        process.platform === 'darwin'
      )
        systemPreferences.isTrustedAccessibilityClient(true);
      context.setOptions(options);
      return context.get();
    });
    sensor = new SensorController(
      env.TRUEIRIS_SENSOR_PROVIDER,
      async (kind) => {
        if (kind === 'mock')
          return new MockSensorProvider(
            env.TRUEIRIS_DEMO_MODE
              ? 'steady'
              : env.TRUEIRIS_MOCK_SENSOR_SCENARIO,
          );
        if (!env.PRESAGE_API_KEY) throw new SensorStartError('missing_key');
        if (
          !['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64'].includes(
            `${process.platform}-${process.arch}`,
          )
        )
          throw new SensorStartError('unsupported_platform');
        if (process.platform === 'darwin') {
          const status = systemPreferences.getMediaAccessStatus('camera');
          if (status === 'denied' || status === 'restricted')
            throw new SensorStartError('permission_denied');
          if (
            status !== 'granted' &&
            !(await systemPreferences.askForMediaAccess('camera'))
          )
            throw new SensorStartError('permission_denied');
        }
        return new PresageSensorProvider(env.PRESAGE_API_KEY, spawnSensor);
      },
      (snapshot) => {
        storage.observe(snapshot, activity);
        if (snapshot.phase !== lastPhase) {
          logger.info({
            event:
              snapshot.phase === 'running'
                ? 'sensor_connected'
                : snapshot.phase === 'off'
                  ? 'sensor_disconnected'
                  : 'sensor_state_changed',
            provider: snapshot.provider,
            phase: snapshot.phase,
            issue: snapshot.issue,
          });
          lastPhase = snapshot.phase;
        }
        if (mainWindow && !mainWindow.webContents.isDestroyed())
          mainWindow.webContents.send(SENSOR_CHANNELS.update, snapshot);
      },
      env.TRUEIRIS_DEMO_MODE,
    );
    // Renderer microphone access is leased only to the trusted frame after an explicit voice start.
    // Camera, screen capture, other frames, and all other permissions remain denied.
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const media = details as Electron.MediaAccessPermissionRequest;
        callback(
          Boolean(
            mainWindow &&
            contents === mainWindow.webContents &&
            permission === 'media' &&
            voice.captureAllowed() &&
            details.isMainFrame &&
            media.mediaTypes?.length === 1 &&
            media.mediaTypes[0] === 'audio',
          ),
        );
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        Boolean(
          mainWindow &&
          contents === mainWindow.webContents &&
          permission === 'media' &&
          voice.captureAllowed() &&
          details.isMainFrame &&
          details.mediaType === 'audio',
        ),
    );
    ipcMain.handle(DEMO_CHANNELS.get, (event) => {
      assertTrusted(event);
      return demo.get();
    });
    ipcMain.handle(DEMO_CHANNELS.prepare, (event) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      return demo.get(true);
    });
    ipcMain.handle(EXPERIMENT_CHANNELS.action, (event, input: unknown) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      return experiments.action(experimentActionSchema.parse(input));
    });
    ipcMain.handle(
      EXPERIMENT_CHANNELS.export,
      async (event, input: unknown) => {
        assertTrusted(event);
        const id = experimentIdSchema.parse(input);
        if (managingData || !mainWindow) return 'failed';
        managingData = true;
        try {
          const selection = await dialog.showSaveDialog(mainWindow, {
            title: 'Export experiment',
            defaultPath: 'trueiris-experiment.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (selection.canceled || !selection.filePath) return 'cancelled';
          await enableSaving(false);
          exportAbort = new AbortController();
          exportOperation = experiments.export(
            id,
            selection.filePath,
            exportAbort.signal,
          );
          await exportOperation;
          return 'saved';
        } catch {
          return 'failed';
        } finally {
          exportAbort = null;
          exportOperation = null;
          managingData = false;
        }
      },
    );
    ipcMain.handle(VOICE_CHANNELS.get, (event) => {
      assertTrusted(event);
      return voice.get();
    });
    ipcMain.handle(VOICE_CHANNELS.start, async (event, input: unknown) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      const started = await voice.start({
        ...voiceOptionsSchema.parse(input),
        current: currentState(),
      });
      if (started.phase !== 'listening' || !started.sessionId || started.issue)
        return started;
      const fakeMicrophone =
        started.provider === 'mock' &&
        app.commandLine.hasSwitch('use-fake-device-for-media-stream');
      if (process.platform === 'darwin' && !fakeMicrophone) {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (
          status === 'denied' ||
          status === 'restricted' ||
          (status !== 'granted' &&
            !(await systemPreferences.askForMediaAccess('microphone')))
        ) {
          if (voice.get().sessionId === started.sessionId)
            voice.stop('permission_denied');
          return voice.get();
        }
      }
      voice.armCapture(started.sessionId);
      return voice.get();
    });
    ipcMain.handle(VOICE_CHANNELS.stop, (event) => {
      assertTrusted(event);
      voice.stop();
    });
    ipcMain.handle(VOICE_CHANNELS.audio, (event, input: unknown) => {
      assertTrusted(event);
      return voice.audio(voiceAudioSchema.parse(input));
    });
    ipcMain.handle(VOICE_CHANNELS.finish, (event, id: unknown) => {
      assertTrusted(event);
      if (typeof id !== 'string') throw new Error('Invalid voice session');
      voice.finish(id);
    });
    ipcMain.handle(STATUS_CHANNEL, (event) => {
      assertTrusted(event);
      return getDesktopStatus(
        env.TRUEIRIS_API_URL,
        app.getVersion(),
        env.TRUEIRIS_DEMO_MODE,
      );
    });
    ipcMain.handle(SENSOR_CHANNELS.get, (event) => {
      assertTrusted(event);
      return sensor.get();
    });
    ipcMain.handle(SENSOR_CHANNELS.start, (event, input: unknown) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      const result = sensorStartSchema.safeParse(input);
      if (!result.success) throw new Error('Invalid sensor start request');
      return sensor.start(result.data.provider);
    });
    ipcMain.handle(SENSOR_CHANNELS.stop, (event) => {
      assertTrusted(event);
      return sensor.stop();
    });
    ipcMain.handle(REASONING_CHANNELS.reconstruct, (event, input: unknown) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      const { range, timezone } = reconstructionQuerySchema.parse(input);
      voice.stop();
      return reasoning.ask({
        question: 'What happened here?',
        source: range.source,
        timezone,
        reconstructionRange: range,
        current: currentState(),
      });
    });
    ipcMain.handle(REASONING_CHANNELS.ask, (event, input: unknown) => {
      assertTrusted(event);
      if (managingData) throw new Error('Data action in progress');
      voice.stop();
      return reasoning.ask({
        ...askQuerySchema.parse(input),
        current: currentState(),
      });
    });
    ipcMain.handle(REASONING_CHANNELS.cancel, (event) => {
      assertTrusted(event);
      voice.stop();
      reasoning.cancel();
    });
    ipcMain.handle(BASELINE_CHANNEL, (event, input: unknown) => {
      assertTrusted(event);
      return getBaselines(
        env.TRUEIRIS_API_URL,
        env.TRUEIRIS_INGEST_TOKEN,
        baselineQuerySchema.parse(input),
      );
    });
    ipcMain.handle(TIMELINE_CHANNEL, (event, input: unknown) => {
      assertTrusted(event);
      return getTimeline(
        env.TRUEIRIS_API_URL,
        env.TRUEIRIS_INGEST_TOKEN,
        timelineQuerySchema.parse(input),
      );
    });
    ipcMain.handle(ACTIVITY_CHANNEL, (event, input: unknown) => {
      assertTrusted(event);
      activity = activitySchema.nullable().parse(input);
      context.setManual(activity);
      return activity;
    });
    ipcMain.handle(STORAGE_CHANNELS.get, (event) => {
      assertTrusted(event);
      return storageStatus();
    });
    ipcMain.handle(STORAGE_CHANNELS.enable, (event, enabled: unknown) => {
      assertTrusted(event);
      if (typeof enabled !== 'boolean' || managingData)
        throw new Error('Invalid storage action');
      return enableSaving(enabled);
    });
    const exportHistory = async (
      event: IpcMainInvokeEvent,
      kind: 'measurements' | 'context',
    ) => {
      assertTrusted(event);
      if (managingData || !mainWindow || !storage.get().configured)
        return 'failed';
      managingData = true;
      try {
        const selection = await dialog.showSaveDialog(mainWindow, {
          title:
            kind === 'context'
              ? 'Export desktop context'
              : 'Export measurements',
          defaultPath: `trueiris-${kind}.jsonl`,
          filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
        });
        if (selection.canceled || !selection.filePath) return 'cancelled';
        await enableSaving(false);
        exportAbort = new AbortController();
        exportOperation = exportMeasurements(
          env.TRUEIRIS_API_URL,
          env.TRUEIRIS_INGEST_TOKEN!,
          selection.filePath,
          {
            signal: exportAbort.signal,
            ...(kind === 'context' ? { kind: 'context' as const } : {}),
          },
        );
        await exportOperation;
        return 'saved';
      } catch {
        return 'failed';
      } finally {
        exportAbort = null;
        exportOperation = null;
        managingData = false;
      }
    };
    ipcMain.handle(STORAGE_CHANNELS.export, (event) =>
      exportHistory(event, 'measurements'),
    );
    ipcMain.handle(STORAGE_CHANNELS.exportContext, (event) =>
      exportHistory(event, 'context'),
    );
    ipcMain.handle(STORAGE_CHANNELS.delete, async (event) => {
      assertTrusted(event);
      if (managingData || !mainWindow || !storage.get().configured)
        return 'failed';
      managingData = true;
      try {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Delete saved history?',
          message:
            'Delete all your saved measurements, aggregates, desktop context and experiments?',
          detail:
            'This also stops sensing and saving. Deletion cannot be undone.',
          buttons: ['Cancel', 'Delete history'],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirmation.response !== 1) return 'cancelled';
        voice.stop();
        reasoning.cancel();
        await sensor.stop();
        context.stop();
        await enableSaving(false);
        const response = await fetch(new URL('/data', env.TRUEIRIS_API_URL), {
          method: 'DELETE',
          headers: { authorization: `Bearer ${env.TRUEIRIS_INGEST_TOKEN!}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        return response.status === 204 ? 'deleted' : 'failed';
      } catch {
        return 'failed';
      } finally {
        managingData = false;
      }
    });
    createWindow();
    logger.info({ event: 'desktop_started' });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch(() => {
    logger.error({ event: 'desktop_start_failed' });
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitting = false;
app.on('before-quit', (event) => {
  voice.stop();
  reasoning.cancel();
  if (quitting || !sensor) return;
  event.preventDefault();
  quitting = true;
  exportAbort?.abort();
  context?.stop();
  void sensor
    .dispose()
    .then(async () => {
      await Promise.allSettled([
        storage.dispose(),
        contextStorage.dispose(),
        exportOperation,
      ]);
    })
    .finally(() => app.quit());
});
