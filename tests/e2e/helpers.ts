import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
export const SHOT_DIR = join(ROOT, 'tests/e2e/screenshots')

export interface Launched { app: ElectronApplication; page: Page; userData: string; issues: string[] }

/** Launch the BUILT app (run `npm run build` first). */
export async function launch(opts: { workspace?: string; env?: Record<string, string>; userData?: string } = {}): Promise<Launched> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'fugly-ud-'))
  const env = { ...process.env, E2E: '1', FUGLY_USER_DATA: userData, ...opts.env } as Record<string, string>
  if (opts.workspace) env.FUGLY_TEST_WORKSPACE = opts.workspace
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env, timeout: 30_000 })
  await app.firstWindow()
  let page: Page | undefined
  for (let i = 0; i < 50 && !page; i++) {
    page = app.windows().find((p) => !p.url().startsWith('devtools://'))
    if (!page) await new Promise((r) => setTimeout(r, 100))
  }
  if (!page) throw new Error('main window not found')
  const issues: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(`[renderer ${m.type()}] ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => issues.push(`[renderer pageerror] ${e.message}`))
  app.process().stderr?.on('data', (d) => {
    for (const line of String(d).split('\n')) if (line.trim() && !/DevTools listening|Debugger (listening|attached|ending)|For help, see/i.test(line)) issues.push(`[main stderr] ${line}`)
  })
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userData, issues }
}

export async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const path = join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path })
  return path
}

/** Small repo with awkward filenames (space, semicolon, unicode). */
export function makeSmallRepo(root = mkdtempSync(join(tmpdir(), 'fugly-small-'))): string {
  const files: Record<string, string> = {
    'src/alpha.ts': 'export const alpha = 1\nexport function render() {}\n',
    'src/te st;file.ts': 'const spaced = "needle in spaced"\n',
    'src/ünï/кириллица.ts': 'const uni = "needle unicode"\n',
    'docs/readme.md': '# Readme\nneedle in docs\n'
  }
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, text)
  }
  return root
}

/** ~files*linesPer lines (default 500k). Cached via marker file. */
export function makeRepo(root = join(tmpdir(), 'fugly-500k'), files = 5000, linesPer = 100): string {
  const marker = join(root, '.done')
  if (existsSync(marker)) return root
  const w = ['alpha', 'beta', 'gamma', 'delta', 'render', 'search', 'index', 'token', 'parse', 'fuzzy']
  for (let i = 0; i < files; i++) {
    const dir = join(root, `d${i % 50}`, `s${i % 7}`)
    mkdirSync(dir, { recursive: true })
    const lines: string[] = []
    for (let l = 0; l < linesPer; l++) lines.push(`const ${w[(i + l) % 10]}_${i}_${l} = ${w[(i * l) % 10]}(${l}) // line ${l}`)
    writeFileSync(join(dir, `file${i}.ts`), lines.join('\n'))
  }
  writeFileSync(marker, '')
  return root
}
