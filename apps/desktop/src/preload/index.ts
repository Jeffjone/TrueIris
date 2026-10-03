import { contextBridge, ipcRenderer } from 'electron';
import {
  STATUS_CHANNEL,
  SENSOR_CHANNELS,
  STORAGE_CHANNELS,
  type DesktopBridge,
} from '@trueiris/shared';
import {
  desktopStatusSchema,
  sensorSnapshotSchema,
  sensorStartSchema,
  storageStatusSchema,
  exportResultSchema,
  deleteResultSchema,
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
