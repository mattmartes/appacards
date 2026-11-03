// Updates without a new installer. The app checks a small latest.json online;
// when it names a newer version of the web app, it downloads that bundle,
// checks its signature against the key it was built with, and unpacks it
// into its own data folder. From the next start, app:// serves the newest
// copy. The copy built into the app is always kept: if an update is broken
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
let downloaded = null;
let send = () => {};

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
  if (downloaded) send({ state: 'ready', version: downloaded });
}

async function check() {
  if (!UPDATE_URL || !fs.existsSync(KEY_FILE)) return;
  const res = await net.fetch(UPDATE_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`latest.json: ${res.status}`);
  const latest = await res.json();
  const s = readState();
  const have = s.current && compareVersions(s.current.version, builtInVersion()) > 0 ? s.current.version : builtInVersion();
  if (compareVersions(latest.version, have) <= 0 || s.bad.includes(latest.version)) return;
  if (latest.minShell && compareVersions(app.getVersion(), latest.minShell) < 0) {
    send({ state: 'needs-installer', version: latest.version });
    return;
  }
  send({ state: 'downloading', version: latest.version });
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
  downloaded = latest.version;
  send({ state: 'ready', version: latest.version, notes: latest.notes ?? '' });
}

/** Checks now and every few hours; `notify` tells the page what's happening. */
function start(notify) {
  send = notify;
  const run = () =>
    check().catch((e) => {
      console.error('Update check failed:', e?.message ?? e);
      send({ state: 'failed', message: String(e?.message ?? e) });
    });
  setTimeout(run, 5000);
  setInterval(run, EVERY);
}

module.exports = { chooseRoot, confirm, start, servingVersion: () => serving?.version ?? builtInVersion() };
