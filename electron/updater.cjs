// Updates without a new installer. The app checks a small latest.json online;
// when it names a newer version of the web app, it tells the page, and only
// when the user chooses to update does it download that bundle, check its
// signature against the key it was built with, and unpack it into its own
// data folder. From the next start, app:// serves the newest copy. The copy built into the app is always kept: if an update is broken
// or never finishes starting, the app goes back to it.
//
// latest.json: { version, file, sha256, signature, minShell?, notes? }
//   file      — the bundle, relative to latest.json (or a full URL)
//   minShell  — the oldest app (installer) version this update works in

const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions, sha256, unpackBundle, verify } = require('./bundle.cjs');

const pkg = require('../package.json');
/** where latest.json is; APPA_UPDATE_URL overrides it, for testing */
const UPDATE_URL = process.env.APPA_UPDATE_URL || pkg.appaUpdates?.url || '';
const KEY_FILE = path.join(__dirname, 'update-key.pem');
/** checked this often while the app is open */
const EVERY = 6 * 60 * 60 * 1000;
/** starts of an update that never reported in before it's given up on */
const MAX_TRIES = 2;

const root = () => path.join(app.getPath('userData'), 'updates');
const stateFile = () => path.join(root(), 'state.json');

/** { current?: { version, dir, confirmed, tries }, bad: string[] } */
function readState() {
  try {
    // (a byte-order mark, if something else saved the file, isn't JSON)
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8').replace(/^﻿/, ''));
    return { bad: [], ...s };
  } catch {
    return { bad: [] };
  }
}
function writeState(s) {
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
}

/** The web app built into this installer. */
const builtInVersion = () => app.getVersion();

let serving = null;

/**
 * The folder app:// serves from this run: the newest downloaded update if
 * it's newer than the built-in copy and hasn't failed to start, else the
 * built-in one. Call once, before the window opens.
 */
function chooseRoot(builtInDir) {
  const s = readState();
  const cur = s.current;
  if (cur && compareVersions(cur.version, builtInVersion()) > 0 && fs.existsSync(path.join(cur.dir, 'index.html'))) {
    if (cur.confirmed || cur.tries < MAX_TRIES) {
      if (!cur.confirmed) cur.tries += 1;
      writeState(s);
      serving = cur;
      return cur.dir;
    }
    // it kept failing to start: back to the built-in copy, and never again
    s.bad = [...new Set([...s.bad, cur.version])];
    delete s.current;
    writeState(s);
  }
  return builtInDir;
}

/** The page has started properly: the update it came from is good. Old
 * downloads are cleared away. */
function confirm() {
  const s = readState();
  if (serving && s.current && s.current.version === serving.version && !s.current.confirmed) {
    s.current.confirmed = true;
    writeState(s);
  }
  // keep only the copy being served and any newer one waiting
  const keep = new Set([serving?.dir, s.current?.dir].filter(Boolean).map((d) => path.resolve(d)));
  const bundles = path.join(root(), 'bundles');
  for (const name of fs.existsSync(bundles) ? fs.readdirSync(bundles) : []) {
    const dir = path.resolve(bundles, name);
    if (!keep.has(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What the updater is doing, for the page: idle, checking, up-to-date,
 * available, downloading, ready (downloaded: used from the next start),
 * needs-installer, failed or off. */
let status = { state: 'idle' };
/** latest.json of a newer version found by the last check */
let available = null;
let send = () => {};
const setStatus = (s) => {
  status = s;
  send(s);
};

/** The newest version waiting in the updates folder, if it's newer than this one. */
function waiting() {
  const cur = readState().current;
  return cur && compareVersions(cur.version, builtInVersion()) > 0 && cur.version !== serving?.version ? cur : null;
}

/** Looks for a newer version. Downloads nothing: the user decides when. */
async function check() {
  if (!UPDATE_URL || !fs.existsSync(KEY_FILE)) return setStatus({ state: 'off' });
  if (status.state === 'downloading') return;
  setStatus({ state: 'checking' });
  try {
    const res = await net.fetch(UPDATE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`latest.json: ${res.status}`);
    const latest = await res.json();
    const s = readState();
    const running = serving?.version ?? builtInVersion();
    const ready = waiting();
    if (ready && compareVersions(latest.version, ready.version) <= 0) {
      return setStatus({ state: 'ready', version: ready.version, notes: ready.notes ?? '' });
    }
    if (compareVersions(latest.version, running) <= 0 || s.bad.includes(latest.version)) {
      available = null;
      return setStatus({ state: 'up-to-date', version: running });
    }
    if (latest.minShell && compareVersions(app.getVersion(), latest.minShell) < 0) {
      return setStatus({ state: 'needs-installer', version: latest.version, notes: latest.notes ?? '' });
    }
    available = latest;
    setStatus({ state: 'available', version: latest.version, notes: latest.notes ?? '' });
  } catch (e) {
    setStatus({ state: 'failed', message: String(e?.message ?? e) });
  }
}

/** Downloads the version the last check found, checks it's Appa's, and
 * unpacks it; it's used from the next start. */
async function install() {
  if (!available) await check();
  const latest = available;
  if (!latest) return status;
  setStatus({ state: 'downloading', version: latest.version });
  try {
    const fileRes = await net.fetch(new URL(latest.file, UPDATE_URL).toString());
    if (!fileRes.ok) throw new Error(`update: ${fileRes.status}`);
    const bundle = Buffer.from(await fileRes.arrayBuffer());
    if (sha256(bundle) !== latest.sha256) throw new Error('The update download is damaged.');
    if (!verify(bundle, latest.signature, fs.readFileSync(KEY_FILE, 'utf8'))) throw new Error("The update isn't signed by Appa's key.");
    const dir = path.join(root(), 'bundles', `${latest.version}-${Date.now().toString(36)}`);
    try {
      unpackBundle(bundle, dir);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    const next = readState();
    next.current = { version: latest.version, dir, confirmed: false, tries: 0, notes: latest.notes ?? '' };
    writeState(next);
    available = null;
    setStatus({ state: 'ready', version: latest.version, notes: latest.notes ?? '' });
  } catch (e) {
    setStatus({ state: 'failed', message: String(e?.message ?? e) });
  }
  return status;
}

/** Checks now and every few hours; `notify` tells the page what's happening. */
function start(notify) {
  send = notify;
  setTimeout(() => void check(), 5000);
  setInterval(() => void check(), EVERY);
}

module.exports = {
  chooseRoot,
  confirm,
  start,
  check: async () => (await check(), status),
  install,
  status: () => status,
  servingVersion: () => serving?.version ?? builtInVersion(),
};
