import type { Api, IndexStatus, SearchMatch, Settings } from '@shared/types'

const WORDS = ['search', 'index', 'worker', 'render', 'config', 'handler', 'buffer', 'stream', 'parse', 'format', 'result', 'query', 'token', 'cache', 'widget']
const DIRS = ['src/main', 'src/renderer/components', 'src/shared', 'packages/core/lib', 'packages/ui/src', 'tools/scripts', 'docs']
const EXTS = ['ts', 'tsx', 'js', 'py', 'go', 'css', 'md', 'json']

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) }

function makeFiles() {
  const r = rng(7)
  const files: { path: string; lines: string[] }[] = []
  for (let f = 0; f < 600; f++) {
    const w = WORDS[Math.floor(r() * WORDS.length)]
    const ext = EXTS[Math.floor(r() * EXTS.length)]
    const path = `${DIRS[Math.floor(r() * DIRS.length)]}/${w}${f % 9 ? '' : 'Manager'}${f}.${ext}`
    const lines: string[] = []
    for (let l = 0; l < 60; l++) {
      const a = WORDS[Math.floor(r() * WORDS.length)], b = WORDS[Math.floor(r() * WORDS.length)]
      const k = Math.floor(r() * 6)
      lines.push([
        `export function ${a}${b[0].toUpperCase()}${b.slice(1)}(input: string): number {`,
        `  const ${a} = await ${b}.load(input) // TODO: handle ${a} errors`,
        `  if (!${a}) throw new Error("missing ${b} for " + input)`,
        `  return ${Math.floor(r() * 900)}`,
        `import { ${a} } from './${b}'`,
        `}`
      ][k])
    }
    files.push({ path, lines })
  }
  return files
}

export function installMock(): void {
  const files = makeFiles()
  const byPath = new Map(files.map((f) => [f.path, f]))
  let status: IndexStatus = { state: 'idle', files: 0, lines: 0, root: null }
  const subs = new Set<(s: IndexStatus) => void>()
  const emit = (s: IndexStatus) => { status = s; subs.forEach((cb) => cb(s)) }
  let settings: Settings = { editor: 'webstorm', recentWorkspaces: ['/Users/dev/projects/atlas', '/Users/dev/projects/fugly-search', '/Users/dev/work/storefront'] }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const fuzzy = (q: string, t: string, cs: boolean): [number, number][] | null => {
    const hay = cs ? t : t.toLowerCase(), needle = cs ? q : q.toLowerCase()
    const idx = hay.indexOf(needle)
    if (idx >= 0) return [[idx, idx + needle.length]]
    const out: [number, number][] = []
    let p = 0
    for (const ch of needle) {
      const i = hay.indexOf(ch, p)
      if (i < 0) return null
      out.push([i, i + 1]); p = i + 1
    }
    return out
  }

  const api: Api = {
    pickWorkspace: async () => '/Users/dev/projects/atlas',
    openWorkspace: async (p) => {
      emit({ state: 'indexing', files: 0, lines: 0, root: p })
      void (async () => {
        for (let i = 1; i <= 5; i++) { await sleep(250); emit({ state: 'indexing', files: i * 120, lines: i * 120 * 60, root: p }) }
        emit({ state: 'ready', files: files.length, lines: files.length * 60, root: p })
      })()
      settings = { ...settings, recentWorkspaces: [p, ...settings.recentWorkspaces.filter((x) => x !== p)].slice(0, 8) }
      return status
    },
    search: async (req) => {
      const t0 = performance.now()
      const matches: SearchMatch[] = []
      const q = req.query
      const fileSet = new Set<string>()
      let truncated = false
      if (q) outer: for (const f of files) {
        for (let i = 0; i < f.lines.length; i++) {
          const m = fuzzy(q, f.lines[i], !!req.caseSensitive)
          if (m) {
            matches.push({ file: f.path, line: i + 1, text: f.lines[i], matchRanges: m, score: m.length === 1 ? 100 : 10 })
            fileSet.add(f.path)
            if (matches.length >= req.maxResults) { truncated = true; break outer }
          }
        }
      }
      matches.sort((a, b) => b.score - a.score)
      if (q === 'boom') throw new Error('Search worker crashed (mock)')
      return { id: req.id, matches, totalFiles: fileSet.size, totalLines: matches.length, tookMs: performance.now() - t0, truncated }
    },
    onMenu: () => () => {},
    onIndexStatus: (cb) => { subs.add(cb); cb(status); return () => { subs.delete(cb) } },
    readFile: async ({ file, line, radius = 50 }) => {
      const f = byPath.get(file)
      if (!f) return { file, startLine: 1, lines: [], totalLines: 0, ok: false, error: 'File not found' }
      const s = Math.max(1, line - radius), e = Math.min(f.lines.length, line + radius)
      return { file, startLine: s, lines: f.lines.slice(s - 1, e), totalLines: f.lines.length, ok: true }
    },
    listEditors: async () => [
      { id: 'webstorm', label: 'WebStorm', available: true }, { id: 'vscode', label: 'VS Code', available: true },
      { id: 'cursor', label: 'Cursor', available: false }, { id: 'system', label: 'System default', available: true }
    ],
    openInEditor: async () => true,
    getSettings: async () => settings,
    removeRecentWorkspace: async (p) => (settings = { ...settings, recentWorkspaces: settings.recentWorkspaces.filter((x) => x !== p) }),
    setSettings: async (p) => (settings = { ...settings, ...p }),
    getStartupWorkspace: async () => null
  }
  ;(window as unknown as { __mockApi: Api }).__mockApi = api
}
