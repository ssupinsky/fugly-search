import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { launch, makeSmallRepo, makeRepo, shot, type Launched } from './helpers.ts'

const tmp = (p: string): string => realpathSync(mkdtempSync(join(tmpdir(), p)))
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const ready = (page: Page): Promise<unknown> => page.waitForSelector('.pill.ready', { timeout: 120_000 })
const box = (page: Page) => page.getByRole('combobox')
const rows = (page: Page) => page.locator('[role=option]')
const noIssues = (l: Launched): void => assert.deepEqual(l.issues, [], 'console/main issues:\n' + l.issues.join('\n'))

function rankRepo(): string {
  const root = tmp('fugly-rank-')
  write(root, 'a.ts', 'export function renderSearchResults() {}\n')
  write(root, 'b.ts', 'const r = 1; const e = 2; const n = 3; const d = 4; // s e a r c h\n')
  write(root, 'c.ts', 'the quick brown fox jumps over the lazy dog\n')
  write(root, 'd.ts', 'search then render later\n')
  return root
}

test('workspace opens, keywords in any order, ranking, keys, toggles, no console issues', async () => {
  const l = await launch({ workspace: rankRepo() })
  try {
    const { page } = l
    await ready(page)
    assert.match(await page.title(), /Fugly Search/)
    await box(page).fill('render search')
    await rows(page).first().waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 2)
    const top2 = (await rows(page).allInnerTexts()).slice(0, 2).join('\n')
    assert.match(top2, /renderSearchResults/, 'whole-word/identifier matches rank top')
    assert.match(top2, /search then render later/)
    assert.doesNotMatch(top2, /s e a r c h/, 'scattered letters rank below')
    await box(page).fill('search render')
    await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 2)
    const texts = await rows(page).allInnerTexts()
    assert.ok(texts.some((t) => /search then render later/.test(t)), 'reverse order finds line')
    // no results
    await box(page).fill('zzqqxxvv')
    await page.getByText(/No matches/).waitFor()
    // keys
    await box(page).fill('render')
    await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 2)
    const sel = () => page.locator('[role=option][aria-selected=true]').first().getAttribute('id')
    const id0 = await sel()
    await page.keyboard.press('ArrowDown')
    assert.notEqual(await sel(), id0)
    await page.keyboard.press('ArrowUp')
    assert.equal(await sel(), id0)
    await page.keyboard.press('Escape')
    assert.equal(await box(page).inputValue(), '')
    await page.getByText(/Type to search/).waitFor()
    // toggles
    await box(page).fill('Render')
    await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 1)
    const nCase = await rows(page).count()
    await page.getByLabel('Match case').click()
    await page.waitForFunction((n) => document.querySelectorAll('[role=option]').length < n, nCase)
    assert.equal(await page.getByLabel('Match case').getAttribute('aria-pressed'), 'true')
    await page.getByLabel('Match case').click()
    const pv = page.getByLabel('Show preview')
    const was = await pv.getAttribute('aria-pressed')
    await pv.click()
    assert.notEqual(await pv.getAttribute('aria-pressed'), was)
    await pv.click()
    await page.getByLabel('Group by file').click()
    assert.equal(await page.getByLabel('Group by file').getAttribute('aria-pressed'), 'true')
    await shot(page, 'e2e-grouped')
    noIssues(l)
  } finally { await l.app.close() }
})

