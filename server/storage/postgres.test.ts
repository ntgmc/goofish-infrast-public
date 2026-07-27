import { afterEach, describe, expect, it } from 'vitest'
import {
  closePool,
  getPool,
  resolvePostgresConnectionTimeoutMs,
} from './postgres'

const originalDatabaseUrl = process.env.DATABASE_URL
const originalConnectionTimeout = process.env.POSTGRES_CONNECTION_TIMEOUT_MS

afterEach(async () => {
  await closePool()
  restoreEnvironment('DATABASE_URL', originalDatabaseUrl)
  restoreEnvironment('POSTGRES_CONNECTION_TIMEOUT_MS', originalConnectionTimeout)
})

describe('PostgreSQL pool configuration', () => {
  it('uses a finite default connection timeout', () => {
    expect(resolvePostgresConnectionTimeoutMs({})).toBe(10_000)
    expect(resolvePostgresConnectionTimeoutMs({ POSTGRES_CONNECTION_TIMEOUT_MS: '  ' })).toBe(10_000)
  })

  it('accepts connection timeouts within the supported range', () => {
    expect(resolvePostgresConnectionTimeoutMs({ POSTGRES_CONNECTION_TIMEOUT_MS: '1000' })).toBe(1_000)
    expect(resolvePostgresConnectionTimeoutMs({ POSTGRES_CONNECTION_TIMEOUT_MS: '15000' })).toBe(15_000)
    expect(resolvePostgresConnectionTimeoutMs({ POSTGRES_CONNECTION_TIMEOUT_MS: '60000' })).toBe(60_000)
  })

  it('passes the configured connection timeout to the PostgreSQL pool', () => {
    process.env.DATABASE_URL = 'postgresql://invalid.example/test'
    process.env.POSTGRES_CONNECTION_TIMEOUT_MS = '15000'

    const pool = getPool() as ReturnType<typeof getPool> & {
      options: { connectionTimeoutMillis?: number }
    }

    expect(pool.options.connectionTimeoutMillis).toBe(15_000)
  })

  it.each(['0', '999', '60001', '1.5', 'invalid'])(
    'rejects an invalid connection timeout: %s',
    (configured) => {
      expect(() => resolvePostgresConnectionTimeoutMs({
        POSTGRES_CONNECTION_TIMEOUT_MS: configured,
      })).toThrow('POSTGRES_CONNECTION_TIMEOUT_MS must be an integer between 1000 and 60000')
    },
  )
})

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
