import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STATUS_CHANNEL } from '@trueiris/shared';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '@trueiris/shared/config';
import { createLogger } from '@trueiris/shared/logging';
import { getDesktopStatus } from './status';

if (!app.isPackaged) loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
const logger = createLogger('trueiris-desktop', env.LOG_LEVEL);
const directory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;

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
  window.webContents.on('render-process-gone', (_event, details) =>
    logger.error({ event: 'renderer_stopped', reason: details.reason }),
  );
  window.webContents.on('did-fail-load', (_event, code) =>
    logger.error({ event: 'renderer_load_failed', code }),
  );
  window.once('ready-to-show', () => window.show());
  window.once('closed', () => {
    mainWindow = null;
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
    // Foundation captures no camera, microphone, screen, or desktop activity.
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle(STATUS_CHANNEL, (event) => {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      ) {
        throw new Error('Untrusted IPC sender');
      }
      return getDesktopStatus(
        env.TRUEIRIS_API_URL,
        app.getVersion(),
        env.TRUEIRIS_DEMO_MODE,
      );
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
