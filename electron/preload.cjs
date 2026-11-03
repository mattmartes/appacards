// Exposes the data-folder bridge to the web app as `window.desktop`. Only
// these calls are available; the page has no direct Node access.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('fs:info'),
  /** Returns the file's bytes, or null if it doesn't exist. */
  read: (rel) => ipcRenderer.invoke('fs:read', rel),
  /** Writes a string or bytes. */
  write: (rel, data) => ipcRenderer.invoke('fs:write', rel, data),
  /** File names in a subfolder. */
  list: (rel) => ipcRenderer.invoke('fs:list', rel),
  exists: (rel) => ipcRenderer.invoke('fs:exists', rel),
  remove: (rel) => ipcRenderer.invoke('fs:remove', rel),
  /** Opens a folder picker; returns the new folder or null if cancelled. */
  chooseDataDir: () => ipcRenderer.invoke('fs:chooseDataDir'),
  openDataDir: () => ipcRenderer.invoke('fs:openDataDir'),
  backups: {
    /** Snapshots in the data folder's Backups, newest first. */
    list: () => ipcRenderer.invoke('backups:list'),
    open: () => ipcRenderer.invoke('backups:open'),
  },
  updates: {
    /** The page started properly: the update it's running is good. */
    ready: () => ipcRenderer.invoke('update:ready'),
    /** Restarts into a downloaded update. */
    restart: () => ipcRenderer.invoke('update:restart'),
    /** { app, installer }: the web app's version and the installer's. */
    version: () => ipcRenderer.invoke('update:version'),
    /** Looks for a newer version now; resolves to the status. */
    check: () => ipcRenderer.invoke('update:check'),
    /** Downloads the newer version found (used from the next start). */
    install: () => ipcRenderer.invoke('update:install'),
    /** What the updater is doing right now. */
    status: () => ipcRenderer.invoke('update:status'),
    /** Calls back with { state, version, ... } as updates arrive; returns a stop function. */
    onStatus: (cb) => {
      const listener = (_e, status) => cb(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
});
