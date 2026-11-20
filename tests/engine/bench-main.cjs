// Run INSIDE the Electron main process:  electron tests/engine/bench-main.cjs <corpusDir> [nocache]
// Measures engine.search() round-trip (main -> worker -> main, incl. postMessage + structured clone).
const { app } = require('electron')
const path = require('node:path')
process.env.FUGLY_SEARCH_WORKER = path.resolve(__dirname, '../../out/main/search-worker.js')
const dir = process.argv[2]
if (process.argv[3] === 'nocache') process.env.FUGLY_SEARCH_NO_CACHE = '1'
const engine = require('./.build/engine.cjs')

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)]
let id = 0
const run = (query, max = 200) => engine.search({ id: ++id, query, maxResults: max })

app.whenReady().then(async () => {
  const out = { electron: process.versions.electron, node: process.versions.node, nocache: !!process.env.FUGLY_SEARCH_NO_CACHE }
  const t0 = performance.now()
  let ready
  const rp = new Promise((r) => (ready = r))
  let last
  await engine.openWorkspace(dir, (s) => { last = s; if (s.state === 'ready') ready() })
  await rp
  out.indexMs = Math.round(performance.now() - t0)
  out.files = last.files; out.lines = last.lines
  out.rssMB = Math.round(process.memoryUsage().rss / 1048576)
  const queries = ['value', 'authtoken', 'xzzzz', 'auth token', 'auth token refresh', 'const return', 'ser con res', 'au', 'refrsh tokn', 'AuthToken refreshToken']
  out.queries = {}
  for (const q of queries) {
    await run(q) // warm JIT
    const t = []
    let res
    for (let i = 0; i < 9; i++) { res = await run(q); t.push(res.tookMs) }
    out.queries[q] = { medMs: +med(t).toFixed(1), p95Ms: +p95(t).toFixed(1), top: res.matches.length, truncated: res.truncated }
  }
  // typing sequence "auth token ref" char by char, as the UI would
  const typed = 'auth token refresh'
  const seq = []
  for (let r = 0; r < 5; r++) {
    const row = []
    for (let i = 1; i <= typed.length; i++) row.push((await run(typed.slice(0, i))).tookMs)
    seq.push(row)
  }
  out.typingPerKeystrokeMs = typed.split('').map((_, i) => +med(seq.map((r) => r[i])).toFixed(1))
  // burst: 20 keystrokes fired without awaiting (stale ones must be cancelled)
  const tb = performance.now()
  const ps = []
  for (let i = 1; i <= typed.length; i++) ps.push(run(typed.slice(0, i)))
  const rs = await Promise.all(ps)
  out.burstTotalMs = +(performance.now() - tb).toFixed(1)
  out.burstEmptyCancelled = rs.slice(0, -1).filter((r) => r.matches.length === 0).length
  out.burstLastMatches = rs[rs.length - 1].matches.length
  out.rssAfterMB = Math.round(process.memoryUsage().rss / 1048576)
  console.log('RESULT ' + JSON.stringify(out, null, 1))
  await engine.dispose()
  app.exit(0)
})
