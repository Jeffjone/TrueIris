import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  systemPreferences,
  utilityProcess,
  type IpcMainInvokeEvent,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STATUS_CHANNEL, SENSOR_CHANNELS } from '@trueiris/shared';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { createLogger } from '@trueiris/shared/logging';
import { getDesktopStatus } from './status';
import { sensorStartSchema, type SensorSnapshot } from '@trueiris/schemas';
import { SensorController, SensorStartError } from './sensor/controller';
import { MockSensorProvider } from './sensor/mock';
import { PresageSensorProvider } from './sensor/presage';

if (!app.isPackaged) loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
const logger = createLogger('trueiris-desktop', env.LOG_LEVEL);
const directory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let sensor: SensorController;
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
    void sensor.stop();
  });
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) void sensor.stop();
  });
  window.webContents.on('did-fail-load', (_event, code) =>
    logger.error({ event: 'renderer_load_failed', code }),
  );
  window.once('ready-to-show', () => window.show());
  window.once('closed', () => {
    mainWindow = null;
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
    sensor = new SensorController(
      env.TRUEIRIS_SENSOR_PROVIDER,
      async (kind) => {
        if (kind === 'mock')
          return new MockSensorProvider(env.TRUEIRIS_MOCK_SENSOR_SCENARIO);
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
    );
    // Native camera startup is a named user action. Renderer media remains denied.
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
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
      const result = sensorStartSchema.safeParse(input);
      if (!result.success) throw new Error('Invalid sensor start request');
      return sensor.start(result.data.provider);
    });
    ipcMain.handle(SENSOR_CHANNELS.stop, (event) => {
      assertTrusted(event);
      return sensor.stop();
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
  if (quitting || !sensor) return;
  event.preventDefault();
  quitting = true;
  void sensor.dispose().finally(() => app.quit());
});
