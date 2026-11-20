import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ws = process.env.WS || root
async function launch(theme, withWs) {
  const ud = mkdtempSync(join(tmpdir(), 'fu-')); writeFileSync(join(ud, 'settings.json'), JSON.stringify({ theme }))
  const env = { ...process.env, FUGLY_USER_DATA: ud, FUGLY_EDITOR_DRY_RUN: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  if (withWs) env.FUGLY_TEST_WORKSPACE = ws
  const app = await electron.launch({ args: [root], cwd: root, env })
  await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t }, theme)
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1100, height: 720 }).catch(()=>{})
  return { app, page }
}
for (const theme of ['dark', 'light']) {
  const s = (page, n) => page.screenshot({ path: `${root}/docs/screens/real-${theme}-${n}.png` })
  let { app, page } = await launch(theme, false)
  await page.waitForTimeout(1500); await s(page, 'welcome'); await app.close()
  ;({ app, page } = await launch(theme, true))
  await page.waitForSelector('input[role=combobox]', { timeout: 20000 })
  await page.waitForTimeout(2500)
  await page.fill('input[role=combobox]', 'import react')
  await page.waitForSelector('[role=option]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(500); await s(page, 'results')
  await page.click('button[aria-label="Group by file"]'); await page.waitForTimeout(700); await s(page, 'grouped')
  await page.click('button[aria-label="Group by file"]')
  await page.click('button[aria-haspopup=listbox]'); await page.waitForTimeout(300); await s(page, 'picker')
  await page.keyboard.press('Escape')
  await page.click('button[aria-label="Show preview"]'); await page.waitForTimeout(300); await s(page, 'nopreview')
  await page.click('button[aria-label="Show preview"]')
  await page.fill('input[role=combobox]', '\u00a7\u00b6\u2206'); await page.waitForTimeout(700); await s(page, 'noresults')
  await app.close()
}
