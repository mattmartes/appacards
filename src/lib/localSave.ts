// Keeps the collection safe on this computer:
//  - asks the browser to make its storage persistent (not cleared under
//    storage pressure), and
//  - auto-saves everything to a folder:
//      * in the desktop app (Electron), always, to its data folder, through
//        the `window.desktop` bridge;
//      * in Chrome/Edge, to a folder the user picks (File System Access API).
// The folder holds `fsrs-cards-backup.json` (decks, cards, notes, presets,
// preferences, review history), `media/` and the background image.

import { openDB } from 'idb';
import { col, type Backup } from './collection';

const BACKUP_FILE = 'fsrs-cards-backup.json';
const MEDIA_DIR = 'media';
const BACKGROUND_FILE = 'background';
const HANDLE_DB = 'fsrs-cards-local-save';
const AUTOSAVE_DELAY_MS = 2000;
/** snapshots, inside the save folder; nothing here is ever overwritten */
const BACKUPS_DIR = 'Backups';

// ------------------------------------------------------------ platform types

/** The Electron preload bridge (electron/preload.cjs). */
interface DesktopBridge {
  info(): Promise<{ dataDir: string }>;
  read(rel: string): Promise<Uint8Array | null>;
  write(rel: string, data: string | Uint8Array): Promise<void>;
  list(rel: string): Promise<string[]>;
  exists(rel: string): Promise<boolean>;
  remove(rel: string): Promise<void>;
  chooseDataDir(): Promise<string | null>;
  openDataDir(): Promise<string>;
  /** missing in installers from before backups */
  backups?: {
    list(): Promise<BackupSnapshot[]>;
    open(): Promise<string>;
  };
  /** missing in installers from before updates */
  updates?: {
    ready(): Promise<void>;
    restart(): Promise<void>;
    version(): Promise<{ app: string; installer: string }>;
    onStatus(cb: (status: UpdateStatus) => void): () => void;
  };
}

/** A snapshot in the data folder's Backups (electron/backups.cjs). */
export interface BackupSnapshot {
  name: string;
  /** 'version' (before a new version first ran), 'daily', 'before-restore', 'big-change' */
  reason: string;
  version: string;
  time: number;
  /** bytes of its collection.json; 0 when it has none */
  size: number;
}

/** What the desktop app's updater is doing. */
export interface UpdateStatus {
  state: 'downloading' | 'ready' | 'needs-installer' | 'failed';
  version?: string;
  notes?: string;
  message?: string;
}

// Minimal typings for the File System Access API (not in TS's DOM lib yet).
interface PermissionDescriptorFS {
  mode: 'read' | 'readwrite';
}
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(d: PermissionDescriptorFS): Promise<PermissionState>;
  requestPermission(d: PermissionDescriptorFS): Promise<PermissionState>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandle>;
    desktop?: DesktopBridge;
  }
}

export const isDesktop = typeof window !== 'undefined' && !!window.desktop;

// ------------------------------------------------------------ storage back ends

/** The few file operations saving needs, relative to the save folder. */
interface FolderStore {
  readText(name: string): Promise<string | null>;
  readBlob(name: string): Promise<Blob | null>;
  write(name: string, data: string | Blob): Promise<void>;
  /** files in a subfolder */
  list(dir: string): Promise<string[]>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
}

function desktopStore(d: DesktopBridge): FolderStore {
  return {
    readText: async (name) => {
      const bytes = await d.read(name);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    readBlob: async (name) => {
      const bytes = await d.read(name);
      return bytes ? new Blob([bytes as BlobPart]) : null;
    },
    write: async (name, data) => d.write(name, typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer())),
    list: (dir) => d.list(dir),
    exists: (name) => d.exists(name),
    remove: (name) => d.remove(name),
  };
}

