// Workspace discovery, filtering, loading and watching (runs inside the worker).
import { execFile } from 'node:child_process'
import { opendir, readFile, stat } from 'node:fs/promises'
import { open } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import type { IndexStatus } from '../../shared/types'
import { Store } from './store'

export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_TOTAL_LINES = 3_000_000
export const MAX_TOTAL_BYTES = 400 * 1024 * 1024

export const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'out', 'build', 'dist', '.next', '.nuxt', '.cache', 'coverage', '.turbo', '__pycache__',
  '.venv', '.parcel-cache', '.svn', '.hg'
])
const IGNORE_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store', 'Cargo.lock', 'poetry.lock'])
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar',
  'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'webm', 'ogg', 'wav', 'exe', 'dll', 'so',
  'dylib', 'o', 'a', 'class', 'jar', 'bin', 'dmg', 'icns', 'sqlite', 'db', 'node', 'pyc', 'map'
])

export function defaultIgnoredPath(rel: string): boolean {
  const parts = rel.split('/')
  for (let i = 0; i < parts.length - 1; i++) if (DEFAULT_IGNORE_DIRS.has(parts[i])) return true
  const name = parts[parts.length - 1]
  if (DEFAULT_IGNORE_DIRS.has(name) || IGNORE_FILES.has(name)) return true
  if (name.endsWith('.min.js') || name.endsWith('.min.css')) return true
  const dot = name.lastIndexOf('.')
  if (dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase())) return true
  return false
}

export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

interface IgLevel {
  base: string // '' or 'a/b/'
  ig: Ignore
}

async function loadIgnore(root: string, dirRel: string): Promise<IgLevel | null> {
  try {
    const txt = await readFile(join(root, dirRel, '.gitignore'), 'utf8')
    return { base: dirRel ? dirRel + '/' : '', ig: ignore().add(txt) }
  } catch {
    return null
  }
}

function ignoredBy(levels: IgLevel[], rel: string, isDir: boolean): boolean {
  for (const l of levels) {
    if (!rel.startsWith(l.base)) continue
    const sub = rel.slice(l.base.length)
    if (!sub) continue
    try {
      if (l.ig.ignores(isDir ? sub + '/' : sub)) return true
    } catch {
      /* invalid path for ignore */
    }
  }
  return false
}

function git(root: string, args: string[]): Promise<string> {
  return new Promise((res, rej) =>
    execFile('git', args, { cwd: root, maxBuffer: 1 << 30, encoding: 'utf8' }, (e, out) => (e ? rej(e) : res(out)))
  )
}

async function listViaGit(root: string): Promise<string[] | null> {
  try {
    if ((await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return null
    const out = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    return out.split('\0').filter(Boolean)
  } catch {
    return null
  }
}

async function walk(root: string, startRel: string, levels0: IgLevel[], out: string[]): Promise<void> {
  const stack: { rel: string; levels: IgLevel[] }[] = [{ rel: startRel, levels: levels0 }]
  while (stack.length) {
    const { rel, levels } = stack.pop()!
    const own = await loadIgnore(root, rel)
    const lv = own ? [...levels, own] : levels
    let dir
    try {
      dir = await opendir(join(root, rel))
    } catch {
      continue
    }
    for await (const ent of dir) {
      const r = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(ent.name) || ignoredBy(lv, r, true)) continue
        stack.push({ rel: r, levels: lv })
      } else if (ent.isFile()) {
        if (defaultIgnoredPath(r) || ignoredBy(lv, r, false)) continue
        out.push(r)
      }
    }
  }
}

export async function listFiles(root: string): Promise<{ files: string[]; viaGit: boolean }> {
  const g = await listViaGit(root)
  if (g) return { files: g.map((f) => f.split(sep).join('/')).filter((f) => !defaultIgnoredPath(f)), viaGit: true }
  const files: string[] = []
  await walk(root, '', [], files)
  return { files, viaGit: false }
}

export type Subscription = { unsubscribe(): Promise<void> }

export class Workspace {
  store = new Store()
  state: IndexStatus['state'] = 'idle'
  private subs: Subscription | null = null
  private pending = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null
  private processing = false
  private ignCache = new Map<string, IgLevel | null>()
  private disposed = false
  private lastEmit = 0
  budgetHit = false
  private realRoot: string
  /** resolves when start() (walk + load + watcher subscribe) has fully settled */
  running: Promise<void> = Promise.resolve()

  constructor(
    public root: string,
    private emit: (s: IndexStatus) => void,
    private debounceMs = 100
  ) {
    try {
      this.realRoot = realpathSync(root)
    } catch {
      this.realRoot = root
    }
  }

  status(): IndexStatus {
    return { state: this.state, files: this.store.liveFiles, lines: this.store.liveLines, root: this.root }
  }