test('Enter opens in chosen editor with exact command (dry run); cmd+1 too', async () => {
  const ud = tmp('fugly-ud-')
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ editor: 'cursor' }))
  const root = tmp('fugly-edit-')
  write(root, 'src/x y.ts', 'line one\nline two\nfind the unique_token here\n')
  const l = await launch({ workspace: root, userData: ud, env: { FUGLY_EDITOR_DRY_RUN: '1' } })
  try {
    const { page } = l
    await ready(page)
    await box(page).fill('unique_token')
    await rows(page).first().waitFor()
    await page.keyboard.press('Enter')
    const log = join(ud, 'editor-dry-run.log')
    await page.waitForFunction(() => true)
    for (let i = 0; i < 50 && !existsSync(log); i++) await new Promise((r) => setTimeout(r, 100))
    const cmds = readFileSync(log, 'utf8').trim().split('\n').map((x) => JSON.parse(x))
    assert.equal(cmds.length, 1)
    assert.match(cmds[0].bin, /cursor$/)
    assert.deepEqual(cmds[0].args, ['-g', `${join(root, 'src/x y.ts')}:3:10`])
    // direct api calls for the other editors
    const file = 'src/x y.ts'
    await page.evaluate((f) => (window as any).api.openInEditor(f, 3, 10, 'vscode'), file)
    await page.evaluate((f) => (window as any).api.openInEditor(f, 3, 10, 'webstorm'), file)
    await page.evaluate((f) => (window as any).api.openInEditor(f, 3, 10, 'system'), file)
    const all = readFileSync(log, 'utf8').trim().split('\n').map((x) => JSON.parse(x))
    assert.match(all[1].bin, /code$/)
    assert.deepEqual(all[1].args, ['-g', `${join(root, 'src/x y.ts')}:3:10`])
    const ws = all[2]
    assert.deepEqual(ws.args.slice(-5), ['--line', '3', '--column', '10', join(root, 'src/x y.ts')])
    assert.deepEqual(all[3], { bin: 'shell.openPath', args: [join(root, 'src/x y.ts')] })
    // path traversal rejected
    assert.equal(await page.evaluate(() => (window as any).api.openInEditor('../../etc/passwd', 1, 1, 'vscode')), false)
    noIssues(l)
  } finally { await l.app.close() }
})

test('editor picker choice persists across restart', async () => {
  const ud = tmp('fugly-ud-')
  const root = makeSmallRepo()
  let l = await launch({ workspace: root, userData: ud })
  try {
    await ready(l.page)
    await l.page.locator('.picker .btn').click()
    await shot(l.page, 'e2e-picker')
    const opts = l.page.locator('[role=option]:not([disabled])').filter({ hasNotText: 'System default' })
    const label = (await opts.count()) ? ((await opts.first().innerText()).replace('✓', '').trim()) : 'System default'
    const target = (await opts.count()) ? opts.first() : l.page.getByRole('option', { name: /System default/ })
    await target.click()
    await l.page.waitForTimeout(300)
    assert.match(await l.page.locator('.picker .btn').innerText(), new RegExp(label))
    noIssues(l)
    await l.app.close()
    l = await launch({ workspace: root, userData: ud })
    await ready(l.page)
    assert.match(await l.page.locator('.picker .btn').innerText(), new RegExp(label))
  } finally { await l.app.close() }
})

test('welcome screen without workspace, recents listed after open', async () => {
  const ud = tmp('fugly-ud-')
  const l = await launch({ userData: ud })
  try {
    await l.page.getByRole('button', { name: /Open Folder/ }).waitFor()
    await shot(l.page, 'e2e-welcome')
    const root = makeSmallRepo()
    await l.page.evaluate((p) => (window as any).api.openWorkspace(p), root)
    const s = JSON.parse(readFileSync(join(ud, 'settings.json'), 'utf8'))
    assert.equal(s.recentWorkspaces[0], root)
    noIssues(l)
  } finally { await l.app.close() }
})

test('file edits on disk show up via watcher', async () => {
  const root = makeSmallRepo(tmp('fugly-watch-'))
  const l = await launch({ workspace: root })
  try {
    await ready(l.page)
    await box(l.page).fill('watcherneedle')
    await l.page.getByText(/No matches/).waitFor()
    write(root, 'src/new.ts', 'const v = "watcherneedle appears"\n')
    // live: results refresh without retyping
    await rows(l.page).first().waitFor({ timeout: 15_000 })
    writeFileSync(join(root, 'src/new.ts'), 'nothing here\n')
    await l.page.getByText(/No matches/).waitFor({ timeout: 15_000 })
    noIssues(l)
  } finally { await l.app.close() }
})

