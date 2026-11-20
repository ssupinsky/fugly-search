// Packages the built app into release/Fugly Search-darwin-<arch>/Fugly Search.app
import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { rmSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
// Runtime node_modules = closure of the bare imports left in out/main and out/preload
// (electron-vite externalizes deps; renderer deps are bundled by vite).
const keep = new Set()
const addPkg = (name) => {
  if (keep.has(name)) return
  const pj = join(root, 'node_modules', name, 'package.json')
  if (!existsSync(pj)) return
  keep.add(name)
  const j = JSON.parse(readFileSync(pj, 'utf8'))
  for (const d of Object.keys({ ...j.dependencies, ...j.optionalDependencies })) addPkg(d)
}
for (const dir of ['out/main', 'out/preload']) {
  for (const f of readdirSync(join(root, dir)).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(root, dir, f), 'utf8')
    for (const m of src.matchAll(/(?:require|import)\("((?:@[^"/]+\/)?[^".:/][^"/]*)(?:\/[^"]*)?"\)/g)) if (m[1] !== 'electron') addPkg(m[1])
  }
}
console.log('Runtime modules:', [...keep].join(', '))

rmSync(join(root, 'release'), { recursive: true, force: true })
const out = await packager({
  dir: root,
  out: join(root, 'release'),
  name: 'Fugly Search',
  platform: 'darwin',
  arch: process.arch,
  icon: join(root, 'build/icon'),
  appBundleId: 'com.fugly.search',
  appCategoryType: 'public.app-category.developer-tools',
  overwrite: true,
  prune: false,
  asar: { unpack: '**/*.node' },
  ignore: (p) => {
    if (!p) return false
    if (/^\/(src|tests|docs|release|scripts|build|resources|\.git)(\/|$)/.test(p)) return true
    if (/^\/(\.gitignore|README\.md|ARCHITECTURE\.md|electron\.vite\.config\.ts|tsconfig.*|package-lock\.json)$/.test(p)) return true
    if (/\.map$/.test(p)) return true
    if (p === '/node_modules') return false
    if (p.startsWith('/node_modules/')) {
      const rest = p.slice('/node_modules/'.length)
      return ![...keep].some((k) => rest === k || rest.startsWith(k + '/') || (k.startsWith('@') && rest === k.split('/')[0]))
    }
    return !(p === '/package.json' || p === '/out' || p.startsWith('/out/'))
  },
  // we sign ad-hoc ourselves below
  osxSign: false
})
for (const dir of out) {
  const app = join(dir, 'Fugly Search.app')
  execFileSync('codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'inherit' })
  console.log('Packaged:', app)
}
