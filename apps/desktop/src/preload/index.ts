import { contextBridge, ipcRenderer } from 'electron';
import {
  CONTEXT_CHANNELS,
  STATUS_CHANNEL,
  SENSOR_CHANNELS,
  STORAGE_CHANNELS,
  TIMELINE_CHANNEL,
  ACTIVITY_CHANNEL,
  type DesktopBridge,
} from '@trueiris/shared';
import {
  contextSnapshotSchema,
  contextOptionsSchema,
  desktopStatusSchema,
  sensorSnapshotSchema,
  sensorStartSchema,
  storageStatusSchema,
  exportResultSchema,
  deleteResultSchema,
  activitySchema,
  timelineQuerySchema,
  timelineResultSchema,
} from '@trueiris/schemas';

const bridge: DesktopBridge = {
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
