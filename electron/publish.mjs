// `npm run publish-update -- "What's new"`: builds the web app and packs it
// as a signed update for installed desktop apps. It writes two files to
// release/updates/: latest.json and Appa-<version>.appabundle. Upload both
// to the folder that "appaUpdates.url" in package.json points at (replacing
// the old latest.json); installed apps pick the update up within a few hours,
// or at their next start.
//
// Bump "version" in package.json first: an update must be newer than the
// last one. If an update needs a newer installer (it relies on a change in
// electron/), raise "appaUpdates.minShell" to that installer's version.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { privateKey } from './keys.mjs';

const require = createRequire(import.meta.url);
const { compareVersions, packBundle, sha256, sign } = require('./bundle.cjs');

const projectDir = path.resolve(import.meta.dirname, '..');
const outDir = path.join(projectDir, 'release', 'updates');
const pkg = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
const notes = process.argv.slice(2).join(' ').trim();

const key = privateKey();
const latestFile = path.join(outDir, 'latest.json');
if (existsSync(latestFile)) {
  const last = JSON.parse(readFileSync(latestFile, 'utf8')).version;
  if (compareVersions(pkg.version, last) <= 0) {
    console.error(`Version ${pkg.version} was already published (the last update is ${last}). Bump "version" in package.json and run this again.`);
    process.exit(1);
  }
}

const build = spawnSync('npm run build', { cwd: projectDir, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const bundle = packBundle(path.join(projectDir, 'dist'));
const file = `Appa-${pkg.version}.appabundle`;
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, file), bundle);
const latest = {
  version: pkg.version,
  file,
  sha256: sha256(bundle),
  signature: sign(bundle, key),
  ...(pkg.appaUpdates?.minShell ? { minShell: pkg.appaUpdates.minShell } : {}),
  ...(notes ? { notes } : {}),
  published: new Date().toISOString(),
};
writeFileSync(latestFile, JSON.stringify(latest, null, 2));

console.log(`\nUpdate ${pkg.version} ready (${(bundle.length / 1024 / 1024).toFixed(1)} MB):`);
console.log(`  release/updates/${file}`);
console.log('  release/updates/latest.json');
console.log(
  pkg.appaUpdates?.url
    ? `Upload both next to ${pkg.appaUpdates.url}`
    : 'Set "appaUpdates.url" in package.json to where latest.json will live, then build the installers and upload these there.',
);
