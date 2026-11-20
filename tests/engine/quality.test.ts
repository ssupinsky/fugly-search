import { beforeAll, describe, expect, it } from 'vitest'
import { Searcher } from '../../src/main/search/core'
import { Store } from '../../src/main/search/store'
import { FIXTURE } from './fixture'

let S: Searcher
const run = (q: string, cs = false) => S.search(q, cs, 50)

beforeAll(() => {
  const st = new Store()
  for (const [p, c] of Object.entries(FIXTURE)) st.addFile(p, Buffer.from(c))
  S = new Searcher(st)
})

// [query, expected file, substring the top line must contain]
const CASES: [string, string, string][] = [
  ['createAuthToken', 'src/auth/authService.ts', 'createAuthToken(userId'],
  ['auth token', 'src/auth/authService.ts', 'createAuthToken'],
  ['token auth', 'src/auth/authService.ts', 'createAuthToken'],
  ['refresh token', 'src/auth/authService.ts', 'refreshToken'],
  ['invalid credentials', 'src/auth/authService.ts', "invalid credentials"],
  ['revoke', 'src/auth/tokenStore.ts', 'revoke(userId'],
  ['default port', 'src/http/server.ts', 'DEFAULT_PORT = 8080'],
  ['start server', 'src/http/server.ts', 'startServer'],
  ['api health', 'src/http/routes.ts', '/api/health'],
  ['connection pool', 'src/db/connection.ts', 'getConnectionPool'],
  ['close pool', 'src/db/connection.ts', 'closeConnectionPool'],
  ['migration table', 'src/db/migrations.ts', 'MIGRATION_TABLE'],
  ['run migrations', 'src/db/migrations.ts', 'runMigrations'],
  ['capitalize', 'src/utils/stringUtils.ts', 'capitalizeFirstLetter'],
  ['snake camel', 'src/utils/stringUtils.ts', 'snake_case_to_camelCase'],
  ['snakeCase', 'src/utils/stringUtils.ts', 'snake_case_to_camelCase'],
  ['ellipsis', 'src/utils/stringUtils.ts', 'truncateWithEllipsis'],
  ['parse iso date', 'src/utils/dateUtils.ts', 'parseISODate'],
  ['add days', 'src/utils/dateUtils.ts', 'addDays'],
  ['profile card', 'src/ui/UserProfileCard.tsx', 'UserProfileCard'],
  ['display name', 'src/ui/UserProfileCard.tsx', 'displayName'],
  ['lru cache', 'src/cache/lruCache.ts', 'LruCache'],
  ['concurrency', 'src/queue/jobQueue.ts', 'concurrency'],
  ['enqueue job', 'src/queue/jobQueue.ts', 'enqueue'],
  ['oldest keys', 'src/cache/lruCache.ts', 'oldest'],
  ['surface hover', 'src/ui/theme.css', 'surface-hover'],
  ['pool_size', 'config/settings.yaml', 'pool_size'],
  ['info level', 'config/settings.yaml', 'level'],
  // typo tolerant / partial / subsequence
  ['refersh token', 'src/auth/authService.ts', 'refreshToken'],
  ['conection pool', 'src/db/connection.ts', 'ConnectionPool'],
  ['usrprofilecrd', 'src/ui/UserProfileCard.tsx', 'UserProfileCard']
]

describe('ranking quality (top-1)', () => {
  for (const [q, file, sub] of CASES) {
    it(`"${q}" -> ${file}`, () => {
      const r = run(q)
      expect(r.matches.length, 'has results').toBeGreaterThan(0)
      const top = r.matches[0]
      expect({ file: top.file, ok: top.text.includes(sub), text: top.text }).toMatchObject({ file, ok: true })
    })
  }
  it('has at least 20 cases', () => expect(CASES.length).toBeGreaterThanOrEqual(20))
})

