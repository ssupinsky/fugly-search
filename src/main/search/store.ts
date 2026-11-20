// Typed-array line store: append-only arenas with tombstones + compaction. No JS strings per line.

export const MAX_LINE_BYTES = 1000

export interface FileEntry {
  path: string
  lower: string
  /** index in `path` where the base name starts */
  nameStart: number
  first: number
  count: number
  alive: boolean
}

/** 0-25 letters, 26 digits, 27 any other non-space byte */
export const CHAR_BIT = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let b = 0
  if (i >= 97 && i <= 122) b = 1 << (i - 97)
  else if (i >= 65 && i <= 90) b = 1 << (i - 65)
  else if (i >= 48 && i <= 57) b = 1 << 26
  else if (i === 32 || i === 9) b = 0
  else b = 1 << 27
  CHAR_BIT[i] = b
}

export class Store {
  text = new Uint8Array(1 << 20)
  lower = new Uint8Array(1 << 20)
  used = 0
  lineOff = new Uint32Array(1 << 14)
  lineLen = new Uint16Array(1 << 14)
  lineFile = new Uint32Array(1 << 14)
  lineNo = new Uint32Array(1 << 14)
  mask = new Uint32Array(1 << 14)
  alive = new Uint8Array(1 << 14)
  nLines = 0
  liveLines = 0
  deadLines = 0
  liveFiles = 0
  files: FileEntry[] = []
  fileByPath = new Map<string, number>()
  /** bumped on every mutation; invalidates query caches */
  version = 0

  private ensure(bytes: number, lines: number): void {
    if (this.used + bytes > this.text.length) {
      let cap = this.text.length
      while (cap < this.used + bytes) cap *= 2
      const t = new Uint8Array(cap)
      t.set(this.text.subarray(0, this.used))
      const l = new Uint8Array(cap)
      l.set(this.lower.subarray(0, this.used))
      this.text = t
      this.lower = l
    }
    if (this.nLines + lines > this.lineOff.length) {
      let cap = this.lineOff.length
      while (cap < this.nLines + lines) cap *= 2
      const g = <T extends Uint8Array | Uint16Array | Uint32Array>(a: T): T => {
        const n = new (a.constructor as new (n: number) => T)(cap)
        n.set(a.subarray(0, this.nLines))
        return n
      }
      this.lineOff = g(this.lineOff)
      this.lineLen = g(this.lineLen)
      this.lineFile = g(this.lineFile)
      this.lineNo = g(this.lineNo)
      this.mask = g(this.mask)
      this.alive = g(this.alive)
    }
  }

  /** Add (or replace) a file's lines. Returns number of lines stored. */
  addFile(path: string, buf: Uint8Array): number {
    this.removeFile(path)
    // upper bound on lines: count of \n + 1
    let nl = 1
    for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) nl++
    this.ensure(buf.length, nl)
    const fid = this.files.length
    const lowerPath = path.toLowerCase()
    const entry: FileEntry = {
      path,
      lower: lowerPath,
      nameStart: path.lastIndexOf('/') + 1,
      first: this.nLines,
      count: 0,
      alive: true
    }
    const { text, lower, lineOff, lineLen, lineFile, lineNo, mask, alive } = this
    let used = this.used
    let n = this.nLines
    let pos = 0
    let ln = 0
    const total = buf.length
    while (pos <= total) {
      let e = buf.indexOf(10, pos)
      if (e === -1) e = total
      ln++
      let s = pos
      let end = e
      pos = e + 1
      while (end > s && (buf[end - 1] === 13 || buf[end - 1] === 32 || buf[end - 1] === 9)) end--
      if (end <= s) continue
      if (end - s > MAX_LINE_BYTES) end = s + MAX_LINE_BYTES
      const start = used
      let m = 0
      for (let i = s; i < end; i++) {
        const c = buf[i]
        text[used] = c
        lower[used] = c >= 65 && c <= 90 ? c + 32 : c
        m |= CHAR_BIT[c]
        used++
      }
      lineOff[n] = start
      lineLen[n] = end - s
      lineFile[n] = fid
      lineNo[n] = ln
      mask[n] = m
      alive[n] = 1
      n++
    }
    entry.count = n - this.nLines
    this.used = used
    this.nLines = n
    this.files.push(entry)
    this.fileByPath.set(path, fid)
    this.liveLines += entry.count
    this.liveFiles++
    this.version++
    return entry.count
  }

  removeFile(path: string): boolean {
    const fid = this.fileByPath.get(path)
    if (fid === undefined) return false
    const f = this.files[fid]
    for (let i = f.first; i < f.first + f.count; i++) this.alive[i] = 0
    f.alive = false
    this.liveLines -= f.count
    this.deadLines += f.count
    this.liveFiles--
    this.fileByPath.delete(path)
    this.version++
    if (this.deadLines > 100_000 && this.deadLines > this.liveLines / 4) this.compact()
    return true
  }

  removePrefix(dirPrefix: string): number {
    let n = 0
    for (const p of [...this.fileByPath.keys()]) if (p.startsWith(dirPrefix)) n += this.removeFile(p) ? 1 : 0
    return n
  }

  compact(): void {
    const cl = Math.max(1 << 14, this.liveLines)
    const lineOff = new Uint32Array(cl)
    const lineLen = new Uint16Array(cl)
    const lineFile = new Uint32Array(cl)
    const lineNo = new Uint32Array(cl)
    const mask = new Uint32Array(cl)
    const alive = new Uint8Array(cl)
    let used = 0
    let n = 0
    // compute exact live bytes first so the arena fits
    let bytes = 0
    for (let i = 0; i < this.nLines; i++) if (this.alive[i]) bytes += this.lineLen[i]
    const t2 = new Uint8Array(Math.max(bytes + (bytes >> 2), 1 << 20))
    const l2 = new Uint8Array(t2.length)
    for (const f of this.files) {
      if (!f.alive) {
        f.first = n
        f.count = 0
        continue
      }
      const first = n
      for (let i = f.first; i < f.first + f.count; i++) {
        const len = this.lineLen[i]
        const off = this.lineOff[i]
        t2.set(this.text.subarray(off, off + len), used)
        l2.set(this.lower.subarray(off, off + len), used)
        lineOff[n] = used
        lineLen[n] = len
        lineFile[n] = this.lineFile[i]
        lineNo[n] = this.lineNo[i]
        mask[n] = this.mask[i]
        alive[n] = 1
        used += len
        n++
      }
      f.first = first
      f.count = n - first
    }
    this.text = t2
    this.lower = l2
    this.used = used
    this.lineOff = lineOff
    this.lineLen = lineLen
    this.lineFile = lineFile
    this.lineNo = lineNo
    this.mask = mask
    this.alive = alive
    this.nLines = n
    this.deadLines = 0
    this.version++
  }
}
