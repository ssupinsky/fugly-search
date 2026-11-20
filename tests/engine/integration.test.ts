import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as engine from '../../src/main/search/engine'
import { Searcher } from '../../src/main/search/core'
import { Store } from '../../src/main/search/store'
import { listFiles } from '../../src/main/search/indexer'
import { files, openAndWait, q, tmpRepo, until } from './helpers'

afterAll(() => engine.dispose())

const big = Buffer.from(('zmarkbig filler line of text\n').repeat(60000)) // > 1MB
const tree = (): Record<string, string | Buffer> => ({
  '.gitignore': '*.log\nsecret/\n/rootonly.txt\n',
  'a.ts': 'const zmarka = 1\n',
  'sub/.gitignore': 'gen.ts\n',
  'sub/gen.ts': 'const zmarkgen = 1\n',
  'sub/keep.ts': 'const zmarkkeep = 1\n',
  'debug.log': 'zmarklog\n',
  'secret/key.ts': 'zmarksecret\n',
  'rootonly.txt': 'zmarkrootonly\n',
  'deep/rootonly.txt': 'qqdeepcontent\n',
  'node_modules/pkg/index.js': 'zmarknodemod\n',
  'dist/out.js': 'zmarkdist\n',
  'x.min.js': 'zmarkmin\n',
  'package-lock.json': '{"zmarklock": 1}\n',
  'blob.dat': Buffer.concat([Buffer.from('zmarkbinary text first\n'), Buffer.from([0, 1, 2, 0, 255]), Buffer.from('\nmore\n')]),
  'late-nul.txt': Buffer.concat([Buffer.alloc(9000, 97), Buffer.from('\nzmarklatenul\n')]),
  'pic.png': 'zmarkpng\n',
  'big.txt': big,
  'crlf.txt': 'zmarkcrlf one\r\nsecond\r\n',
  'empty.txt': ''
})

async function indexed(files_: Record<string, string | Buffer>, git = false) {
  const root = tmpRepo(files_)
  if (git) execSync('git init -q && git add -A . && git -c user.email=a@b -c user.name=n commit -qm i', { cwd: root, stdio: 'ignore' })
  await openAndWait(root)
  return root
}

const expectIndexed = async () => {
  expect(await files('zmarka')).toEqual(['a.ts'])
  expect(await files('zmarkkeep')).toEqual(['sub/keep.ts'])
  expect(await files('qqdeepcontent')).toEqual(['deep/rootonly.txt'])
  expect(await files('zmarkcrlf')).toEqual(['crlf.txt'])
  for (const m of ['GEN', 'LOG', 'SECRET', 'ROOTONLY', 'NODEMOD', 'DIST', 'MIN', 'LOCK', 'BINARY', 'PNG', 'BIG'])
    expect(await files('zmark' + m.toLowerCase()), 'zmark' + m).toEqual([])
  // late NUL (after 8KB) is not detected as binary by the 8KB heuristic -> indexed
  expect(await files('zmarklatenul')).toEqual(['late-nul.txt'])
}

describe('ignore / binary / size handling', () => {
  it('non-git workspace: .gitignore (root, nested, anchored, dir), defaults, binary, size cap', async () => {
    await indexed(tree())
    await expectIndexed()
    const r = await q('crlf')
    expect(r.matches[0].text).toBe('zmarkcrlf one') // CR stripped
  })
  it('git workspace: git ls-files path gives the same result', async () => {
    const root = await indexed(tree(), true)
    expect((await listFiles(root)).viaGit).toBe(true)
    await expectIndexed()
  })
  it('git workspace includes untracked-but-not-ignored files', async () => {
    const root = await indexed(tree(), true)
    writeFileSync(join(root, 'untracked.ts'), 'zmarkuntracked\n')
    await engine.dispose()
    await openAndWait(root)
    expect(await files('zmarkuntracked')).toEqual(['untracked.ts'])
  })
})

describe('status events', () => {
  it('reports indexing -> ready with final counts', async () => {
    const root = tmpRepo({ 'a.ts': 'one\ntwo\n', 'b.ts': 'three\n' })
    const { statuses } = await openAndWait(root)
    expect(statuses[0].state).toBe('indexing')
    const last = statuses[statuses.length - 1]
    expect(last).toMatchObject({ state: 'ready', files: 2, lines: 3 })
    expect(last.root).toBe(engine.getRoot())
    for (let i = 1; i < statuses.length; i++) expect(statuses[i].files).toBeGreaterThanOrEqual(statuses[i - 1].files)
  })
  it('search works while indexing (partial results)', async () => {
    const f: Record<string, string> = {}
    for (let i = 0; i < 3000; i++) f[`d${i % 30}/f${i}.ts`] = `const token${i} = ${i}\n`.repeat(20)
    const root = tmpRepo(f)
    const st: string[] = []
    await engine.openWorkspace(root, (s) => st.push(s.state), { debounceMs: 30 })
    const r = await q('token')
    expect(r.matches.length).toBeGreaterThanOrEqual(0) // must simply not hang or throw
    await until(async () => st.at(-1), (s) => s === 'ready')
  })
})