describe('matching semantics', () => {
  it('all words must match, any order', () => {
    const r = run('token create')
    expect(r.matches.every((m) => /token/i.test(m.text) && /create/i.test(m.text))).toBe(true)
    expect(r.matches.length).toBeGreaterThan(0)
  })
  it('prefix / partial words', () => {
    expect(run('refr').matches[0].text).toContain('refresh')
  })
  it('camelCase query matches snake_case text and vice versa', () => {
    expect(run('pool_size').matches.some((m) => m.file === 'config/settings.yaml')).toBe(true)
    expect(run('poolSize').matches.some((m) => m.file === 'config/settings.yaml')).toBe(true)
    expect(run('MigrationTable').matches[0].text).toContain('MIGRATION_TABLE')
  })
  it('no match returns nothing, empty query returns nothing', () => {
    expect(run('qqqzzzxxxwww').matches).toEqual([])
    expect(run('   ').matches).toEqual([])
  })
  it('case sensitive mode', () => {
    expect(run('AuthService', true).matches.every((m) => m.text.includes('AuthService'))).toBe(true)
    expect(run('authservice', true).matches.length).toBe(0)
  })
  it('typo tier is only used when nothing matches strictly', () => {
    expect(run('token refersh').matches.length).toBeGreaterThan(0)
    const exact = run('refresh').matches
    expect(exact.every((m) => /refresh/i.test(m.text))).toBe(true)
  })
  it('typo-tier scores never exceed strict-tier floor and are sorted', () => {
    const r = run('refersh token').matches
    for (let i = 1; i < r.length; i++) expect(r[i].score).toBeLessThanOrEqual(r[i - 1].score)
  })
  it('filename bonus: file name match beats equal content match', () => {
    const r = run('tokenstore')
    expect(r.matches[0].file).toBe('src/auth/tokenStore.ts')
  })
  it('matchRanges highlight the matched text', () => {
    const m = run('refresh token').matches[0]
    const hl = m.matchRanges.map(([a, b]) => m.text.slice(a, b).toLowerCase())
    expect(hl.join('|')).toContain('refresh')
    expect(hl.join('|')).toContain('token')
    for (const [a, b] of m.matchRanges) expect(a).toBeLessThan(b)
  })
  it('matchRanges are correct with non-ASCII text', () => {
    const st = new Store()
    st.addFile('u.txt', Buffer.from('héllo wörld — naïve café token\n'))
    const m = new Searcher(st).search('café token', false, 5).matches[0]
    expect(m.matchRanges.map(([a, b]) => m.text.slice(a, b))).toEqual(['café', 'token'])
  })
  it('line numbers are 1-based and correct', () => {
    const m = run('DEFAULT_PORT = 8080').matches[0]
    expect(m.line).toBe(4)
  })
  it('ranges merge and are sorted', () => {
    const m = run('auth token').matches[0]
    for (let i = 1; i < m.matchRanges.length; i++) expect(m.matchRanges[i][0]).toBeGreaterThanOrEqual(m.matchRanges[i - 1][1])
  })
})

describe('incremental narrowing', () => {
  it('typing char by char gives identical results to a cold search', () => {
    const query = 'refresh token'
    for (let i = 1; i <= query.length; i++) {
      const partial = query.slice(0, i)
      const warm = run(partial)
      const cold = new Searcher(S.store).search(partial, false, 50)
      expect(warm.matches.map((m) => m.file + ':' + m.line)).toEqual(cold.matches.map((m) => m.file + ':' + m.line))
    }
    expect(run('refresh token').incremental).toBe(true)
  })
  it('cache is invalidated by store mutation', () => {
    const st = new Store()
    st.addFile('a.txt', Buffer.from('hello world\n'))
    const s = new Searcher(st)
    expect(s.search('hello', false, 5).matches.length).toBe(1)
    st.addFile('b.txt', Buffer.from('hello there\n'))
    expect(s.search('hello', false, 5).matches.length).toBe(2)
    st.removeFile('a.txt')
    expect(s.search('hello', false, 5).matches.length).toBe(1)
  })
  it('compaction keeps results correct', () => {
    const st = new Store()
    for (let i = 0; i < 400; i++) st.addFile(`f${i}.txt`, Buffer.from(Array.from({ length: 1000 }, (_, j) => `line ${i} ${j} marker${i}`).join('\n')))
    for (let i = 0; i < 300; i++) st.removeFile(`f${i}.txt`)
    const r = new Searcher(st).search('marker350', false, 5000)
    expect(r.matches.length).toBe(1000)
    expect(st.liveFiles).toBe(100)
    expect(st.nLines).toBeLessThan(400_000)
  })
})
