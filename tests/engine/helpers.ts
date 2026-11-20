import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { IndexStatus } from '../../src/shared/types'
import * as engine from '../../src/main/search/engine'

process.env.FUGLY_SEARCH_WORKER = resolve(__dirname, '../../out/main/search-worker.js')

export function tmpRepo(files: Record<string, string | Buffer>, opts: { git?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'fugly-test-'))
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  if (opts.git) execSync('git init -q && git add .gitignore 2>/dev/null; true', { cwd: root, stdio: 'ignore' })
  return root
}

export async function openAndWait(root: string, debounceMs = 30): Promise<{ statuses: IndexStatus[] }> {
  const statuses: IndexStatus[] = []
  let ready: () => void = () => {}
  const p = new Promise<void>((r) => (ready = r))
  await engine.openWorkspace(
    root,
    (s) => {
      statuses.push(s)
      if (s.state === 'ready') ready()
    },
    { debounceMs }
  )
  await p
  return { statuses }
}

let n = 0
export const q = (query: string, max = 100, cs = false) => engine.search({ id: ++n, query, maxResults: max, caseSensitive: cs })
export const files = async (query: string) => [...new Set((await q(query)).matches.map((m) => m.file))].sort()

export async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (ok(v)) return v
    if (Date.now() - t0 > ms) throw new Error('timeout waiting; last=' + JSON.stringify(v))
    await new Promise((r) => setTimeout(r, 50))
  }
}
