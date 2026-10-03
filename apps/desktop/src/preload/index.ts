import { contextBridge, ipcRenderer } from 'electron';
import {
  STATUS_CHANNEL,
  SENSOR_CHANNELS,
  type DesktopBridge,
} from '@trueiris/shared';
import {
  desktopStatusSchema,
  sensorSnapshotSchema,
  sensorStartSchema,
} from '@trueiris/schemas';

const bridge: DesktopBridge = {
  getStatus: async () =>
    desktopStatusSchema.parse(await ipcRenderer.invoke(STATUS_CHANNEL)),
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
