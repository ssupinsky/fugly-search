import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import * as engine from '../../src/main/search/engine'
import { openAndWait, q } from './helpers'

// Worker + postMessage path in plain Node (500k generated lines). For the Electron-main measurement see bench-main.cjs.
const dir = mkdtempSync(join(tmpdir(), 'fugly-perf-'))
afterAll(async () => {
  await engine.dispose()
  rmSync(dir, { recursive: true, force: true })
})

it('500k lines: index time and per-query round-trip latency', async () => {
  execFileSync('node', [join(__dirname, 'gen-corpus.cjs'), dir, '500000'], { stdio: 'ignore' })
  const t0 = performance.now()
  const { statuses } = await openAndWait(dir)
  const indexMs = performance.now() - t0
  expect(statuses.at(-1)).toMatchObject({ files: 2500, lines: 500000 })
  const med = async (query: string, n = 7) => {
    await q(query)
    const t: number[] = []
    for (let i = 0; i < n; i++) t.push((await q(query, 200)).tookMs)
    return t.sort((a, b) => a - b)[n >> 1]
  }
  const r: Record<string, number> = {}
  for (const query of ['value', 'auth token', 'auth token refresh', 'ser con res', 'au']) r[query] = await med(query)
  console.log('perf 500k:', { indexMs: Math.round(indexMs), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(1)])) })
  expect(indexMs).toBeLessThan(8000)
  for (const [k, v] of Object.entries(r)) expect(v, k).toBeLessThan(150)
  const top = (await q('auth token refresh')).matches[0]
  expect(top.text).toContain('auth token refresh')
})
