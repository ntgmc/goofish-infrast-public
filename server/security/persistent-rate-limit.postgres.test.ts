import { createHash, randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query } from '../storage/postgres'
import { ensureDatabaseSchema } from '../storage/schema'
import { reservePersistentRateLimit } from './persistent-rate-limit'

let container: StartedPostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('persistent security rate limits', () => {
  it('does not over-admit concurrent reservations', async () => {
    const identity = `concurrent-${randomUUID()}`
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => reservePersistentRateLimit('test-concurrent', identity, 5, 60_000)),
    )
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5)
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(5)
  })

  it('refunds a successful attempt in the same window', async () => {
    const identity = `refund-${randomUUID()}`
    const first = await reservePersistentRateLimit('test-refund', identity, 1, 60_000)
    expect(first.allowed).toBe(true)
    if (!first.allowed) throw new Error('expected the first reservation to be allowed')
    await first.attempt.refund()
    expect((await reservePersistentRateLimit('test-refund', identity, 1, 60_000)).allowed).toBe(true)
  })

  it('starts a fresh counter after expiry', async () => {
    const identity = `expiry-${randomUUID()}`
    const namespace = 'test-expiry'
    expect((await reservePersistentRateLimit(namespace, identity, 1, 60_000)).allowed).toBe(true)
    expect((await reservePersistentRateLimit(namespace, identity, 1, 60_000)).allowed).toBe(false)
    const keyHash = createHash('sha256').update(`${namespace}\0${identity}`).digest('hex')
    await query('update security_rate_limit_buckets set expires_at = now() - interval \'1 second\' where key_hash = $1', [keyHash])
    expect((await reservePersistentRateLimit(namespace, identity, 1, 60_000)).allowed).toBe(true)
  })
})
