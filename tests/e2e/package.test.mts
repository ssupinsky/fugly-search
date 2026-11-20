// Launches the packaged .app (run `npm run package` first). Skipped if absent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { _electron } from 'playwright'
import { makeSmallRepo } from './helpers.ts'

const app = join(process.cwd(), 'release', `Fugly Search-darwin-${process.arch}`, 'Fugly Search.app')
const exe = join(app, 'Contents/MacOS/Fugly Search')

test('packaged .app: signed, launches, worker + watcher search works', { skip: !existsSync(exe) && 'run npm run package first' }, async () => {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app])
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'fugly-pkg-ud-')))
  const ws = makeSmallRepo(realpathSync(mkdtempSync(join(tmpdir(), 'fugly-pkg-ws-'))))
  const env = { ...process.env, FUGLY_TEST_WORKSPACE: ws, FUGLY_USER_DATA: userData } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const electronApp = await _electron.launch({ executablePath: exe, args: [], env })
  const issues: string[] = []
  electronApp.process().stderr?.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) issues.push('[main stderr] ' + l) })
  try {
    const page = await electronApp.firstWindow()
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(m.text()) })
    page.on('pageerror', (e) => issues.push(e.message))
    await page.waitForSelector('.pill.ready', { timeout: 60_000 })
    await page.getByRole('combobox').fill('needle spaced')
    await page.locator('[role=option]').first().waitFor({ timeout: 15_000 })
    assert.match((await page.locator('[role=option]').allInnerTexts()).join('\n'), /needle in spaced/)
    // watcher inside the package: a file created after startup becomes searchable
    writeFileSync(join(ws, 'src/late.ts'), 'const watcherproof = "zebrafinch marker"\n')
    await page.getByRole('combobox').fill('zebrafinch marker')
    await page.getByText(/zebrafinch marker/).first().waitFor({ timeout: 15_000 })
    await page.getByRole('combobox').fill('needle spaced')
    await page.locator('[role=option]').first().waitFor()
    mkdirSync(join(process.cwd(), 'docs/screens'), { recursive: true })
    await page.screenshot({ path: join(process.cwd(), 'docs/screens/packaged.png') })
    assert.deepEqual(issues.filter((i) => !/DevTools listening/.test(i)), [])
  } finally { await electronApp.close() }
})
