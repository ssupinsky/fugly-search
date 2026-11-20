import { app } from 'electron'
import { join } from 'node:path'
import type { Settings } from '../shared/types'
import { autoEditor, withoutRecent, loadSettings, sanitize, saveSettingsAtomic, type StoredSettings } from './settings-core'
import { detectPaths } from './editors-core'

let cache: StoredSettings | null = null
const file = (): string => join(app.getPath('userData'), 'settings.json')

const stored = (): StoredSettings => (cache ??= loadSettings(file()))

/** Returns settings with the effective editor: the saved choice, or the best detected editor if none was chosen. */
export function getSettings(): Settings {
  const s = stored()
  return s.editorChosen ? s : { ...s, editor: autoEditor(detectPaths()) }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const cur = stored()
  cache = sanitize({ ...cur, ...patch, editorChosen: cur.editorChosen || patch.editor !== undefined })
  try { saveSettingsAtomic(file(), cache) } catch (e) { console.error('settings save failed', e) }
  return getSettings()
}

export function addRecentWorkspace(p: string): Settings {
  const rest = getSettings().recentWorkspaces.filter((x) => x !== p)
  return setSettings({ recentWorkspaces: [p, ...rest].slice(0, 10) })
}

/** Removes a path from the saved recents list only; never touches the folder on disk. */
export function removeRecentWorkspace(p: string): Settings {
  return setSettings({ recentWorkspaces: withoutRecent(stored().recentWorkspaces, p) })
}