describe('watcher incremental reindex', () => {
  it('create / modify / delete / rename / new dir / ignored file', async () => {
    const root = await indexed({ '.gitignore': 'ignored.ts\n', 'a.ts': 'const alpha = 1\n' })
    const find = (s: string) => files(s)
    expect(await find('alpha')).toEqual(['a.ts'])

    writeFileSync(join(root, 'new.ts'), 'const zebraCreated = 1\n')
    await until(() => find('zebracreated'), (f) => f.length === 1)
    expect(await find('zebracreated')).toEqual(['new.ts'])

    writeFileSync(join(root, 'new.ts'), 'const giraffeModified = 1\n')
    await until(() => find('giraffemodified'), (f) => f.length === 1)
    expect(await find('zebracreated')).toEqual([]) // old content gone

    appendFileSync(join(root, 'a.ts'), 'const appendedLine = 2\n')
    await until(() => find('appendedline'), (f) => f.length === 1)
    expect((await q('appendedline')).matches[0].line).toBe(2)

    rmSync(join(root, 'new.ts'))
    await until(() => find('giraffemodified'), (f) => f.length === 0)

    renameSync(join(root, 'a.ts'), join(root, 'renamed.ts'))
    await until(() => find('alpha'), (f) => f[0] === 'renamed.ts')
    expect(await find('alpha')).toEqual(['renamed.ts'])

    mkdirSync(join(root, 'newdir/inner'), { recursive: true })
    writeFileSync(join(root, 'newdir/inner/deep.ts'), 'const hippoDeep = 1\n')
    await until(() => find('hippodeep'), (f) => f.length === 1)
    rmSync(join(root, 'newdir'), { recursive: true })
    await until(() => find('hippodeep'), (f) => f.length === 0)

    writeFileSync(join(root, 'ignored.ts'), 'const rhinoIgnored = 1\n')
    writeFileSync(join(root, 'sentinel.ts'), 'const sentinelDone = 1\n')
    await until(() => find('sentineldone'), (f) => f.length === 1)
    expect(await find('rhinoignored')).toEqual([])

    mkdirSync(join(root, 'node_modules/x'), { recursive: true })
    writeFileSync(join(root, 'node_modules/x/i.js'), 'const lemurNodeModules = 1\n')
    writeFileSync(join(root, 'sentinel2.ts'), 'const sentinelTwo = 1\n')
    await until(() => find('sentineltwo'), (f) => f.length === 1)
    expect(await find('lemurnodemodules')).toEqual([])
  })
  it('editing .gitignore triggers re-evaluation', async () => {
    const root = await indexed({ '.gitignore': '', 'p.ts': 'const pandaFile = 1\n' })
    expect(await files('pandafile')).toEqual(['p.ts'])
    writeFileSync(join(root, '.gitignore'), 'p.ts\n')
    await until(() => files('pandafile'), (f) => f.length === 0)
  })
  it('status event is emitted after a watcher update', async () => {
    const root = tmpRepo({ 'a.ts': 'x\n' })
    const { statuses } = await openAndWait(root)
    await new Promise((r) => setTimeout(r, 300))
    const n = statuses.length
    writeFileSync(join(root, 'b.ts'), 'y\nz\n')
    await until(async () => statuses.at(-1), (s) => !!s && s.files === 2 && s.lines === 3 && statuses.length > n)
  })
})

describe('cancellation', () => {
  it('Searcher aborts when isCancelled flips', () => {
    const st = new Store()
    st.addFile('f.txt', Buffer.from('word\n'.repeat(200_000)))
    let calls = 0
    const r = new Searcher(st).search('word', false, 10, () => ++calls > 2)
    expect(r.cancelled).toBe(true)
    expect(r.matches).toEqual([])
    expect(calls).toBeLessThan(10)
  })
  it('stale queries sent to the worker are skipped; the latest returns correct results', async () => {
    const f: Record<string, string> = {}
    for (let i = 0; i < 300; i++) f[`d/f${i}.ts`] = Array.from({ length: 1000 }, (_, j) => `const value${j} = common${i}`).join('\n') + '\n'
    const root = tmpRepo(f)
    await openAndWait(root)
    const t0 = performance.now()
    await q('common value')
    const single = performance.now() - t0
    const ps = Array.from({ length: 30 }, (_, i) => q(i === 29 ? 'common299 value5' : 'common value' + i))
    const tAll0 = performance.now()
    const res = await Promise.all(ps)
    const all = performance.now() - tAll0
    const last = res[29]
    expect(last.matches[0].file).toBe('d/f299.ts')
    expect(last.matches[0].text).toContain('value5 ')
    const empties = res.slice(0, 29).filter((r) => r.matches.length === 0).length
    expect(empties).toBeGreaterThan(0) // some were cancelled outright
    console.log(`cancel: single=${single.toFixed(1)}ms, 30 queued=${all.toFixed(1)}ms, cancelled-empty=${empties}/29`)
    expect(all).toBeLessThan(single * 30 * 0.8 + 50)
  })
  it('ids are echoed back, and search with no workspace is empty', async () => {
    await engine.dispose()
    const r = await engine.search({ id: 'abc', query: 'x', maxResults: 5 })
    expect(r).toMatchObject({ id: 'abc', matches: [] })
  })
})
