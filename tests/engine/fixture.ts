// A small realistic mini-repo used for ranking-quality tests.
export const FIXTURE: Record<string, string> = {
  'src/auth/authService.ts': `import { hash, compare } from 'bcrypt'
import { TokenStore } from './tokenStore'

export class AuthService {
  constructor(private readonly store: TokenStore) {}

  async login(email: string, password: string): Promise<string> {
    const user = await this.findUserByEmail(email)
    if (!user) throw new Error('invalid credentials')
    const ok = await compare(password, user.passwordHash)
    if (!ok) throw new Error('invalid credentials')
    return this.createAuthToken(user.id)
  }

  createAuthToken(userId: string): string {
    const token = signJwt({ sub: userId }, { expiresIn: '1h' })
    this.store.save(userId, token)
    return token
  }

  async refreshToken(oldToken: string): Promise<string> {
    const payload = verifyJwt(oldToken)
    return this.createAuthToken(payload.sub)
  }

  async logout(userId: string): Promise<void> {
    await this.store.revoke(userId)
  }
}
`,
  'src/auth/tokenStore.ts': `export class TokenStore {
  private tokens = new Map<string, string>()

  save(userId: string, token: string): void {
    this.tokens.set(userId, token)
  }

  revoke(userId: string): void {
    this.tokens.delete(userId)
  }

  has(userId: string): boolean {
    return this.tokens.has(userId)
  }
}
`,
  'src/http/server.ts': `import express from 'express'
import { registerRoutes } from './routes'

const DEFAULT_PORT = 8080

export function startServer(port = DEFAULT_PORT) {
  const app = express()
  app.use(express.json())
  registerRoutes(app)
  app.listen(port, () => console.log('listening on port ' + port))
  return app
}
`,
  'src/http/routes.ts': `import type { Express } from 'express'
import { AuthService } from '../auth/authService'

export function registerRoutes(app: Express) {
  app.post('/api/login', async (req, res) => {
    const token = await auth.login(req.body.email, req.body.password)
    res.json({ token })
  })
  app.get('/api/health', (_req, res) => res.send('ok'))
  app.delete('/api/session', handleLogout)
}
`,
  'src/db/connection.ts': `import { Pool } from 'pg'

let pool: Pool | null = null

export function getConnectionPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
  }
  return pool
}

export async function closeConnectionPool(): Promise<void> {
  await pool?.end()
  pool = null
}
`,
  'src/db/migrations.ts': `export const MIGRATION_TABLE = 'schema_migrations'

export async function runMigrations(pool: Pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text primary key)')
  const applied = await loadAppliedMigrations(pool)
  for (const m of pending(applied)) await applyMigration(pool, m)
}
`,
  'src/utils/stringUtils.ts': `export function capitalizeFirstLetter(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function snake_case_to_camelCase(input: string): string {
  return input.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function truncateWithEllipsis(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
`,
  'src/utils/dateUtils.ts': `export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function parseISODate(input: string): Date {
  return new Date(input)
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
`,
  'src/ui/UserProfileCard.tsx': `import React from 'react'

export function UserProfileCard({ user }: { user: User }) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <div className="profile-card" onClick={() => setExpanded(!expanded)}>
      <h2>{user.displayName}</h2>
      {expanded && <p>{user.bio}</p>}
    </div>
  )
}
`,
  'src/ui/theme.css': `.profile-card {
  background-color: var(--surface);
  border-radius: 8px;
  padding: 16px;
}
.profile-card:hover {
  background-color: var(--surface-hover);
}
`,
  'src/cache/lruCache.ts': `export class LruCache<K, V> {
  private map = new Map<K, V>()
  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value
      this.map.delete(oldest as K)
    }
    this.map.set(key, value)
  }
}
`,
  'src/queue/jobQueue.ts': `type Job = () => Promise<void>

export class JobQueue {
  private jobs: Job[] = []
  private running = 0

  constructor(private readonly concurrency = 4) {}

  enqueue(job: Job): void {
    this.jobs.push(job)
    this.drain()
  }

  private drain(): void {
    while (this.running < this.concurrency && this.jobs.length) {
      const job = this.jobs.shift()!
      this.running++
      void job().finally(() => {
        this.running--
        this.drain()
      })
    }
  }
}
`,
  'README.md': `# Sample service

This service exposes a REST API with authentication using JWT tokens.

## Running

Run \`npm start\` and open http://localhost:8080
`,
  'config/settings.yaml': `server:
  port: 8080
  host: 0.0.0.0
database:
  pool_size: 10
  timeout_ms: 5000
logging:
  level: info
`,
  'tests/authService.test.ts': `import { AuthService } from '../src/auth/authService'

describe('AuthService', () => {
  it('rejects an invalid password', async () => {
    await expect(svc.login('a@b.c', 'nope')).rejects.toThrow('invalid credentials')
  })
  it('creates a token on login', async () => {
    const token = await svc.login('a@b.c', 'secret')
    expect(token).toBeTruthy()
  })
})
`
}
