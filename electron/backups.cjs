// Backups of the user's data, kept in a Backups folder inside the data folder
// (default Documents\Appa\Backups). Updates never touch it, and nothing in
// the app deletes a backed-up collection.
//
// A snapshot is taken before a new version of the app first starts (it may
// change how data is stored), once a day, before restoring an older backup,
// and when a save would suddenly make the collection much smaller. Each is a
// folder holding:
//   collection.json  the saved collection (cards, notes, review history,
//                    decks, presets, preferences, lessons, quizzes, notes'
//                    files list): kept forever
//   background       the background image, if there is one
//   app-storage/     a raw copy of the app's own storage (its database, and
//                    local storage, where Lab notes and some settings live),
//                    taken while the app is closed. These are large, so only
//                    the newest few are kept; collection.json always stays.
// Media (images, PDFs) aren't copied: the data folder's media/ is only ever
// added to, so it already holds every file a backup refers to.

const fs = require('node:fs');
const path = require('node:path');

const DIR = 'Backups';
/** daily snapshots kept */
const DAILY = 14;
/** snapshots that keep their raw copy of the app's storage */
const RAW = 3;
/** the parts of the app's profile worth copying (the rest is caches) */
const STORAGE = ['IndexedDB', 'Local Storage'];

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}.${String(d.getSeconds()).padStart(2, '0')}`;

/** Snapshot folders, newest first: { name, dir, reason, version, time, size }. */
function list(dataDir) {
  const root = path.join(dataDir, DIR);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(root, e.name);
      let info = {};
      try {
        info = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
      } catch {
        // a folder someone made by hand
      }
      const file = path.join(dir, 'collection.json');
      return {
        name: e.name,
        reason: info.reason ?? '',
        version: info.version ?? '',
        time: info.time ?? fs.statSync(dir).mtimeMs,
        size: fs.existsSync(file) ? fs.statSync(file).size : 0,
        raw: fs.existsSync(path.join(dir, 'app-storage')),
      };
    })
    .sort((a, b) => b.time - a.time);
}

/**
 * Takes a snapshot. `raw` copies the app's own storage too, which is only
 * safe while the app's window isn't open. Returns the folder's name, or null
 * when there was nothing to back up.
 */
function snapshot(dataDir, userData, { reason, label, version, raw = false, collection = null }) {
  const source = path.join(dataDir, 'fsrs-cards-backup.json');
  const hasCollection = collection != null || fs.existsSync(source);
  const storage = raw ? STORAGE.map((s) => path.join(userData, s)).filter((s) => fs.existsSync(s)) : [];
  if (!hasCollection && !storage.length) return null;
  const name = `${stamp()} ${label}`.replace(/[<>:"/\\|?*]/g, '-');
  const dir = path.join(dataDir, DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  if (collection != null) fs.writeFileSync(path.join(dir, 'collection.json'), collection);
  else if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, 'collection.json'));
  const bg = path.join(dataDir, 'background');
  if (fs.existsSync(bg)) fs.copyFileSync(bg, path.join(dir, 'background'));
  for (const s of storage) {
    try {
      fs.cpSync(s, path.join(dir, 'app-storage', path.basename(s)), { recursive: true });
    } catch {
      // a file in use: the collection copy above is the one that matters
    }
  }
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({ reason, version, time: Date.now() }, null, 2));
  return name;
}

/** Keeps the newest daily snapshots and the newest raw storage copies;
 * never removes a collection.json from any other kind of snapshot. */
function prune(dataDir) {
  const all = list(dataDir);
  const root = path.join(dataDir, DIR);
  all
    .filter((s) => s.reason === 'daily')
    .slice(DAILY)
    .forEach((s) => fs.rmSync(path.join(root, s.name), { recursive: true, force: true }));
  all
    .filter((s) => s.raw)
    .slice(RAW)
    .forEach((s) => fs.rmSync(path.join(root, s.name, 'app-storage'), { recursive: true, force: true }));
}

/**
 * At start, before the window opens: a snapshot when this is a different
 * version of the app from the one that ran last, else one a day.
 */
function atStart(dataDir, userData, version) {
  const marker = path.join(userData, 'last-run-version.json');
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(marker, 'utf8')).version;
  } catch {
    // first run of a version with backups
  }
  const today = new Date().toDateString();
  const todays = list(dataDir).some((s) => new Date(s.time).toDateString() === today);
  try {
    if (last !== version) snapshot(dataDir, userData, { reason: 'version', label: `before v${version}${last ? ` (from v${last})` : ''}`, version, raw: true });
    else if (!todays) snapshot(dataDir, userData, { reason: 'daily', label: 'daily', version, raw: true });
    prune(dataDir);
  } catch (e) {
    console.error('Backup failed:', e);
  }
  fs.writeFileSync(marker, JSON.stringify({ version }));
}

module.exports = { atStart, list, snapshot, DIR };
