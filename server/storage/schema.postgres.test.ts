import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, getPool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('PostgreSQL schema migration', () => {
  it('permanently trims existing workspace JSON to the newest 3 configurations and 5 results', async () => {
    const profile = await seedProfile()
    const savedConfigs = Array.from({ length: 4 }, (_, index) => ({ id: `config-${index + 1}` }))
    const resultHistory = Array.from({ length: 6 }, (_, index) => ({ id: `result-${index + 1}` }))
    const workspace = {
      version: 1,
      profile_id: profile.profileId,
      saved_configs: savedConfigs,
      result_history: resultHistory,
      updated_at: '2026-07-23T00:00:00.000Z',
    }

    try {
      await query(
        `insert into user_profile_workspaces
          (profile_id, elite_overrides_json, record_json, updated_at)
         values ($1, '{}'::jsonb, $2::jsonb, now())`,
        [profile.profileId, JSON.stringify(workspace)],
      )

      await migrateDatabaseSchema()

      const afterFirstMigration = await readWorkspace(profile.profileId)
      expect(afterFirstMigration.saved_configs.map((item) => item.id)).toEqual(['config-1', 'config-2', 'config-3'])
      expect(afterFirstMigration.result_history.map((item) => item.id)).toEqual([
        'result-1',
        'result-2',
        'result-3',
        'result-4',
        'result-5',
      ])

      await migrateDatabaseSchema()

      const afterSecondMigration = await readWorkspace(profile.profileId)
      expect(afterSecondMigration.saved_configs.map((item) => item.id)).toEqual(['config-1', 'config-2', 'config-3'])
      expect(afterSecondMigration.result_history.map((item) => item.id)).toEqual([
        'result-1',
        'result-2',
        'result-3',
        'result-4',
        'result-5',
      ])
    } finally {
      await query('delete from user_accounts where id = $1', [profile.userId])
    }
  })

  it('releases earlier phase locks before a later migration phase waits', async () => {
    const blocker = await getPool().connect()
    let blockerInTransaction = false
    let migration: Promise<void> | null = null
    try {
      await blocker.query('begin')
      blockerInTransaction = true
      await blocker.query('lock table reward_grants in access share mode')

      migration = migrateDatabaseSchema()
      await waitForBlockedRewardMigration()

      const earlierLocks = await query<{ lock_count: string }>(
        `select count(*)::text as lock_count
         from pg_locks
         where relation = 'cdk_records'::regclass
           and granted`,
      )
      expect(Number(earlierLocks.rows[0]?.lock_count ?? -1)).toBe(0)

      await blocker.query("set local lock_timeout = '2s'")
      await expect(blocker.query('lock table cdk_records in access exclusive mode')).resolves.toBeDefined()
      await blocker.query('commit')
      blockerInTransaction = false

      await migration
    } finally {
      if (blockerInTransaction) await blocker.query('rollback')
      blocker.release()
      if (migration) await migration
    }
  })
})

async function waitForBlockedRewardMigration(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_stat_activity
         where datname = current_database()
           and pid <> pg_backend_pid()
           and wait_event_type = 'Lock'
           and query like '%ALTER TABLE reward_grants ADD COLUMN%'
       ) as waiting`,
    )
    if (waiting.rows[0]?.waiting) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Migration did not block on the reward_grants phase')
}

async function readWorkspace(profileId: string): Promise<StoredWorkspaceRecord> {
  const result = await query<{ record_json: StoredWorkspaceRecord }>(
    'select record_json from user_profile_workspaces where profile_id = $1',
    [profileId],
  )
  const workspace = result.rows[0]?.record_json
  if (!workspace) throw new Error('Expected the seeded workspace to exist.')
  return workspace
}

async function seedProfile(): Promise<{ userId: string; profileId: string }> {
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
  return { userId, profileId }
}

type StoredWorkspaceRecord = {
  saved_configs: Array<{ id: string }>
  result_history: Array<{ id: string }>
}
