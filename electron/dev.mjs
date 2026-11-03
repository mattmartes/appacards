// `npm run desktop`: starts the Vite dev server, then opens the Electron
// window on it. Edits to the web code reload live, as in the browser.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5174, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5174/';
console.log(`Vite dev server at ${url}`);

const electronPath = createRequire(import.meta.url)('electron');
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
