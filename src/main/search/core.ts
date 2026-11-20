// Pure search logic over a Store. No threads, no fs. Used by the worker and directly by tests.
import type { SearchMatch } from '../../shared/types'
import { CHAR_BIT, Store } from './store'

const MAX_TERMS = 12
const MAX_OCC = 8
const CHECK_EVERY = 32768
/** typo/subsequence tier only runs when strict hits are fewer than this (avoids polluting exact hits) */
const FUZZY_MIN_STRICT = 1

export interface Term {
  str: string
  bytes: Uint8Array // folded (or raw when caseSensitive)
  raw: Uint8Array // as typed
  hasUpper: boolean
  mask: number
}

export interface Query {
  terms: Term[]
  caseSensitive: boolean
  key: string
}

const enc = new TextEncoder()

function foldBytes(b: Uint8Array): Uint8Array {
  const o = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) o[i] = b[i] >= 65 && b[i] <= 90 ? b[i] + 32 : b[i]
  return o
}

/** Split on whitespace, snake/kebab separators and camelCase humps; dedupe. */
export function parseQuery(q: string, caseSensitive = false): Query {
  const raws: string[] = []
  for (const tok of q.trim().split(/\s+/)) {
    if (!tok) continue
    if (caseSensitive) {
      raws.push(tok)
      continue
    }
    const parts = tok
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_\-]+/)
      .filter(Boolean)
    if (parts.length === 0) raws.push(tok)
    else raws.push(...parts)
  }
  const seen = new Set<string>()
  const terms: Term[] = []
  for (const r of raws) {
    const rawBytes = enc.encode(r)
    const bytes = caseSensitive ? rawBytes : foldBytes(rawBytes)
    const str = Buffer.from(bytes).toString('latin1') + '|' + bytes.length
    if (seen.has(str)) continue
    seen.add(str)
    let mask = 0
    let hasUpper = false
    for (const c of rawBytes) {
      mask |= CHAR_BIT[c]
      if (c >= 65 && c <= 90) hasUpper = true
    }
    terms.push({ str: Buffer.from(bytes).toString('latin1'), bytes, raw: rawBytes, hasUpper, mask })
    if (terms.length >= MAX_TERMS) break
  }
  return { terms, caseSensitive, key: (caseSensitive ? 'C' : 'i') + terms.map((t) => t.str).join('\u0000') }
}

const isUpper = (c: number): boolean => c >= 65 && c <= 90
const isLower = (c: number): boolean => c >= 97 && c <= 122
const isDigit = (c: number): boolean => c >= 48 && c <= 57
const isAlnum = (c: number): boolean => isUpper(c) || isLower(c) || isDigit(c) || c >= 128

function find(hay: Uint8Array, start: number, end: number, t: Uint8Array): number {
  const tl = t.length
  const c0 = t[0]
  const last = end - tl
  for (let i = start; i <= last; i++) {
    if (hay[i] !== c0) continue
    let j = 1
    while (j < tl && hay[i + j] === t[j]) j++
    if (j === tl) return i
  }
  return -1
}

