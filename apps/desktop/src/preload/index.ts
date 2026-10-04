import { contextBridge, ipcRenderer } from 'electron';
import {
  VOICE_CHANNELS,
  REASONING_CHANNELS,
  CONTEXT_CHANNELS,
  STATUS_CHANNEL,
  SENSOR_CHANNELS,
  STORAGE_CHANNELS,
  BASELINE_CHANNEL,
  TIMELINE_CHANNEL,
  ACTIVITY_CHANNEL,
  type DesktopBridge,
} from '@trueiris/shared';
import {
  voiceOptionsSchema,
  voiceAudioSchema,
  voiceEventSchema,
  voiceSnapshotSchema,
  askQuerySchema,
  agentResultSchema,
  contextSnapshotSchema,
  contextOptionsSchema,
  desktopStatusSchema,
  sensorSnapshotSchema,
  sensorStartSchema,
  storageStatusSchema,
  exportResultSchema,
  deleteResultSchema,
  activitySchema,
  baselineQuerySchema,
  baselineResultSchema,
  timelineQuerySchema,
  timelineResultSchema,
} from '@trueiris/schemas';

const bridge: DesktopBridge = {
  getVoice: async () =>
    voiceSnapshotSchema.parse(await ipcRenderer.invoke(VOICE_CHANNELS.get)),
  startVoice: async (options) =>
    voiceSnapshotSchema.parse(
      await ipcRenderer.invoke(
        VOICE_CHANNELS.start,
        voiceOptionsSchema.parse(options),
      ),
    ),
  stopVoice: async () => {
    await ipcRenderer.invoke(VOICE_CHANNELS.stop);
  },
  sendVoiceAudio: async (chunk) => {
    const accepted: unknown = await ipcRenderer.invoke(
      VOICE_CHANNELS.audio,
      voiceAudioSchema.parse(chunk),
    );
    return accepted === true;
  },
  finishVoice: async (id) => {
    if (typeof id !== 'string') throw new Error('Invalid voice session');
    await ipcRenderer.invoke(VOICE_CHANNELS.finish, id);
  },
  onVoice: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = voiceEventSchema.safeParse(input);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(VOICE_CHANNELS.update, receive);
    return () => {
      ipcRenderer.removeListener(VOICE_CHANNELS.update, receive);
    };
  },
  askIris: async (query) =>
    agentResultSchema.parse(
      await ipcRenderer.invoke(
        REASONING_CHANNELS.ask,
        askQuerySchema.parse(query),
      ),
    ),
  cancelIris: async () => {
    await ipcRenderer.invoke(REASONING_CHANNELS.cancel);
  },
  getStatus: async () =>
    desktopStatusSchema.parse(await ipcRenderer.invoke(STATUS_CHANNEL)),
  getStorage: async () =>
    storageStatusSchema.parse(await ipcRenderer.invoke(STORAGE_CHANNELS.get)),
  setStorageEnabled: async (enabled) => {
    if (typeof enabled !== 'boolean')
      throw new Error('Invalid storage request');
    return storageStatusSchema.parse(
      await ipcRenderer.invoke(STORAGE_CHANNELS.enable, enabled),
    );
  },
  exportData: async () =>
    exportResultSchema.parse(await ipcRenderer.invoke(STORAGE_CHANNELS.export)),
  deleteData: async () =>
    deleteResultSchema.parse(await ipcRenderer.invoke(STORAGE_CHANNELS.delete)),
  getBaselines: async (query) =>
    baselineResultSchema.parse(
      await ipcRenderer.invoke(
        BASELINE_CHANNEL,
        baselineQuerySchema.parse(query),
      ),
    ),
  getTimeline: async (query) =>
    timelineResultSchema.parse(
      await ipcRenderer.invoke(
        TIMELINE_CHANNEL,
        timelineQuerySchema.parse(query),
      ),
    ),
  setActivity: async (activity) =>
    activitySchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          ACTIVITY_CHANNEL,
          activitySchema.nullable().parse(activity),
        ),
      ),
  getContext: async () =>
    contextSnapshotSchema.parse(await ipcRenderer.invoke(CONTEXT_CHANNELS.get)),
  startContext: async () =>
    contextSnapshotSchema.parse(
      await ipcRenderer.invoke(CONTEXT_CHANNELS.start),
    ),
  stopContext: async () =>
    contextSnapshotSchema.parse(
      await ipcRenderer.invoke(CONTEXT_CHANNELS.stop),
    ),
  setContextOptions: async (options) =>
    contextSnapshotSchema.parse(
      await ipcRenderer.invoke(
        CONTEXT_CHANNELS.options,
        contextOptionsSchema.parse(options),
      ),
    ),
  onContext: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const result = contextSnapshotSchema.safeParse(input);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(CONTEXT_CHANNELS.update, handler);
    return () => {
      ipcRenderer.removeListener(CONTEXT_CHANNELS.update, handler);
    };
  },
  exportContext: async () =>
    exportResultSchema.parse(
      await ipcRenderer.invoke(STORAGE_CHANNELS.exportContext),
    ),
  getSensor: async () =>
    sensorSnapshotSchema.parse(await ipcRenderer.invoke(SENSOR_CHANNELS.get)),
  startSensor: async (provider) =>
    sensorSnapshotSchema.parse(
      await ipcRenderer.invoke(
        SENSOR_CHANNELS.start,
        sensorStartSchema.parse({ provider }),
      ),
    ),
  stopSensor: async () =>
    sensorSnapshotSchema.parse(await ipcRenderer.invoke(SENSOR_CHANNELS.stop)),
  onSensor: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const result = sensorSnapshotSchema.safeParse(input);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(SENSOR_CHANNELS.update, handler);
    return () => {
      ipcRenderer.removeListener(SENSOR_CHANNELS.update, handler);
    };
  },
};
contextBridge.exposeInMainWorld('trueiris', bridge);
