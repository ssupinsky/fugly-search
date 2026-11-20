import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { IPC, type FileContextRequest, type FileContextResponse, type EditorId } from '../shared/types'
import * as engine from './search/engine'
import * as editors from './editors'
import * as settings from './settings'

function inRoot(rel: string): string | null {
  const root = engine.getRoot()
  if (!root) return null
  const abs = resolve(root, rel)
  return abs === root || abs.startsWith(root + sep) ? abs : null
}

async function open(win: BrowserWindow, path: string) {
  settings.addRecentWorkspace(path)
  if (!win.isDestroyed()) win.setTitle(`${basename(path)} — Fugly Search`)
  return engine.openWorkspace(path, (s) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.indexStatus, s)
  })
}

export function registerIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC.pickWorkspace, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.openWorkspace, (_e, p: string) => open(win, p))
  ipcMain.handle(IPC.search, (_e, req) => engine.search(req))
  ipcMain.handle(IPC.readFile, async (_e, req: FileContextRequest): Promise<FileContextResponse> => {
    const abs = inRoot(req.file)
    const fail = (error: string): FileContextResponse => ({ file: req.file, startLine: 1, lines: [], totalLines: 0, ok: false, error })
    if (!abs) return fail('outside workspace')
    try {
      const text = await readFile(abs, 'utf8')
      const all = text.split(/\r?\n/)
      const r = req.radius ?? 50
      const start = Math.max(1, req.line - r)
      const end = Math.min(all.length, req.line + r)
      return { file: req.file, startLine: start, lines: all.slice(start - 1, end), totalLines: all.length, ok: true }
    } catch (e) {
      return fail(String(e))
    }
  })
  ipcMain.handle(IPC.listEditors, () => editors.listEditors())
  ipcMain.handle(IPC.openInEditor, (_e, file: string, line: number, col?: number, ed?: EditorId) => {
    const abs = inRoot(file)
    if (!abs) return false
    return editors.openInEditor(abs, line, col ?? 1, ed ?? settings.getSettings().editor)
  })
  ipcMain.handle(IPC.getSettings, () => settings.getSettings())
  ipcMain.handle(IPC.setSettings, (_e, p) => settings.setSettings(p))
  ipcMain.handle(IPC.removeRecent, (_e, p) => {
    if (typeof p !== 'string') throw new Error('invalid path')
    return settings.removeRecentWorkspace(p)
  })
  ipcMain.handle(IPC.startupWorkspace, () => process.env.FUGLY_TEST_WORKSPACE ?? null)

  // FUGLY_TEST_WORKSPACE is opened by the renderer (getStartupWorkspace); opening here too double-indexed and tore down the first worker.
}
