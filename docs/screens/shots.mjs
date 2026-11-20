import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ws = process.env.WS || root
async function s0(page,tag){ await page.screenshot({path:`${root}/docs/screens/${tag}-welcome.png`}) }
async function run(scheme, tag) {
  const env = { ...process.env, FUGLY_TEST_WORKSPACE: ws, FUGLY_USER_DATA: mkdtempSync(join(tmpdir(), 'fu-')) }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root], cwd: root, env })
  const page = await app.firstWindow()
  page.on('console', (m) => console.log('[r]', m.text()))
  page.on('pageerror', (e) => console.log('[err]', e.message))
  await page.emulateMedia({ colorScheme: scheme })
  if (process.env.MOCK) { await page.goto('file://'+root+'/out/renderer/index.html?FUGLY_MOCK'); await page.waitForSelector('.recent'); await s0(page,tag); await page.click('.recent'); }
  await page.waitForSelector('input[role=combobox]', { timeout: 20000 })
  await page.waitForTimeout(1500)
  const s = (n) => page.screenshot({ path: `${root}/docs/screens/${tag}-${n}.png` })
  await s('empty')
  await page.fill('input[role=combobox]', process.env.Q||'useState')
  await page.waitForSelector('[role=option]', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(900)
  await s('results')
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
  await page.click('button[aria-label="Group by file"]')
  await page.waitForTimeout(700)
  await s('grouped')
  await page.fill('input[role=combobox]', 'zzqqxxjj')
  await page.waitForTimeout(700)
  await s('noresults')
  await app.close()
}
await run('dark', 'dark'); await run('light', 'light')