  private push(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 80) return
    this.lastEmit = now
    this.emit(this.status())
  }

  async loadFile(rel: string): Promise<boolean> {
    if (this.store.liveLines >= MAX_TOTAL_LINES || this.store.used >= MAX_TOTAL_BYTES) {
      this.budgetHit = true
      return false
    }
    try {
      const abs = join(this.root, rel)
      const st = await stat(abs)
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        this.store.removeFile(rel)
        return false
      }
      let buf: Buffer
      if (st.size === 0) buf = Buffer.alloc(0)
      else {
        const fh = await open(abs, 'r')
        try {
          buf = Buffer.allocUnsafe(st.size)
          const { bytesRead } = await fh.read(buf, 0, st.size, 0)
          buf = buf.subarray(0, bytesRead)
        } finally {
          await fh.close()
        }
      }
      if (looksBinary(buf)) {
        this.store.removeFile(rel)
        return false
      }
      this.store.addFile(rel, buf)
      return true
    } catch {
      this.store.removeFile(rel)
      return false
    }
  }

  start(): Promise<void> {
    this.running = this.run()
    return this.running
  }

  private async run(): Promise<void> {
    this.state = 'indexing'
    this.push(true)
    const { files } = await listFiles(this.root)
    if (this.disposed) return
    let idx = 0
    const worker = async (): Promise<void> => {
      while (!this.disposed) {
        const i = idx++
        if (i >= files.length) return
        await this.loadFile(files[i])
        this.push()
      }
    }
    await Promise.all(Array.from({ length: 24 }, worker))
    if (this.disposed) return
    this.state = 'ready'
    this.push(true)
    await this.startWatching()
  }

  private async startWatching(): Promise<void> {
    try {
      const watcher = await import('@parcel/watcher')
      const sub = await watcher.subscribe(
        this.root,
        (err, events) => {
          if (err || this.disposed) return
          for (const e of events) this.pending.set(e.path, e.type)
          if (this.timer) clearTimeout(this.timer)
          this.timer = setTimeout(() => void this.flush(), this.debounceMs)
        },
        { ignore: [...DEFAULT_IGNORE_DIRS].map((d) => `**/${d}`) }
      )
      if (this.disposed) await sub.unsubscribe()
      else this.subs = sub
    } catch {
      /* watching is best-effort */
    }
  }

  private async levelsFor(rel: string): Promise<IgLevel[]> {
    const parts = rel.split('/')
    const levels: IgLevel[] = []
    let dir = ''
    for (let i = 0; i < parts.length; i++) {
      if (!this.ignCache.has(dir)) this.ignCache.set(dir, await loadIgnore(this.root, dir))
      const l = this.ignCache.get(dir)
      if (l) levels.push(l)
      if (i < parts.length - 1) dir = dir ? dir + '/' + parts[i] : parts[i]
    }
    return levels
  }

  private async flush(): Promise<void> {
    if (this.processing) {
      this.timer = setTimeout(() => void this.flush(), this.debounceMs)
      return
    }
    this.processing = true
    const batch = [...this.pending]
    this.pending.clear()
    let changed = false
    try {
      const isGitignore = batch.some(([p]) => p.endsWith('/.gitignore'))
      if (isGitignore) {
        this.ignCache.clear()
        await this.rebuild()
        return
      }
      for (const [abs, type] of batch) {
        let rel = relative(this.root, abs)
        if (rel.startsWith('..')) rel = relative(this.realRoot, abs) // watcher reports realpaths (e.g. /private/var)
        rel = rel.split(sep).join('/')
        if (!rel || rel.startsWith('..')) continue
        if (type === 'delete') {
          const a = this.store.removeFile(rel)
          const b = this.store.removePrefix(rel + '/')
          changed ||= a || b > 0
          continue
        }
        let st
        try {
          st = await stat(abs)
        } catch {
          changed ||= this.store.removeFile(rel)
          continue
        }
        if (st.isDirectory()) {
          if (defaultIgnoredPath(rel + '/x')) continue
          const out: string[] = []
          await walk(this.root, rel, await this.levelsFor(rel + '/x'), out)
          for (const f of out) if (!this.store.fileByPath.has(f)) changed = (await this.loadFile(f)) || changed
          continue
        }
        if (defaultIgnoredPath(rel) || ignoredBy(await this.levelsFor(rel), rel, false)) {
          changed ||= this.store.removeFile(rel)
          continue
        }
        changed = (await this.loadFile(rel)) || changed
      }
    } finally {
      this.processing = false
      if (changed) this.push(true)
    }
  }

  private async rebuild(): Promise<void> {
    const { files } = await listFiles(this.root)
    const keep = new Set(files)
    for (const p of [...this.store.fileByPath.keys()]) if (!keep.has(p)) this.store.removeFile(p)
    for (const f of files) await this.loadFile(f)
    this.processing = false
    this.push(true)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    // never tear down while a native watcher subscribe is in flight (would crash the worker env cleanup)
    await this.running.catch(() => {})
    try {
      await this.subs?.unsubscribe()
    } catch {
      /* ignore */
    }
    this.subs = null
  }
}
