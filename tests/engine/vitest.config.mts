import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  test: { include: ['tests/engine/**/*.test.ts'], testTimeout: 120000, hookTimeout: 120000, pool: 'forks', globalSetup: ['tests/engine/globalSetup.ts'], fileParallelism: false }
})
