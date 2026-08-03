import { afterEach, describe, expect, it } from 'vitest'
import {
  closePool,
  getPool,
  resolvePostgresConnectionTimeoutMs,
  resolvePostgresHealthQueryTimeoutMs,
  resolvePostgresIdleTransactionTimeoutMs,
  resolvePostgresLockTimeoutMs,
  resolvePostgresPoolMax,
  resolvePostgresQueryTimeoutMs,
  resolvePostgresStatementTimeoutMs,
} from './postgres'

const originalDatabaseUrl = process.env.DATABASE_URL
const originalConnectionTimeout = process.env.POSTGRES_CONNECTION_TIMEOUT_MS
const originalPoolMax = process.env.POSTGRES_POOL_MAX
const originalStatementTimeout = process.env.POSTGRES_STATEMENT_TIMEOUT_MS
const originalQueryTimeout = process.env.POSTGRES_QUERY_TIMEOUT_MS
const originalLockTimeout = process.env.POSTGRES_LOCK_TIMEOUT_MS
const originalIdleTransactionTimeout = process.env.POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS
const originalHealthQueryTimeout = process.env.POSTGRES_HEALTH_QUERY_TIMEOUT_MS

afterEach(async () => {
  await closePool()
  restoreEnvironment('DATABASE_URL', originalDatabaseUrl)
  restoreEnvironment('POSTGRES_CONNECTION_TIMEOUT_MS', originalConnectionTimeout)
  restoreEnvironment('POSTGRES_POOL_MAX', originalPoolMax)
  restoreEnvironment('POSTGRES_STATEMENT_TIMEOUT_MS', originalStatementTimeout)
  restoreEnvironment('POSTGRES_QUERY_TIMEOUT_MS', originalQueryTimeout)
  restoreEnvironment('POSTGRES_LOCK_TIMEOUT_MS', originalLockTimeout)
  restoreEnvironment('POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS', originalIdleTransactionTimeout)
  restoreEnvironment('POSTGRES_HEALTH_QUERY_TIMEOUT_MS', originalHealthQueryTimeout)
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
    process.env.POSTGRES_POOL_MAX = '12'
    process.env.POSTGRES_STATEMENT_TIMEOUT_MS = '20000'
    process.env.POSTGRES_QUERY_TIMEOUT_MS = '25000'
    process.env.POSTGRES_LOCK_TIMEOUT_MS = '4000'
    process.env.POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS = '12000'

    const pool = getPool() as ReturnType<typeof getPool> & {
      options: {
        max?: number
        connectionTimeoutMillis?: number
        statement_timeout?: number
        query_timeout?: number
        lock_timeout?: number
        idle_in_transaction_session_timeout?: number
      }
    }

    expect(pool.options.max).toBe(12)
    expect(pool.options.connectionTimeoutMillis).toBe(15_000)
    expect(pool.options.statement_timeout).toBe(20_000)
    expect(pool.options.query_timeout).toBe(25_000)
    expect(pool.options.lock_timeout).toBe(4_000)
    expect(pool.options.idle_in_transaction_session_timeout).toBe(12_000)
  })

  it.each(['0', '999', '60001', '1.5', 'invalid'])(
    'rejects an invalid connection timeout: %s',
    (configured) => {
      expect(() => resolvePostgresConnectionTimeoutMs({
        POSTGRES_CONNECTION_TIMEOUT_MS: configured,
      })).toThrow('POSTGRES_CONNECTION_TIMEOUT_MS must be an integer between 1000 and 60000')
    },
  )

  it('uses finite defaults for pool and execution deadlines', () => {
    expect(resolvePostgresPoolMax({})).toBe(10)
    expect(resolvePostgresStatementTimeoutMs({})).toBe(25_000)
    expect(resolvePostgresQueryTimeoutMs({})).toBe(30_000)
    expect(resolvePostgresLockTimeoutMs({})).toBe(5_000)
    expect(resolvePostgresIdleTransactionTimeoutMs({})).toBe(15_000)
    expect(resolvePostgresHealthQueryTimeoutMs({})).toBe(3_000)
  })

  it('accepts execution deadline boundary values', () => {
    expect(resolvePostgresPoolMax({ POSTGRES_POOL_MAX: '1' })).toBe(1)
    expect(resolvePostgresPoolMax({ POSTGRES_POOL_MAX: '100' })).toBe(100)
    expect(resolvePostgresStatementTimeoutMs({ POSTGRES_STATEMENT_TIMEOUT_MS: '120000' })).toBe(120_000)
    expect(resolvePostgresQueryTimeoutMs({ POSTGRES_QUERY_TIMEOUT_MS: '1000' })).toBe(1_000)
    expect(resolvePostgresLockTimeoutMs({ POSTGRES_LOCK_TIMEOUT_MS: '100' })).toBe(100)
    expect(resolvePostgresIdleTransactionTimeoutMs({ POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS: '120000' })).toBe(120_000)
    expect(resolvePostgresHealthQueryTimeoutMs({ POSTGRES_HEALTH_QUERY_TIMEOUT_MS: '250' })).toBe(250)
  })

  it.each(['0', '101', '-1', '1.5', 'NaN', 'Infinity'])(
    'rejects an invalid pool maximum: %s',
    (configured) => expect(() => resolvePostgresPoolMax({ POSTGRES_POOL_MAX: configured }))
      .toThrow('POSTGRES_POOL_MAX must be an integer between 1 and 100'),
  )

  it.each([
    () => resolvePostgresStatementTimeoutMs({ POSTGRES_STATEMENT_TIMEOUT_MS: 'Infinity' }),
    () => resolvePostgresQueryTimeoutMs({ POSTGRES_QUERY_TIMEOUT_MS: '-1' }),
    () => resolvePostgresLockTimeoutMs({ POSTGRES_LOCK_TIMEOUT_MS: '60001' }),
    () => resolvePostgresIdleTransactionTimeoutMs({ POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS: '1.5' }),
    () => resolvePostgresHealthQueryTimeoutMs({ POSTGRES_HEALTH_QUERY_TIMEOUT_MS: '10001' }),
  ])('rejects an invalid PostgreSQL execution timeout', (resolveInvalid) => {
    expect(resolveInvalid).toThrow(/must be an integer between/)
  })
})

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
