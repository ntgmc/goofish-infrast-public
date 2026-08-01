import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveProfileInTransaction } from './cdk-redemption'
import { closePool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  lockSklandUidProfilesInTransaction,
  recordSklandUidMismatchInTransaction,
} from './skland-binding-store'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  insertUserAccountForRegistration,
  updateProfileWorkspaceInTransaction,
  type UserAccountRecord,
  type UserGameAccountRecord,
} from './user-store'

let container: StartedPostgreSqlContainer | undefined

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('truncate table user_accounts cascade')
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('Skland binding PostgreSQL invariants', () => {
  it('serializes two users claiming the same previously unseen UID', async () => {
    const firstUser = await seedUser('skland-concurrency-first@example.test')
    const secondUser = await seedUser('skland-concurrency-second@example.test')
    const uid = '130761348'

    const bind = (user: UserAccountRecord) => withTransaction(async (client) => {
      const existing = await lockSklandUidProfilesInTransaction(client, uid)
      if (existing.some((profile) => profile.user_id !== user.id)) throw new Error('skland_uid_owned')
      const profile = profileRecord(user.id)
      profile.skland_binding = {
        uid,
        nickname: 'Doctor',
        channel_name: '官服',
        bound_at: profile.created_at,
        last_imported_at: profile.created_at,
        encrypted_cred: 'encrypted-test-credential',
        credential_status: 'available',
      }
      await saveProfileInTransaction(client, profile)
      return profile.id
    })

    const results = await Promise.allSettled([bind(firstUser), bind(secondUser)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const bound = await query<{ total: string }>(
      `select count(*)::text as total from user_game_accounts
        where record_json->'skland_binding'->>'uid' = $1`,
      [uid],
    )
    expect(Number(bound.rows[0]?.total)).toBe(1)
  })

  it('atomically counts three concurrent mismatches and freezes on the third', async () => {
    const user = await seedUser('skland-mismatch@example.test')
    const profile = profileRecord(user.id)
    await withTransaction((client) => saveProfileInTransaction(client, profile))

    await Promise.all(Array.from({ length: 3 }, (_, index) => withTransaction((client) => (
      recordSklandUidMismatchInTransaction(client, {
        userId: user.id,
        profileId: profile.id,
        uid: `wrong-${index}`,
        nickname: `Wrong ${index}`,
        freezeThreshold: 3,
        now: new Date(Date.now() + index).toISOString(),
      })
    ))))

    const stored = await getProfileForUser(user.id, profile.id)
    expect(stored?.skland_risk?.uid_mismatch_count).toBe(3)
    expect(stored?.status).toBe('frozen')
  })

  it('rolls back workspace and profile binding when the transaction fails after both writes', async () => {
    const user = await seedUser('skland-rollback@example.test')
    const profile = profileRecord(user.id)
    await withTransaction(async (client) => {
      await saveProfileInTransaction(client, profile)
      await updateProfileWorkspaceInTransaction(client, profile.id, () => emptyWorkspace(profile.id))
    })

    await expect(withTransaction(async (client) => {
      await updateProfileWorkspaceInTransaction(client, profile.id, (workspace) => ({
        ...(workspace ?? emptyWorkspace(profile.id)),
        operators: [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 5 }],
        updated_at: '2026-08-01T00:00:00.000Z',
      }))
      await saveProfileInTransaction(client, {
        ...profile,
        skland_binding: {
          uid: '12345678',
          nickname: 'Doctor',
          channel_name: '官服',
          bound_at: '2026-08-01T00:00:00.000Z',
          last_imported_at: '2026-08-01T00:00:00.000Z',
          encrypted_cred: 'encrypted-test-credential',
          credential_status: 'available',
        },
        updated_at: '2026-08-01T00:00:00.000Z',
      })
      throw new Error('injected post-write failure')
    })).rejects.toThrow('injected post-write failure')

    expect((await getProfileForUser(user.id, profile.id))?.skland_binding).toBeFalsy()
    expect((await getProfileWorkspace(profile.id))?.operators).toBeNull()
  })
})

async function seedUser(email: string): Promise<UserAccountRecord> {
  const now = new Date().toISOString()
  const user: UserAccountRecord = {
    version: 1,
    id: randomUUID(),
    email,
    password_hash: `${randomUUID()}-hash`,
    salt: 'test-salt',
    iterations: 1,
    password_algorithm: 'pbkdf2-sha256',
    permission: 'advanced',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: now,
    created_at: now,
    updated_at: now,
  }
  await insertUserAccountForRegistration(user)
  return user
}

function profileRecord(userId: string): UserGameAccountRecord {
  const now = new Date().toISOString()
  return {
    version: 1,
    id: randomUUID(),
    user_id: userId,
    kind: 'cdk',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'advanced',
    status: 'active',
    display_name: 'Skland test profile',
    note: '',
    skland_binding: null,
    skland_pending_binding: null,
    skland_risk: null,
    created_at: now,
    updated_at: now,
  }
}
