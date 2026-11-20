// Pure settings logic: sanitizing, recovery, atomic write. No electron import.
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Settings } from '../shared/types'

export interface StoredSettings extends Settings { splitSize?: number; editorChosen?: boolean }
export const DEFAULTS: StoredSettings = { editor: 'system', recentWorkspaces: [], theme: 'system', splitSize: 0.5 }
const EDITORS = ['webstorm', 'vscode', 'cursor', 'system']
const THEMES = ['dark', 'light', 'system']

export function sanitize(raw: unknown): StoredSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const recent = Array.isArray(r.recentWorkspaces) ? r.recentWorkspaces.filter((x): x is string => typeof x === 'string' && !!x) : []
  const split = typeof r.splitSize === 'number' && Number.isFinite(r.splitSize) ? Math.min(0.9, Math.max(0.1, r.splitSize)) : DEFAULTS.splitSize
  return {
    editor: EDITORS.includes(r.editor as string) ? (r.editor as StoredSettings['editor']) : DEFAULTS.editor,
    recentWorkspaces: [...new Set(recent)].slice(0, 10),
    theme: THEMES.includes(r.theme as string) ? (r.theme as StoredSettings['theme']) : DEFAULTS.theme,
    splitSize: split,
    // 'system' was the old default, so only an explicit flag proves it was chosen; any other saved editor must have been picked.
    editorChosen: EDITORS.includes(r.editor as string) && (r.editorChosen === true || r.editor !== 'system')
  }
}

/** Reads file; on corrupt JSON moves it aside to .corrupt and returns defaults. */
export function loadSettings(file: string): StoredSettings {
  if (!existsSync(file)) return { ...DEFAULTS }
  try {
    return sanitize(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    try { copyFileSync(file, file + '.corrupt') } catch { /* ignore */ }
    return { ...DEFAULTS }
  }
}

/** Pure: the recents list without `p` (exact match). Never touches disk. */
export function withoutRecent(recent: string[], p: string): string[] { return recent.filter((x) => x !== p) }

export function saveSettingsAtomic(file: string, s: StoredSettings): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, file)
}

/** Editor to use when the user never picked one: first detected IDE, else the system default. */
export function autoEditor(found: Partial<Record<Settings['editor'], string>>): Settings['editor'] {
  return (['webstorm', 'cursor', 'vscode'] as const).find((id) => found[id]) ?? 'system'
}
