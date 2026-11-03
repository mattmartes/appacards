// The key pair updates are signed with. The public half ships inside every
// installer (electron/update-key.pem); the private half stays on the
// publisher's machine (update-keys/private.pem, never committed or uploaded).
// Lose the private key and installed apps can't take updates any more: they'd
// need a new installer made with a new key.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { newKeys } = require('./bundle.cjs');

const projectDir = path.resolve(import.meta.dirname, '..');
export const PUBLIC_KEY = path.join(projectDir, 'electron', 'update-key.pem');
export const PRIVATE_KEY = path.join(projectDir, 'update-keys', 'private.pem');

/** Makes the key pair the first time; afterwards leaves it alone. */
export function ensureKeys() {
  if (existsSync(PUBLIC_KEY)) return;
  if (existsSync(PRIVATE_KEY)) throw new Error('update-keys/private.pem exists but electron/update-key.pem is missing: restore it from a backup.');
  const keys = newKeys();
  mkdirSync(path.dirname(PRIVATE_KEY), { recursive: true });
  writeFileSync(PRIVATE_KEY, keys.privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY, keys.publicKey);
  console.log('Made a new update key pair:');
  console.log('  electron/update-key.pem  (public: goes into the installers)');
  console.log('  update-keys/private.pem  (private: back it up somewhere safe, never share it)');
}

/** The private key, for signing an update. */
export function privateKey() {
  if (!existsSync(PRIVATE_KEY)) {
    throw new Error(
      existsSync(PUBLIC_KEY)
        ? "update-keys/private.pem is missing. Without it you can't sign updates for the installers already out; restore it from your backup."
        : 'No update key yet: run `npm run desktop:build` first, which makes one.',
    );
  }
  return readFileSync(PRIVATE_KEY, 'utf8');
}
