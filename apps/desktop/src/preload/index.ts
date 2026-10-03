import { contextBridge, ipcRenderer } from 'electron';
import { STATUS_CHANNEL, type DesktopBridge } from '@trueiris/shared';
import { desktopStatusSchema } from '@trueiris/schemas';

const bridge: DesktopBridge = {
  getStatus: async () =>
    desktopStatusSchema.parse(await ipcRenderer.invoke(STATUS_CHANNEL)),
};
contextBridge.exposeInMainWorld('trueiris', bridge);
