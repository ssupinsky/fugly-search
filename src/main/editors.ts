import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import type { EditorId, EditorInfo } from '../shared/types'
import { EDITOR_DEFS, clampInt, detectPaths, tryOrder, type Cmd } from './editors-core'

let cache: Partial<Record<EditorId, string>> | null = null
const detect = (force = false): Partial<Record<EditorId, string>> => (force || !cache ? (cache = detectPaths()) : cache)

export async function listEditors(): Promise<EditorInfo[]> {
  const found = detect(true)
  return [
    ...EDITOR_DEFS.map((d) => ({ id: d.id, label: d.label, available: !!found[d.id] })),
    { id: 'system' as const, label: 'System default', available: true }
  ]
}

const DRY = (): boolean => process.env.FUGLY_EDITOR_DRY_RUN === '1'
function run({ bin, args }: Cmd): Promise<boolean> {
  if (DRY()) {
    appendFileSync(join(app.getPath('userData'), 'editor-dry-run.log'), JSON.stringify({ bin, args }) + '\n')
    return Promise.resolve(true)
  }
  return new Promise((res) => {
    const child = spawn(bin, args, { shell: false, detached: true, stdio: 'ignore' })
    child.once('error', () => res(false))
    child.once('spawn', () => { child.unref(); res(true) })
  })
}

/** absPath is already validated inside the workspace by ipc.ts. Throws Error with a user-readable message on total failure. */
export async function openInEditor(absPath: string, line: number, col: number, editor: EditorId): Promise<boolean> {
  const l = clampInt(line), c = clampInt(col)
  const found = { ...detect() }
  if (DRY() && editor !== 'system') found[editor] = found[editor] ?? EDITOR_DEFS.find((d) => d.id === editor)!.candidates()[0]
  const failures: string[] = []
  if (editor !== 'system') {
    for (const id of tryOrder(editor, found)) {
      const def = EDITOR_DEFS.find((d) => d.id === id)!
      if (await run(def.build(found[id]!, absPath, l, c))) return true
      failures.push(def.label)
    }
    if (!found[editor]) failures.unshift(`${editor} not found`)
  }
  if (DRY()) {
    appendFileSync(join(app.getPath('userData'), 'editor-dry-run.log'), JSON.stringify({ bin: 'shell.openPath', args: [absPath] }) + '\n')
    return true
  }
  const err = await shell.openPath(absPath)
  if (err === '') return true
  throw new Error(`Could not open file (${failures.join(', ') || 'no editor'} failed; system default: ${err})`)
}
