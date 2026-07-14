import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { createPostgresOptimizeJobStore, OptimizeJobAdmissionError } from './optimize-job-store'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('PostgreSQL optimization job admission', () => {
  it('allows exactly one concurrent free job and reserves its entitlement once', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
    }))))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof OptimizeJobAdmissionError)).toHaveLength(7)
    expect((await query<{ count: string }>("select count(*)::text as count from optimize_jobs where owner_key = $1", [`profile:${profileId}`])).rows[0]?.count).toBe('1')
    expect((await query<{ count: string }>("select count(*)::text as count from entitlement_ledger where profile_id = $1 and entitlement_type = 'free_schedule'", [profileId])).rows[0]?.count).toBe('1')
  })

  it('replays an idempotent submit and limits a paid owner to three queued jobs', async () => {
    const store = createPostgresOptimizeJobStore()
    const owner = `license:${randomUUID()}`
    const first = input({ owner_key: owner, idempotency_key: 'replay-key' })
    const admitted = await store.admitJob(first)
    const replayed = await store.admitJob({ ...first, id: randomUUID() })
    expect(replayed).toMatchObject({ replayed: true, job: { id: admitted.job.id } })

    await store.admitJob(input({ owner_key: owner }))
    await store.admitJob(input({ owner_key: owner }))
    await expect(store.admitJob(input({ owner_key: owner }))).rejects.toMatchObject({ code: 'queue_capacity_exceeded', status: 429 })
  })
})

function input(overrides: Partial<Parameters<ReturnType<typeof createPostgresOptimizeJobStore>['admitJob']>[0]> = {}) {
  return {
    id: randomUUID(),
    priority: 10,
    owner_key: `license:${randomUUID()}`,
    permission: 'growth',
    source: 'license_file',
    payload_json: { test: true },
    idempotency_key: randomUUID(),
    request_hash: randomUUID(),
    ...overrides,
  }
}

async function seedProfile(): Promise<string> {
  const userId = randomUUID()
  const profileId = randomUUID()
  await query(
    `insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
     values ($1, $2, 'hash', 'salt', 1, 'free_preview', 'active', $3::jsonb, now(), now())`,
    [userId, `${userId}@example.test`, JSON.stringify({ id: userId })],
  )
  await query(
    `insert into user_game_accounts (id, user_id, permission, status, display_name, note, record_json, created_at, updated_at)
     values ($1, $2, 'free_preview', 'active', 'Free', '', $3::jsonb, now(), now())`,
    [profileId, userId, JSON.stringify({ id: profileId, user_id: userId })],
  )
  return profileId
}
