// Electron main process: opens the web app in a desktop window and gives it
// file access to one data folder (default: Documents\Appa) through a
// small IPC bridge. The web code is unchanged and still runs in browsers.
// Newer versions of the web code arrive as updates (electron/updater.cjs),
// so the app doesn't need a new installer for them.

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const updater = require('./updater.cjs');
const backups = require('./backups.cjs');

const DIST = path.join(__dirname, '..', 'dist');
/** App icon: electron-builder also picks up build/icon.png for the .exe. */
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'desktop-config.json');

// Serve the built app from app://bundle/ rather than file://, so storage,
// fetch() and WebAssembly behave as they do on a normal website.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let dataDir = null;
/** where app:// serves the web app from: the built-in copy or a newer update */
let webRoot = DIST;

async function loadConfig() {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_FILE(), 'utf8'));
    if (typeof config.dataDir === 'string') dataDir = config.dataDir;
  } catch {
    // first run
  }
  if (!dataDir) {
    // Keep using the folder from before the app was renamed, if there is one.
    const legacy = path.join(app.getPath('documents'), 'FSRS Cards');
    const hasLegacy = await fs.access(path.join(legacy, 'fsrs-cards-backup.json')).then(
      () => true,
      () => false,
    );
    dataDir = hasLegacy ? legacy : path.join(app.getPath('documents'), 'Appa');
  }
  await fs.mkdir(dataDir, { recursive: true });
}

async function saveConfig() {
  await fs.writeFile(CONFIG_FILE(), JSON.stringify({ dataDir }, null, 2));
}

/** Resolves a path inside the data folder, refusing anything outside it. */
function inData(rel) {
  const full = path.resolve(dataDir, rel);
  if (full !== dataDir && !full.startsWith(dataDir + path.sep)) throw new Error('Path is outside the data folder');
  return full;
}

function registerIpc() {
  ipcMain.handle('fs:info', () => ({ dataDir }));

  ipcMain.handle('fs:read', async (_e, rel) => {
    try {
      return await fs.readFile(inData(rel));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  });

  // Write to a temporary file, then rename, so a crash never leaves a
  // half-written backup.
  ipcMain.handle('fs:write', async (_e, rel, data) => {
    const full = inData(rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp`;
    await fs.writeFile(tmp, typeof data === 'string' ? data : Buffer.from(data));
    await fs.rename(tmp, full);
  });

  ipcMain.handle('fs:list', async (_e, rel) => {
    try {
      const entries = await fs.readdir(inData(rel), { withFileTypes: true });
      return entries.filter((e) => e.isFile() && !e.name.endsWith('.tmp')).map((e) => e.name);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  });

  ipcMain.handle('fs:exists', async (_e, rel) => {
    try {
      await fs.access(inData(rel));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:remove', async (_e, rel) => {
    await fs.rm(inData(rel), { force: true });
  });

  ipcMain.handle('fs:chooseDataDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose where Appa saves your collection',
      defaultPath: dataDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    dataDir = path.resolve(result.filePaths[0]);
    await saveConfig();
    return dataDir;
  });

  ipcMain.handle('fs:openDataDir', () => shell.openPath(dataDir));

  // backups (electron/backups.cjs)
  ipcMain.handle('backups:list', () => backups.list(dataDir));
  ipcMain.handle('backups:open', async () => {
    const dir = path.join(dataDir, backups.DIR);
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });

  // updates
  ipcMain.handle('update:ready', () => updater.confirm());
  ipcMain.handle('update:version', () => ({ app: updater.servingVersion(), installer: app.getVersion() }));
  ipcMain.handle('update:restart', () => {
    app.relaunch();
    app.exit(0);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 420,
    minHeight: 500,
    title: 'Appa',
    // In the packaged app Windows uses the .exe's icon; this covers `npm run desktop`.
    ...(require('node:fs').existsSync(ICON) ? { icon: ICON } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#121211',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links to other sites open in the normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const internal = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('app://');
    if (!internal) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bundle/index.html');
}

// One window per user: a second launch focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (!DEV_URL) webRoot = updater.chooseRoot(DIST);
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url);
      const file = path.normalize(path.join(webRoot, decodeURIComponent(pathname)));
      if (!file.startsWith(webRoot)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    await loadConfig();
    // before this version of the app touches anything: a snapshot of the data
    if (!DEV_URL) backups.atStart(dataDir, app.getPath('userData'), updater.servingVersion());
    registerIpc();
    createWindow();
    if (!DEV_URL)
      updater.start((status) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:status', status);
      });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