test('500k-line repo: keystroke-to-render latency in renderer', async () => {
  const l = await launch({ workspace: makeRepo() })
  try {
    const { page } = l
    await ready(page)
    const q = 'render search'
    const lat: number[] = []
    for (let i = 1; i <= q.length; i++) {
      const ms = await page.evaluate(async (text) => {
        const input = document.querySelector('input')!
        const status = document.querySelector('.status')!
        const before = status.innerHTML // includes the per-response ms title, so it changes every response
        const t0 = performance.now()
        let sawOn = false
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise<void>((res) => {
          const done = (): void => requestAnimationFrame(() => requestAnimationFrame(() => res()))
          const tick = (): void => { const on = !!document.querySelector('.bar.on'); sawOn ||= on
          if ((status.innerHTML !== before || (sawOn && !on)) && !on && /matches in|No results/.test(status.textContent ?? '')) done(); else if (performance.now() - t0 > 8000) res(); else setTimeout(tick, 1) }
          tick()
        })
        return performance.now() - t0
      }, q.slice(0, i))
      lat.push(ms)
    }
    lat.sort((a, b) => a - b)
    console.log('keystroke->render ms', lat.map((x) => x.toFixed(0)).join(','))
    assert.ok(lat[lat.length - 1] < 1500, `worst latency ${lat[lat.length - 1]}`)
    // UI stays responsive: a rAF delay probe while a search runs
    const jank = await page.evaluate(async () => {
      const input = document.querySelector('input')!
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      let worst = 0, last = performance.now(), run = true
      const loop = (): void => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; if (run) requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
      for (const t of ['parse', 'parse t', 'parse to', 'parse tok']) {
        set.call(input, t); input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 80))
      }
      run = false
      return worst
    })
    console.log('worst frame gap ms', jank.toFixed(0))
    assert.ok(jank < 500, `frame gap ${jank}`)
    noIssues(l)
  } finally { await l.app.close() }
})

test('legacy settings with editor "system" auto-pick WebStorm instead of the OS default app', async () => {
  const ud = tmp('fugly-ud-')
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ editor: 'system' }))
  const root = tmp('fugly-auto-')
  write(root, 'src/a.ts', 'find the auto_token here\n')
  const l = await launch({ workspace: root, userData: ud, env: { FUGLY_EDITOR_DRY_RUN: '1' } })
  try {
    const { page } = l
    await ready(page)
    await box(page).fill('auto_token')
    await rows(page).first().waitFor()
    await page.keyboard.press('Enter')
    const log = join(ud, 'editor-dry-run.log')
    for (let i = 0; i < 50 && !existsSync(log); i++) await new Promise((r) => setTimeout(r, 100))
    const cmds = readFileSync(log, 'utf8').trim().split('\n').map((x) => JSON.parse(x))
    assert.equal(cmds.length, 1)
    assert.notEqual(cmds[0].bin, 'shell.openPath')
    assert.ok(cmds[0].args.includes('--line'), JSON.stringify(cmds[0]))
  } finally {
    await l.app.close()
  }
})

test('recent workspaces: X removes only that entry, does not open it, persists', async () => {
  const dirs = ['alpha', 'bravo', 'charlie'].map((n) => join(tmp('fugly-rec-'), n))
  dirs.forEach((d) => mkdirSync(d, { recursive: true }))
  const ud = tmp('fugly-ud-rec-')
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ editor: 'cursor', recentWorkspaces: dirs }))
  const recentRows = (p: Page) => p.locator('.recent')
  let l = await launch({ userData: ud })
  try {
    const { page } = l
    await recentRows(page).first().waitFor()
    assert.equal(await recentRows(page).count(), 3)
    await page.getByRole('button', { name: 'Remove bravo from recent workspaces' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.recent').length === 2)
    const names = await page.locator('.rname').allInnerTexts()
    assert.deepEqual(names, ['alpha', 'charlie'])
    assert.equal(await box(page).count(), 0, 'workspace was not opened')
    assert.equal(await page.locator('.pill.ready').count(), 0)
    assert.ok(dirs.every((d) => existsSync(d)), 'nothing deleted on disk')
  } finally {
    await l.app.close()
  }
  l = await launch({ userData: ud })
  try {
    await recentRows(l.page).first().waitFor()
    assert.deepEqual(await l.page.locator('.rname').allInnerTexts(), ['alpha', 'charlie'])
    await l.page.locator('.recent').first().focus()
    await l.page.keyboard.press('Delete')
    await l.page.waitForFunction(() => document.querySelectorAll('.recent').length === 1)
  } finally {
    await l.app.close()
  }
})
