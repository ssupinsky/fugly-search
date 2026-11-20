// worker_threads entry; built as out/main/search-worker.js
import { parentPort, workerData } from 'node:worker_threads'
import type { SearchResponse } from '../../shared/types'
import { Searcher } from './core'
import { Workspace } from './indexer'

export type ToWorker =
  | { type: 'open'; root: string; debounceMs?: number }
  | { type: 'search'; seq: number; id: number | string; query: string; caseSensitive: boolean; maxResults: number }
  | { type: 'dispose' }

const ctrl = new Int32Array((workerData as { ctrl: SharedArrayBuffer }).ctrl)
let ws: Workspace | null = null
let searcher: Searcher | null = null

parentPort!.on('message', async (m: ToWorker) => {
  if (m.type === 'open') {
    ws = new Workspace(m.root, (s) => parentPort!.postMessage({ type: 'status', status: s }), m.debounceMs ?? 100)
    searcher = new Searcher(ws.store)
    if (process.env.FUGLY_SEARCH_NO_CACHE) searcher.cacheEnabled = false
    await ws.start().catch(() => {
      if (ws) ws.state = 'ready'
      parentPort!.postMessage({ type: 'status', status: ws!.status() })
    })
  } else if (m.type === 'search') {
    const t0 = performance.now()
    const stale = (): boolean => Atomics.load(ctrl, 0) !== m.seq
    let res: SearchResponse
    let cancelled = false
    if (!ws || !searcher || stale()) {
      cancelled = stale()
      res = { id: m.id, matches: [], totalFiles: 0, totalLines: 0, tookMs: 0, truncated: false }
    } else {
      const out = searcher.search(m.query, m.caseSensitive, m.maxResults, stale)
      cancelled = out.cancelled
      res = {
        id: m.id,
        matches: out.matches,
        totalFiles: ws.store.liveFiles,
        totalLines: ws.store.liveLines,
        tookMs: performance.now() - t0,
        truncated: out.truncated
      }
    }
    parentPort!.postMessage({ type: 'result', seq: m.seq, cancelled, res })
  } else if (m.type === 'dispose') {
    await ws?.dispose()
    parentPort!.postMessage({ type: 'disposed' })
  }
})
