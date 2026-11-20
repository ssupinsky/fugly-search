// Main-process side of the search engine: owns the worker, forwards queries, cancels stale ones.
import { Worker } from 'node:worker_threads'
import { join, resolve } from 'node:path'
import type { IndexStatus, SearchRequest, SearchResponse } from '../../shared/types'

export type StatusListener = (s: IndexStatus) => void

interface Pending {
  req: SearchRequest
  t0: number
  resolve: (r: SearchResponse) => void
}

let worker: Worker | null = null
let root: string | null = null
let ctrl = new Int32Array(new SharedArrayBuffer(4))
let seqCounter = 0
const pending = new Map<number, Pending>()
let listener: StatusListener = () => {}

function emptyResponse(req: SearchRequest, tookMs = 0): SearchResponse {
  return { id: req.id, matches: [], totalFiles: 0, totalLines: 0, tookMs, truncated: false }
}

function workerPath(): string {
  return process.env.FUGLY_SEARCH_WORKER ?? join(__dirname, 'search-worker.js')
}

async function stopWorker(): Promise<void> {
  const w = worker
  worker = null
  if (!w) return
  for (const p of pending.values()) p.resolve(emptyResponse(p.req))
  pending.clear()
  await new Promise<void>((done) => {
    const t = setTimeout(done, 1000)
    w.once('message', (m: { type: string }) => m.type === 'disposed' && (clearTimeout(t), done()))
    w.postMessage({ type: 'dispose' })
  })
  await w.terminate()
}

export interface OpenOptions {
  debounceMs?: number
}

/** Index a workspace (replaces any previous one). Resolves once the worker has started indexing. */
export async function openWorkspace(path: string, onStatus: StatusListener, opts: OpenOptions = {}): Promise<IndexStatus> {
  await stopWorker()
  root = resolve(path)
  listener = onStatus
  ctrl = new Int32Array(new SharedArrayBuffer(4))
  const w = new Worker(workerPath(), { workerData: { ctrl: ctrl.buffer }, resourceLimits: { maxOldGenerationSizeMb: 1024 } })
  worker = w
  let first: (s: IndexStatus) => void = () => {}
  const firstStatus = new Promise<IndexStatus>((r) => (first = r))
  w.on('message', (m: { type: string; status?: IndexStatus; seq?: number; cancelled?: boolean; res?: SearchResponse }) => {
    if (worker !== w) return
    if (m.type === 'status' && m.status) {
      listener(m.status)
      first(m.status)
    } else if (m.type === 'result' && m.seq !== undefined) {
      const p = pending.get(m.seq)
      if (!p) return
      pending.delete(m.seq)
      const r = m.res!
      r.tookMs = performance.now() - p.t0 // round trip incl. postMessage both ways
      p.resolve(r)
    }
  })
  const fail = (): void => {
    if (worker !== w) return
    worker = null
    for (const p of pending.values()) p.resolve(emptyResponse(p.req))
    pending.clear()
    first({ state: 'idle', files: 0, lines: 0, root })
  }
  w.on('error', fail)
  w.on('exit', fail)
  w.postMessage({ type: 'open', root, debounceMs: opts.debounceMs })
  return firstStatus
}

export function search(req: SearchRequest): Promise<SearchResponse> {
  const w = worker
  if (!w) return Promise.resolve(emptyResponse(req))
  const seq = ++seqCounter
  Atomics.store(ctrl, 0, seq) // any older in-flight scan sees this and bails
  return new Promise((res) => {
    pending.set(seq, { req, t0: performance.now(), resolve: res })
    w.postMessage({
      type: 'search',
      seq,
      id: req.id,
      query: req.query,
      caseSensitive: !!req.caseSensitive,
      maxResults: req.maxResults
    })
  })
}

export function getRoot(): string | null {
  return root
}

export async function dispose(): Promise<void> {
  await stopWorker()
  root = null
}