function popcnt(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// scratch
const rs = new Int32Array(MAX_TERMS * 64) // flat ranges [s,e,...] for the current line
let rn = 0
const starts = new Int32Array(MAX_TERMS)
const ends = new Int32Array(MAX_TERMS)
const posScratch = new Int32Array(64)

/** Score one occurrence of a term at p in line [off,end). */
function occScore(text: Uint8Array, p: number, off: number, end: number, t: Term): number {
  const tl = t.bytes.length
  let s = 10 * tl
  const cur = text[p]
  const prev = p > off ? text[p - 1] : 0
  const startB = p === off || !isAlnum(prev) || (!isUpper(prev) && isUpper(cur) && prev < 128) || (isUpper(cur) && isLower(prev))
  const e = p + tl
  const endB = e >= end || !isAlnum(text[e]) || (isUpper(text[e]) && isLower(text[e - 1]))
  if (startB) s += 30
  if (endB) s += 10
  if (startB && endB) s += 20
  if (t.hasUpper) {
    let j = 0
    while (j < tl && text[p + j] === t.raw[j]) j++
    if (j === tl) s += 5
  }
  return s
}

export interface Ctx {
  store: Store
  fileBonus: Float32Array
  q: Query
}

function fileBonusFor(ctx: Ctx, fid: number): number {
  let b = ctx.fileBonus[fid]
  if (b === b) return b
  const f = ctx.store.files[fid]
  b = 0
  for (const t of ctx.q.terms) {
    const s = t.str
    const name = f.lower.slice(f.nameStart)
    if (name.includes(s)) {
      b += 25
      if (name.startsWith(s)) b += 5
    } else if (f.lower.includes(s)) b += 8
  }
  ctx.fileBonus[fid] = b
  return b
}

function lineExtras(ctx: Ctx, li: number, total: number, n: number, ordered: boolean, span: number): number {
  const S = ctx.store
  const off = S.lineOff[li]
  const len = S.lineLen[li]
  let indent = 0
  while (indent < len && (S.text[off + indent] === 32 || S.text[off + indent] === 9)) indent++
  if (n > 1) {
    if (ordered) total += 15
    total += Math.max(0, Math.min(60, 60 - span)) * 0.5
  }
  total -= 0.1 * Math.min(len - indent, 300)
  total -= 0.5 * Math.min(indent, 40)
  total += fileBonusFor(ctx, S.lineFile[li])
  return total
}

/** Strict tier: every term is a substring. Returns -1 if not matched. Fills starts/ends. */
function scoreStrict(ctx: Ctx, li: number, ranges: boolean): number {
  const S = ctx.store
  const q = ctx.q
  const off = S.lineOff[li]
  const end = off + S.lineLen[li]
  const hay = q.caseSensitive ? S.text : S.lower
  const terms = q.terms
  let total = 0
  let ordered = true
  let minS = 1 << 30
  let maxE = -1
  let prevStart = -1
  for (let k = 0; k < terms.length; k++) {
    const t = terms[k]
    let best = -1
    let bp = -1
    let from = off
    for (let n = 0; n < MAX_OCC; n++) {
      const p = find(hay, from, end, t.bytes)
      if (p < 0) break
      const s = occScore(S.text, p, off, end, t)
      if (s > best) {
        best = s
        bp = p
      }
      from = p + 1
    }
    if (bp < 0) return -1
    total += best
    starts[k] = bp
    ends[k] = bp + t.bytes.length
    if (bp < prevStart) ordered = false
    prevStart = bp
    if (bp < minS) minS = bp
    if (ends[k] > maxE) maxE = ends[k]
  }
  if (ranges) {
    rn = 0
    for (let k = 0; k < terms.length; k++) {
      rs[rn++] = starts[k] - off
      rs[rn++] = ends[k] - off
    }
  }
  return lineExtras(ctx, li, total, terms.length, ordered, maxE - minS)
}

// ---------- fuzzy tier ----------

function eqFrom(hay: Uint8Array, a: number, t: Uint8Array, b: number, count: number): boolean {
  for (let i = 0; i < count; i++) if (hay[a + i] !== t[b + i]) return false
  return true
}

/** OSA distance <= 1 between hay[a..a+m) and t. */
function within1(hay: Uint8Array, a: number, m: number, t: Uint8Array): boolean {
  const n = t.length
  if (m - n > 1 || n - m > 1) return false
  let i = 0
  while (i < m && i < n && hay[a + i] === t[i]) i++
  if (i === m && i === n) return true
  if (m === n) {
    if (eqFrom(hay, a + i + 1, t, i + 1, n - i - 1)) return true
    return i < n - 1 && hay[a + i] === t[i + 1] && hay[a + i + 1] === t[i] && eqFrom(hay, a + i + 2, t, i + 2, n - i - 2)
  }
  if (m === n + 1) return eqFrom(hay, a + i + 1, t, i, n - i)
  return eqFrom(hay, a + i, t, i + 1, m - i)
}

/** Typo match against word segments. Returns score (>0) and sets scratch range, or -1. */
function typoMatch(S: Store, li: number, t: Term, hay: Uint8Array): number {
  const off = S.lineOff[li]
  const end = off + S.lineLen[li]
  const tl = t.bytes.length
  const text = S.text
  let i = off
  while (i < end) {
    while (i < end && !isAlnum(text[i])) i++
    if (i >= end) break
    const a = i
    i++
    while (i < end && isAlnum(text[i]) && !(isUpper(text[i]) && isLower(text[i - 1]))) i++
    const m = i - a
    if (m < tl - 1) continue
    const maxK = Math.min(m, tl + 1)
    for (let k = Math.max(1, tl - 1); k <= maxK; k++) {
      if (within1(hay, a, k, t.bytes)) {
        posScratch[0] = a
        posScratch[1] = a + k
        return 6 * tl + 30 + (k === m ? 10 : 0)
      }
    }
  }
  return -1
}

/** Word-start-anchored subsequence match within a bounded window. Fills posScratch[0..tl). */
function subseqMatch(S: Store, li: number, t: Term, hay: Uint8Array): number {
  const off = S.lineOff[li]
  const end = off + S.lineLen[li]
  const tb = t.bytes
  const tl = tb.length
  if (tl > 60) return -1
  const text = S.text
  const maxSpan = tl * 2 + 3
  for (let a = off; a < end; a++) {
    if (hay[a] !== tb[0]) continue
    const prev = a > off ? text[a - 1] : 0
    if (a !== off && isAlnum(prev) && !(isUpper(text[a]) && isLower(prev))) continue
    posScratch[0] = a
    let k = 1
    let p = a + 1
    const lim = Math.min(end, a + maxSpan)
    while (k < tl && p < lim) {
      if (hay[p] === tb[k]) posScratch[k++] = p
      p++
    }
    if (k === tl) {
      let s = 4 * tl + 8
      for (let j = 1; j < tl; j++) {
        const c = posScratch[j]
        if (c === posScratch[j - 1] + 1) s += 3
        else if (!isAlnum(text[c - 1]) || (isUpper(text[c]) && isLower(text[c - 1]))) s += 6
      }
      return s
    }
  }
  return -1
}

/** Fuzzy tier: each term strict, typo (len>=4) or subsequence (len>=3). At least one non-strict. */
function scoreFuzzy(ctx: Ctx, li: number, ranges: boolean): number {
  if (ctx.q.caseSensitive) return -1 // match-case means exact: no typo/subsequence tolerance
  const S = ctx.store
  const q = ctx.q
  const off = S.lineOff[li]
  const end = off + S.lineLen[li]
  const hay = q.caseSensitive ? S.text : S.lower
  let total = 0
  let nonStrict = 0
  let minS = 1 << 30
  let maxE = -1
  rn = 0
  for (const t of q.terms) {
    const tl = t.bytes.length
    const p = find(hay, off, end, t.bytes)
    let s: number
    let ps: number
    let pe: number
    let extra: [number, number][] | null = null
    if (p >= 0) {
      s = occScore(S.text, p, off, end, t)
      ps = p
      pe = p + tl
    } else {
      nonStrict++
      s = tl >= 4 ? typoMatch(S, li, t, hay) : -1
      if (s > 0) {
        ps = posScratch[0]
        pe = posScratch[1]
      } else {
        s = tl >= 3 ? subseqMatch(S, li, t, hay) : -1
        if (s < 0) return -1
        ps = posScratch[0]
        pe = posScratch[tl - 1] + 1
        if (ranges) {
          extra = []
          for (let j = 0; j < tl; j++) extra.push([posScratch[j], posScratch[j] + 1])
        }
      }
      s *= 0.8
    }
    total += s
    if (ps < minS) minS = ps
    if (pe > maxE) maxE = pe
    if (ranges) {
      if (extra) for (const [a, b] of extra) { rs[rn++] = a - off; rs[rn++] = b - off }
      else {
        rs[rn++] = ps - off
        rs[rn++] = pe - off
      }
    }
  }
  if (nonStrict === 0) return -1
  return lineExtras(ctx, li, total, q.terms.length, true, maxE - minS) * 0.5
}

// ---------- top-k heap ----------

class TopK {
  ids: Int32Array
  sc: Float64Array
  size = 0
  constructor(
    private k: number,
    private S: Store
  ) {
    this.ids = new Int32Array(k)
    this.sc = new Float64Array(k)
  }
  /** is (ia,sa) better than (ib,sb) */
  better(ia: number, sa: number, ib: number, sb: number): boolean {
    if (sa !== sb) return sa > sb
    const S = this.S
    const pa = S.files[S.lineFile[ia]].path.length
    const pb = S.files[S.lineFile[ib]].path.length
    if (pa !== pb) return pa < pb
    if (S.lineFile[ia] !== S.lineFile[ib]) return S.lineFile[ia] < S.lineFile[ib]
    return S.lineNo[ia] < S.lineNo[ib]
  }
  push(id: number, s: number): void {
    if (this.size < this.k) {
      let i = this.size++
      this.ids[i] = id
      this.sc[i] = s
      while (i > 0) {
        const p = (i - 1) >> 1
        if (!this.better(this.ids[p], this.sc[p], this.ids[i], this.sc[i])) break
        this.swap(i, p)
        i = p
      }
    } else if (this.better(id, s, this.ids[0], this.sc[0])) {
      this.ids[0] = id
      this.sc[0] = s
      this.down(0)
    }
  }
  private swap(a: number, b: number): void {
    const i = this.ids[a]
    const s = this.sc[a]
    this.ids[a] = this.ids[b]
    this.sc[a] = this.sc[b]
    this.ids[b] = i
    this.sc[b] = s
  }
  private down(i: number): void {
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let w = i
      if (l < this.size && this.better(this.ids[w], this.sc[w], this.ids[l], this.sc[l])) w = l
      if (r < this.size && this.better(this.ids[w], this.sc[w], this.ids[r], this.sc[r])) w = r
      if (w === i) return
      this.swap(i, w)
      i = w
    }
  }
  /** best-first */
  sorted(): { id: number; s: number }[] {
    const out: { id: number; s: number }[] = []
    for (let i = 0; i < this.size; i++) out.push({ id: this.ids[i], s: this.sc[i] })
    out.sort((a, b) => (this.better(a.id, a.s, b.id, b.s) ? -1 : 1))
    return out
  }
}

