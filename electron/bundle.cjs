// Update bundles: the built web app (dist/) packed into one file, so the
// desktop app can download a newer copy of itself without a new installer.
// Shared by the app (electron/updater.cjs) and `npm run publish-update`.
//
// A bundle is gzip of: a 4-byte length, a JSON index of the files
// ({ files: [{ path, size }] }), then the files' bytes one after another.
// Each bundle is signed (Ed25519) with a private key only the publisher has;
// the app checks it against the public key it was built with.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/** Every file under `dir`, as paths relative to it with forward slashes. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Packs a folder into a bundle. */
function packBundle(dir) {
  const files = listFiles(dir);
  const bodies = files.map((f) => fs.readFileSync(path.join(dir, f)));
  const index = Buffer.from(JSON.stringify({ files: files.map((f, i) => ({ path: f, size: bodies[i].length })) }));
  const head = Buffer.alloc(4);
  head.writeUInt32BE(index.length);
  return zlib.gzipSync(Buffer.concat([head, index, ...bodies]), { level: 9 });
}

/** Unpacks a bundle into `dest` (which must not exist yet). Refuses paths
 * that would land outside it. */
function unpackBundle(bundle, dest) {
  const raw = zlib.gunzipSync(bundle);
  const len = raw.readUInt32BE(0);
  const { files } = JSON.parse(raw.subarray(4, 4 + len).toString('utf8'));
  const root = path.resolve(dest);
  let at = 4 + len;
  for (const f of files) {
    const full = path.resolve(root, f.path);
    if (!full.startsWith(root + path.sep)) throw new Error(`Bad path in update: ${f.path}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, raw.subarray(at, at + f.size));
    at += f.size;
  }
  if (at !== raw.length) throw new Error('The update is damaged.');
  if (!files.some((f) => f.path === 'index.html')) throw new Error('The update has no index.html.');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Signs a bundle with the publisher's private key (PEM). */
const sign = (bundle, privateKeyPem) => crypto.sign(null, bundle, privateKeyPem).toString('base64');

/** Whether the signature is the publisher's, for exactly these bytes. */
function verify(bundle, signature, publicKeyPem) {
  try {
    return crypto.verify(null, bundle, publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** A new key pair for signing updates, as PEM. */
function newKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Compares versions like "1.2.10": negative, zero or positive. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

module.exports = { packBundle, unpackBundle, sha256, sign, verify, newKeys, compareVersions };