function handleStore(root: DirHandle): FolderStore {
  const split = (name: string): [string | null, string] => {
    const i = name.lastIndexOf('/');
    return i < 0 ? [null, name] : [name.slice(0, i), name.slice(i + 1)];
  };
  // a path like Backups/<snapshot>: one folder at a time
  const dirOf = async (sub: string | null, create: boolean) => {
    let dir: FileSystemDirectoryHandle = root;
    for (const part of sub ? sub.split('/') : []) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  };
  const file = async (name: string) => {
    const [sub, base] = split(name);
    return (await dirOf(sub, false)).getFileHandle(base);
  };
  return {
    readText: async (name) => {
      try {
        return await (await (await file(name)).getFile()).text();
      } catch {
        return null;
      }
    },
    readBlob: async (name) => {
      try {
        return await (await file(name)).getFile();
      } catch {
        return null;
      }
    },
    write: async (name, data) => {
      const [sub, base] = split(name);
      const fh = await (await dirOf(sub, true)).getFileHandle(base, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    },
    list: async (dir) => {
      const out: string[] = [];
      try {
        for await (const entry of (await root.getDirectoryHandle(dir)).values()) if (entry.kind === 'file') out.push(entry.name);
      } catch {
        // missing folder
      }
      return out;
    },
    exists: async (name) => {
      try {
        await file(name);
        return true;
      } catch {
        return false;
      }
    },
    remove: async (name) => {
      const [sub, base] = split(name);
      try {
        await (await dirOf(sub, false)).removeEntry(base);
      } catch {
        // already gone
      }
    },
  };
}

// ------------------------------------------------------------ status

export type FolderState = 'unsupported' | 'none' | 'needs-permission' | 'ready';

export interface LocalSaveStatus {
  persistent: boolean | null;
  folderState: FolderState;
  /** folder name (browser) or full path (desktop) */
  folderName: string | null;
  lastSaved: number | null;
  saving: boolean;
  error: string | null;
}

let status: LocalSaveStatus = {
  persistent: null,
  folderState: isDesktop ? 'ready' : typeof window !== 'undefined' && window.showDirectoryPicker ? 'none' : 'unsupported',
  folderName: null,
  lastSaved: null,
  saving: false,
  error: null,
};
let store: FolderStore | null = null;
let handle: DirHandle | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
/** media files already in the folder, so each is written once */
const writtenMedia = new Set<string>();
const listeners = new Set<() => void>();

function set(patch: Partial<LocalSaveStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function getStatus() {
  return status;
}

export function subscribeStatus(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const handleDb = () => openDB(HANDLE_DB, 1, { upgrade: (db) => db.createObjectStore('handles') });

/** A collection nobody has used yet: no cards and no review history. */
const collectionIsEmpty = () => col.cards.size === 0 && col.revlog.length === 0;

// ------------------------------------------------------------ lifecycle

/** Called once at startup, after the collection has opened. */
export async function initLocalSave() {
  if (navigator.storage?.persist) {
    const persistent = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    set({ persistent });
  }
  if (window.desktop) {
    store = desktopStore(window.desktop);
    const { dataDir } = await window.desktop.info();
    set({ folderName: dataDir, folderState: 'ready' });
    await primeWrittenMedia();
    // A fresh install picks up the collection saved in the data folder.
    if (collectionIsEmpty() && (await store.exists(BACKUP_FILE))) await restoreFromFolder();
  } else if (status.folderState !== 'unsupported') {
    try {
      const saved = (await (await handleDb()).get('handles', 'folder')) as DirHandle | undefined;
      if (saved) {
        handle = saved;
        store = handleStore(saved);
        const perm = await saved.queryPermission({ mode: 'readwrite' });
        set({ folderName: saved.name, folderState: perm === 'granted' ? 'ready' : 'needs-permission' });
        if (perm === 'granted') await primeWrittenMedia();
      }
    } catch {
      // stored handle unusable: behave as if no folder was chosen
    }
  }
  col.subscribe(scheduleSave);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('beforeunload', () => void flush());
  if (status.folderState === 'ready') {
    dirty = true;
    void flush();
  }
}

/** Lets the user pick the save folder (must run from a click). Returns
 * 'found-backup' when the folder already holds a saved collection, so the
 * caller can ask whether to load it. */
export async function chooseFolder(): Promise<'saved' | 'found-backup' | 'cancelled'> {
  if (window.desktop) {
    const dir = await window.desktop.chooseDataDir();
    if (!dir) return 'cancelled';
    set({ folderName: dir, folderState: 'ready', error: null });
  } else {
    if (!window.showDirectoryPicker) throw new Error('This browser cannot save to folders. Use Chrome or Edge.');
    const dir = await window.showDirectoryPicker({ id: 'fsrs-cards', mode: 'readwrite' });
    handle = dir;
    store = handleStore(dir);
    await (await handleDb()).put('handles', dir, 'folder');
    set({ folderName: dir.name, folderState: 'ready', error: null });
  }
  writtenMedia.clear();
  await primeWrittenMedia();
  if (await store!.exists(BACKUP_FILE)) return 'found-backup';
  await saveNow();
  return 'saved';
}

/** Re-grants access after a browser restart (must run from a click). */
export async function reconnectFolder() {
  if (!handle) return;
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('Permission to the folder was not granted.');
  set({ folderState: 'ready', error: null });
  await primeWrittenMedia();
  await saveNow();
}

export async function forgetFolder() {
  if (isDesktop) return; // the desktop app always saves to its data folder
  handle = null;
  store = null;
  writtenMedia.clear();
  await (await handleDb()).delete('handles', 'folder');
  set({ folderState: 'none', folderName: null, lastSaved: null });
}

export async function openFolder() {
  await window.desktop?.openDataDir();
}

function scheduleSave() {
  dirty = true;
  if (status.folderState !== 'ready') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
}

async function flush() {
  if (!dirty || status.folderState !== 'ready' || status.saving) return;
  await saveNow();
}

async function primeWrittenMedia() {
  if (!store) return;
  for (const name of await store.list(MEDIA_DIR)) writtenMedia.add(name);
}

// ------------------------------------------------------------ save & restore

/** How much a saved collection holds, to notice a save that loses a lot. */
const sizeOf = (b: Pick<Backup, 'cards' | 'revlog'> & { notes?: unknown[] }) => ({
  cards: b.cards?.length ?? 0,
  revlog: b.revlog?.length ?? 0,
  notes: b.notes?.length ?? 0,
});
/** what the folder's copy held at the last save (read from it at the first) */
let savedSize: ReturnType<typeof sizeOf> | null | undefined;

const backupStamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}.${String(d.getSeconds()).padStart(2, '0')}`;

/** Copies the folder's saved collection into Backups before it's replaced. */
async function keepCopy(reason: string, label: string) {
  if (!store) return;
  const text = await store.readText(BACKUP_FILE);
  if (!text) return;
  const dir = `${BACKUPS_DIR}/${backupStamp()} ${label}`;
  await store.write(`${dir}/collection.json`, text);
  const bg = await store.readBlob(BACKGROUND_FILE);
  if (bg) await store.write(`${dir}/background`, bg);
  await store.write(`${dir}/snapshot.json`, JSON.stringify({ reason, version: __APP_VERSION__, time: Date.now() }, null, 2));
}

/** Writes everything to the folder now. A save that would drop much of what
 * the folder holds (half the cards, notes or review history) keeps the
 * previous copy in Backups first: if that's a mistake, nothing is lost. */
export async function saveNow() {
  if (!store || status.folderState !== 'ready') return;
  dirty = false;
  set({ saving: true, error: null });
  try {
    const backup = col.exportBackup();
    const now = sizeOf(backup);
    if (savedSize === undefined) {
      const text = await store.readText(BACKUP_FILE);
      try {
        savedSize = text ? sizeOf(JSON.parse(text) as Backup) : null;
      } catch {
        savedSize = null;
      }
    }
    const was = savedSize;
    const dropped = (a: number, b: number, floor: number) => a >= floor && b < a / 2;
    if (was && (dropped(was.cards, now.cards, 20) || dropped(was.notes, now.notes, 20) || dropped(was.revlog, now.revlog, 50)))
      // a copy that can't be made mustn't stop the save itself
      await keepCopy('big-change', 'before a big change').catch((e) => console.error('Backup copy failed:', e));
    await store.write(BACKUP_FILE, JSON.stringify(backup));
    savedSize = now;
    for (const name of await col.mediaNames()) {
      if (writtenMedia.has(name)) continue;
      const blob = await col.getMedia(name);
      if (!blob) continue;
      await store.write(`${MEDIA_DIR}/${name}`, blob);
      writtenMedia.add(name);
    }
    const bg = await col.backgroundBlob();
    if (bg) await store.write(BACKGROUND_FILE, bg);
    else if (await store.exists(BACKGROUND_FILE)) await store.remove(BACKGROUND_FILE);
    set({ saving: false, lastSaved: Date.now() });
  } catch (e) {
    const lost = (e as DOMException).name === 'NotAllowedError';
    dirty = true;
    set({ saving: false, error: (e as Error).message, ...(lost ? { folderState: 'needs-permission' as const } : {}) });
  }
}

/** Replaces the collection with a snapshot from Backups. What's there now
 * is kept as a snapshot first, so a restore can be undone the same way. */
export async function restoreBackup(name: string): Promise<number> {
  if (!store) throw new Error('No folder chosen.');
  const text = await store.readText(`${BACKUPS_DIR}/${name}/collection.json`);
  if (!text) throw new Error("This backup has no saved collection in it.");
  const backup = JSON.parse(text) as Backup;
  await flush();
  await keepCopy('before-restore', 'before restoring a backup');
  await col.importBackup(backup);
  // media: every file the backup refers to is still in the folder's media/
  const media = new Map<string, Blob>();
  for (const name of await store.list(MEDIA_DIR)) {
    if (await col.getMedia(name)) continue;
    const blob = await store.readBlob(`${MEDIA_DIR}/${name}`);
    if (blob) media.set(name, blob);
  }
  if (media.size) await col.putMedia(media);
  const bg = await store.readBlob(`${BACKUPS_DIR}/${name}/background`);
  if (bg) await col.setBackground(bg);
  savedSize = undefined;
  await saveNow();
  return backup.cards.length;
}

/** Replaces the collection with what's saved in the folder. */
export async function restoreFromFolder(): Promise<number> {
  if (!store) throw new Error('No folder chosen.');
  const text = await store.readText(BACKUP_FILE);
  if (!text) throw new Error('There is no saved collection in this folder yet.');
  const backup = JSON.parse(text) as Backup;
  await col.importBackup(backup);
  const media = new Map<string, Blob>();
  for (const name of await store.list(MEDIA_DIR)) {
    const blob = await store.readBlob(`${MEDIA_DIR}/${name}`);
    if (blob) media.set(name, blob);
  }
  if (media.size) await col.putMedia(media);
  const bg = await store.readBlob(BACKGROUND_FILE);
  await col.setBackground(bg);
  set({ lastSaved: Date.now() });
  return backup.cards.length;
}