// ---------- searcher with incremental cache ----------

interface CacheEntry {
  q: Query
  version: number
  cand: Int32Array
}

export interface SearchOutcome {
  cancelled: boolean
  matches: SearchMatch[]
  truncated: boolean
  /** strict-tier match count */
  strictCount: number
  incremental: boolean
}

export class Searcher {
  private cache: CacheEntry[] = []
  /** benchmarks set this false to measure cold (non-incremental) latency */
  cacheEnabled = true
  constructor(public store: Store) {}

  private findBase(q: Query): CacheEntry | null {
    let best: CacheEntry | null = null
    for (const e of this.cache) {
      if (e.version !== this.store.version || e.q.caseSensitive !== q.caseSensitive) continue
      let ok = true
      for (const c of e.q.terms) {
        if (!q.terms.some((n) => n.str.includes(c.str))) {
          ok = false
          break
        }
      }
      if (ok && (!best || e.cand.length < best.cand.length)) best = e
    }
    return best
  }

  search(query: string, caseSensitive: boolean, maxResults: number, isCancelled: () => boolean = () => false): SearchOutcome {
    const S = this.store
    const q = parseQuery(query, caseSensitive)
    const empty: SearchOutcome = { cancelled: false, matches: [], truncated: false, strictCount: 0, incremental: false }
    if (q.terms.length === 0) return empty
    const K = Math.max(1, Math.min(maxResults, 5000))
    const fileBonus = new Float32Array(S.files.length).fill(NaN)
    const ctx: Ctx = { store: S, fileBonus, q }
    let qmask = 0
    for (const t of q.terms) qmask |= t.mask

    const heap = new TopK(K, S)
    let cand = new Int32Array(1024)
    let nc = 0
    const base = this.cacheEnabled ? this.findBase(q) : null
    const n = base ? base.cand.length : S.nLines
    const src = base?.cand
    const mask = S.mask
    const alive = S.alive
    for (let ii = 0; ii < n; ii++) {
      if ((ii & (CHECK_EVERY - 1)) === 0 && isCancelled()) return { ...empty, cancelled: true }
      const li = src ? src[ii] : ii
      if (alive[li] === 0 || (mask[li] & qmask) !== qmask) continue
      const s = scoreStrict(ctx, li, false)
      if (s < 0) continue
      if (nc === cand.length) {
        const c2 = new Int32Array(cand.length * 2)
        c2.set(cand)
        cand = c2
      }
      cand[nc++] = li
      heap.push(li, s)
    }
    cand = cand.slice(0, nc)
    if (this.cacheEnabled) {
      this.cache.unshift({ q, version: S.version, cand })
      if (this.cache.length > 8) this.cache.pop()
    }

    const strict = heap.sorted()
    const strictCount = nc
    const items: { id: number; s: number; fuzzy: boolean }[] = strict.map((x) => ({ ...x, fuzzy: false }))

    if (strictCount < FUZZY_MIN_STRICT && q.terms.some((t) => t.bytes.length >= 3)) {
      const heap2 = new TopK(K, S)
      const tmasks = q.terms.map((t) => ({ m: t.mask, slack: t.bytes.length >= 4 ? 1 : 0 }))
      let found = 0
      const hay = q.caseSensitive ? S.text : S.lower
      const halves = q.terms.map((t) => {
        const h = t.bytes.length >> 1
        return { l: t.bytes.subarray(0, h), r: t.bytes.subarray(h) }
      })
      for (let li = 0; li < S.nLines; li++) {
        if ((li & (CHECK_EVERY - 1)) === 0 && isCancelled()) return { ...empty, cancelled: true }
        if (alive[li] === 0) continue
        const m = mask[li]
        let ok = true
        const off = S.lineOff[li]
        const end = off + S.lineLen[li]
        for (let k = 0; k < tmasks.length; k++) {
          const tm = tmasks[k]
          const miss = popcnt(tm.m & ~m)
          if (miss > tm.slack) {
            ok = false
            break
          }
          // one char missing => only a 1-edit typo can match; pigeonhole: one half of the term is intact
          if (miss === 1 && find(hay, off, end, halves[k].l) < 0 && find(hay, off, end, halves[k].r) < 0) {
            ok = false
            break
          }
        }
        if (!ok) continue
        const s = scoreFuzzy(ctx, li, false)
        if (s < 0) continue
        found++
        heap2.push(li, s)
      }
      void found
      const floor = strict.length ? strict[strict.length - 1].s - 1 : Infinity
      for (const x of heap2.sorted()) {
        if (items.length >= K) break
        items.push({ id: x.id, s: Math.min(x.s, floor), fuzzy: true })
      }
    }

    const matches: SearchMatch[] = items.slice(0, K).map((it) => this.materialize(ctx, it.id, it.s, it.fuzzy))
    return {
      cancelled: false,
      matches,
      truncated: strictCount > K || items.length > K,
      strictCount,
      incremental: !!base
    }
  }

  private materialize(ctx: Ctx, li: number, score: number, fuzzy: boolean): SearchMatch {
    const S = this.store
    const off = S.lineOff[li]
    const len = S.lineLen[li]
    if (fuzzy) scoreFuzzy(ctx, li, true)
    else scoreStrict(ctx, li, true)
    const buf = Buffer.from(S.text.buffer, S.text.byteOffset + off, len)
    const text = buf.toString('utf8')
    let ascii = true
    for (let i = 0; i < len; i++) {
      if (buf[i] > 127) {
        ascii = false
        break
      }
    }
    const raw: [number, number][] = []
    for (let i = 0; i < rn; i += 2) raw.push([rs[i], rs[i + 1]])
    raw.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const merged: [number, number][] = []
    for (const r of raw) {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else merged.push([r[0], r[1]])
    }
    const conv = ascii ? (x: number): number => x : (x: number): number => buf.toString('utf8', 0, x).length
    const matchRanges = merged.map(([a, b]) => [conv(a), conv(b)] as [number, number])
    return { file: S.files[S.lineFile[li]].path, line: S.lineNo[li], text, matchRanges, score: Math.round(score * 100) / 100 }
  }
}
