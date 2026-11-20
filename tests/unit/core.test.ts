import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EDITOR_DEFS, validateInside, clampInt, tryOrder, detectPaths } from '../../src/main/editors-core.ts'
import { withoutRecent, loadSettings, saveSettingsAtomic, sanitize, autoEditor, DEFAULTS } from '../../src/main/settings-core.ts'

const def = (id: string) => EDITOR_DEFS.find((d) => d.id === id)!
const weird = '/w/te st;$(x) é.txt'

test('commands keep weird paths as single args', () => {
  assert.deepEqual(def('vscode').build('/b/code', weird, 40, 3).args, ['-g', `${weird}:40:3`])
  assert.deepEqual(def('webstorm').build('/Applications/WebStorm.app', weird, 40, 3), {
    bin: '/usr/bin/open', args: ['-na', '/Applications/WebStorm.app', '--args', '--line', '40', '--column', '3', weird] })
  assert.deepEqual(def('webstorm').build('/x/scripts/webstorm', weird, 4, 1).args, ['--line', '4', '--column', '1', weird])
})
test('validateInside', () => {
  assert.equal(validateInside('/w', 'a/b.ts'), '/w/a/b.ts')
  assert.equal(validateInside('/w', '../x'), null)
  assert.equal(validateInside('/w', '/w2/x'), null)
  assert.equal(validateInside('/w', '/w/a'), '/w/a')
  assert.equal(validateInside('/w', 'a\0b'), null)
})
test('clampInt', () => { assert.equal(clampInt(NaN), 1); assert.equal(clampInt(-5), 1); assert.equal(clampInt(7.9), 7) })
test('tryOrder', () => {
  assert.deepEqual(tryOrder('cursor', { webstorm: 'a', cursor: 'b' }), ['cursor', 'webstorm'])
  assert.deepEqual(tryOrder('vscode', { webstorm: 'a' }), ['webstorm'])
})
test('detectPaths uses probe', () => {
  const r = detectPaths((p) => p.endsWith('/usr/local/bin/code'))
  assert.deepEqual(r, { vscode: '/usr/local/bin/code' })
})
test('settings recovery + atomic', () => {
  const d = mkdtempSync(join(tmpdir(), 'fs-'))
  const f = join(d, 's.json')
  assert.deepEqual(loadSettings(f), DEFAULTS)
  writeFileSync(f, '{broken')
  assert.deepEqual(loadSettings(f), DEFAULTS)
  assert.ok(existsSync(f + '.corrupt'))
  saveSettingsAtomic(f, { ...DEFAULTS, editor: 'cursor' })
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).editor, 'cursor')
  assert.deepEqual(readdirSync(d).filter((x) => x.endsWith('.tmp')), [])
  assert.equal(sanitize({ editor: 'bogus', splitSize: 99, recentWorkspaces: [1, 'a', 'a'] }).editor, 'system')
  assert.deepEqual(sanitize({ recentWorkspaces: [1, 'a', 'a'], splitSize: 99 }).recentWorkspaces, ['a'])
  assert.equal(sanitize({ splitSize: 99 }).splitSize, 0.9)
})

test('autoEditor prefers WebStorm, then Cursor, then VS Code, else system', () => {
  assert.equal(autoEditor({ webstorm: '/a', cursor: '/b', vscode: '/c' }), 'webstorm')
  assert.equal(autoEditor({ cursor: '/b', vscode: '/c' }), 'cursor')
  assert.equal(autoEditor({ vscode: '/c' }), 'vscode')
  assert.equal(autoEditor({}), 'system')
})

test('a saved "system" editor without editorChosen is not treated as a choice', () => {
  assert.equal(sanitize({ editor: 'system' }).editorChosen, false)
  assert.equal(sanitize({ editor: 'cursor' }).editorChosen, true)
  assert.equal(sanitize({ editor: 'system', editorChosen: true }).editorChosen, true)
  assert.equal(sanitize({ editor: 'bogus', editorChosen: true }).editorChosen, false)
})
test('withoutRecent removes only the exact entry, persists atomically, never touches disk', () => {
  const d = mkdtempSync(join(tmpdir(), 'fugly-rm-'))
  const keep = mkdtempSync(join(d, 'a-')); const drop = mkdtempSync(join(d, 'b-'))
  const file = join(d, 'settings.json')
  saveSettingsAtomic(file, { ...DEFAULTS, recentWorkspaces: [keep, drop] })
  const cur = loadSettings(file)
  saveSettingsAtomic(file, { ...cur, recentWorkspaces: withoutRecent(cur.recentWorkspaces, drop) })
  assert.deepEqual(loadSettings(file).recentWorkspaces, [keep])
  assert.deepEqual(withoutRecent(['/a', '/b'], '/nope'), ['/a', '/b'])
  assert.ok(existsSync(drop), 'folder still on disk')
})
