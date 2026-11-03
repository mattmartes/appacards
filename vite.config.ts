import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
  appaUpdates?: { url?: string }
}
// the releases page, from where the desktop app looks for latest.json
const releases = (pkg.appaUpdates?.url ?? '').replace(/\/download\/latest\.json$/, '')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // the version shown in the corner; each update carries its own
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __RELEASES_URL__: JSON.stringify(releases) },
})
