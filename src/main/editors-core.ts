// Pure (electron-free) editor logic: command building, path validation, probing.
import { homedir } from 'node:os'
import { join, resolve, sep, isAbsolute } from 'node:path'
import { accessSync, constants, readdirSync } from 'node:fs'
import type { EditorId } from '../shared/types'

export interface Cmd { bin: string; args: string[] }

export function clampInt(n: unknown, min = 1, max = 10_000_000): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : min
  return Math.min(max, Math.max(min, v))
}

/** Returns the resolved absolute path if it is inside root, else null. */
export function validateInside(root: string, file: string): string | null {
  if (!root || !file || file.includes('\0')) return null
  const r = resolve(root)
  const abs = isAbsolute(file) ? resolve(file) : resolve(r, file)
  return abs === r || abs.startsWith(r.endsWith(sep) ? r : r + sep) ? abs : null
}

const H = homedir()
const apps = (n: string): string[] => ['/Applications', join(H, 'Applications')].map((d) => `${d}/${n}.app`)
export const TOOLBOX_SCRIPTS = join(H, 'Library/Application Support/JetBrains/Toolbox/scripts')

function webstormBundles(): string[] {
  const out = apps('WebStorm')
  for (const d of ['/Applications', join(H, 'Applications')]) {
    try {
      for (const e of readdirSync(d)) if (/^WebStorm.*\.app$/.test(e)) out.push(join(d, e))
    } catch { /* dir missing */ }
  }
  return [...new Set(out)]
}

const CLI_DIRS = ['/usr/local/bin', '/opt/homebrew/bin']

export interface EditorDef {
  id: EditorId
  label: string
  candidates: () => string[]
  build: (bin: string, file: string, line: number, col: number) => Cmd
}

/** WebStorm: bundle launched via `open -na`; flags --line/--column proven by tests/manual (see report). */
export const EDITOR_DEFS: EditorDef[] = [
  {
    id: 'webstorm',
    label: 'WebStorm',
    candidates: () => [...webstormBundles(), join(TOOLBOX_SCRIPTS, 'webstorm')],
    build: (bin, f, l, c) =>
      bin.endsWith('.app')
        ? { bin: '/usr/bin/open', args: ['-na', bin, '--args', '--line', String(l), '--column', String(c), f] }
        : { bin, args: ['--line', String(l), '--column', String(c), f] }
  },
  {
    id: 'cursor',
    label: 'Cursor',
    candidates: () => [...apps('Cursor').map((a) => `${a}/Contents/Resources/app/bin/cursor`), ...CLI_DIRS.map((d) => `${d}/cursor`)],
    build: (bin, f, l, c) => ({ bin, args: ['-g', `${f}:${l}:${c}`] })
  },
  {
    id: 'vscode',
    label: 'VS Code',
    candidates: () => [...apps('Visual Studio Code').map((a) => `${a}/Contents/Resources/app/bin/code`), ...CLI_DIRS.map((d) => `${d}/code`)],
    build: (bin, f, l, c) => ({ bin, args: ['-g', `${f}:${l}:${c}`] })
  }
]

export function isExecutable(p: string): boolean {
  try { accessSync(p, constants.X_OK); return true } catch { return false }
}

export function detectPaths(exists: (p: string) => boolean = isExecutable): Partial<Record<EditorId, string>> {
  const out: Partial<Record<EditorId, string>> = {}
  for (const d of EDITOR_DEFS) {
    const hit = d.candidates().find(exists)
    if (hit) out[d.id] = hit
  }
  return out
}

/** Order of editors to try: preferred first, then the rest in default order. */
export function tryOrder(preferred: EditorId | undefined, found: Partial<Record<EditorId, string>>): EditorId[] {
  const ids = (Object.keys(found) as EditorId[])
  return preferred && preferred !== 'system' && found[preferred] ? [preferred, ...ids.filter((i) => i !== preferred)] : ids
}
