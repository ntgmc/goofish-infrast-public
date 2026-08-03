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
  saveUserProfileByAdmin,
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
  await query('truncate table user_accounts, cdk_records, admin_operation_audit cascade')
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

  it('rolls back profile, linked CDK, and audit when the final audit write fails', async () => {
    const user = await seedUser('admin-profile-rollback@example.test')
    const profile = profileRecord(user.id)
    const now = new Date().toISOString()
    const codeHash = randomUUID().replaceAll('-', '')
    const cdkKey = `cdk/${codeHash}.json`
    const baseline = { hash: 'baseline-before', owned_count: 20, operators: {} }
    profile.cdk_key = cdkKey
    profile.cdk_code_hash = codeHash
    profile.skland_binding = {
      uid: '12345678',
      nickname: 'Doctor',
      channel_name: '官服',
      bound_at: now,
      last_imported_at: now,
      encrypted_cred: 'encrypted-test-credential',
      credential_status: 'available',
    }
    await withTransaction((client) => saveProfileInTransaction(client, profile))
    await query(
      `insert into cdk_records
        (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
       values ($1, $2, 'used', 'advanced', $3, $4::jsonb, $5, $5)`,
      [cdkKey, codeHash, randomUUID(), JSON.stringify({
        version: 1,
        code_hash: codeHash,
        permission: 'advanced',
        status: 'used',
        created_at: now,
        used_at: now,
        order_note: null,
        license_order_hash: randomUUID(),
        operator_count: 20,
        config_desc: null,
        baseline_operator_fingerprint: baseline,
        latest_operator_fingerprint: baseline,
      }), now],
    )
    await query(`
      create function reject_profile_admin_audit() returns trigger language plpgsql as $$
      begin
        if new.actor_username = 'rollback-profile-test' then
          raise exception 'injected admin audit failure';
        end if;
        return new;
      end
      $$
    `)
    await query(`
      create trigger reject_profile_admin_audit
      before insert on admin_operation_audit
      for each row execute function reject_profile_admin_audit()
    `)

    try {
      await expect(saveUserProfileByAdmin({
        ...profile,
        permission: 'growth',
        skland_binding: null,
        updated_at: new Date(Date.parse(profile.updated_at) + 1_000).toISOString(),
      }, {
        expectedUpdatedAt: profile.updated_at,
        linkedCdkPermission: 'growth',
        resetLinkedCdkOperatorBaselineReason: '测试事务回滚。',
        audit: {
          actorUsername: 'rollback-profile-test',
          action: 'profile.atomic_rollback_test',
          targetType: 'profile',
          targetId: profile.id,
          reason: '验证 profile、CDK 与审计共同回滚。',
          requestId: randomUUID(),
        },
      })).rejects.toThrow('injected admin audit failure')
    } finally {
      await query('drop trigger reject_profile_admin_audit on admin_operation_audit')
      await query('drop function reject_profile_admin_audit()')
    }

    const storedProfile = await getProfileForUser(user.id, profile.id)
    const storedCdk = await query<{ permission: string; record_json: Record<string, unknown> }>(
      'select permission, record_json from cdk_records where key = $1',
      [cdkKey],
    )
    expect(storedProfile).toMatchObject({ permission: 'advanced' })
    expect(storedProfile?.skland_binding).toMatchObject({ uid: '12345678' })
    expect(storedCdk.rows[0]?.permission).toBe('advanced')
    expect(storedCdk.rows[0]?.record_json.baseline_operator_fingerprint).toEqual(baseline)
    expect((await query('select 1 from admin_operation_audit where target_id = $1', [profile.id])).rowCount).toBe(0)
  })

  it('rejects a stale administrator workspace clear without changing profile or workspace', async () => {
    const user = await seedUser('admin-workspace-conflict@example.test')
    const profile = profileRecord(user.id)
    await withTransaction(async (client) => {
      await saveProfileInTransaction(client, profile)
      await updateProfileWorkspaceInTransaction(client, profile.id, (workspace) => ({
        ...(workspace ?? emptyWorkspace(profile.id)),
        operators: [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 5 }],
        updated_at: '2026-08-03T01:00:00.000Z',
      }))
    })

    await expect(saveUserProfileByAdmin({
      ...profile,
      note: 'must roll back',
      updated_at: '2026-08-03T02:00:00.000Z',
    }, {
      expectedUpdatedAt: profile.updated_at,
      workspace: emptyWorkspace(profile.id),
      expectedWorkspaceUpdatedAt: '2026-08-03T00:00:00.000Z',
      audit: {
        actorUsername: 'workspace-conflict-test',
        action: 'profile.clear_profile_workspace',
        targetType: 'profile',
        targetId: profile.id,
        reason: '验证过期工作区版本不能覆盖新数据。',
        requestId: randomUUID(),
      },
    })).rejects.toThrow('账号工作区已被其他请求修改，请刷新后重试。')

    expect(await getProfileForUser(user.id, profile.id)).toMatchObject({
      note: '',
      updated_at: profile.updated_at,
    })
    expect((await getProfileWorkspace(profile.id))?.operators).toEqual([
      expect.objectContaining({ id: 'char_002_amiya', own: true }),
    ])
    expect((await query('select 1 from admin_operation_audit where target_id = $1', [profile.id])).rowCount).toBe(0)
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
