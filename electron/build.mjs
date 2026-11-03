// `npm run desktop:build`: packages the app with electron-builder, for the
// system it runs on (Windows installers on Windows, Mac apps on a Mac, such
// as GitHub's Mac machines; see .github/workflows/desktop.yml).
// It builds in a temporary folder outside the project, because cloud-synced
// folders (OneDrive, Dropbox) lock freshly unpacked files mid-build, then
// copies the finished installers into ./release.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureKeys } from './keys.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const workDir = path.join(tmpdir(), 'appa-electron-build');
const releaseDir = path.join(projectDir, 'release');
const mac = process.platform === 'darwin';

// every installer carries the key its updates are checked against
ensureKeys();

rmSync(workDir, { recursive: true, force: true });
const result = spawnSync(`npx electron-builder ${mac ? '--mac' : '--win'} "--config.directories.output=${workDir}"`, {
  cwd: projectDir,
  stdio: 'inherit',
  shell: true,
});
if (result.status !== 0) process.exit(result.status ?? 1);

mkdirSync(releaseDir, { recursive: true });
for (const name of readdirSync(workDir)) {
  if (!(mac ? /\.(dmg|zip)$/ : /\.exe$/).test(name)) continue;
  try {
    copyFileSync(path.join(workDir, name), path.join(releaseDir, name));
    console.log(`release/${name}`);
  } catch (e) {
    if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
    console.error(`Couldn't replace release/${name}: it's in use. Close Appa (or bump "version" in package.json) and build again.`);
    process.exitCode = 1;
  }
}
rmSync(workDir, { recursive: true, force: true });
