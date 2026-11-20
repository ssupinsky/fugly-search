import { execSync } from 'node:child_process'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The worker is exercised as the real built bundle (out/main/search-worker.js); rebuild if stale.
export default function setup(): void {
  const root = resolve(__dirname, '../..')
  const out = join(root, 'out/main/search-worker.js')
  const dir = join(root, 'src/main/search')
  const newest = Math.max(...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs))
  if (!existsSync(out) || statSync(out).mtimeMs < newest) execSync('npx electron-vite build', { cwd: root, stdio: 'ignore' })
}
