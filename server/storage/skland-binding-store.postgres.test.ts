import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LicenseConfig } from '../../src/lib/types'
import { getItemBalance, grantItem, useInventoryItem } from './inventory-store'
import { createLifetimeVoucherProfileAuthorizationInTransaction, saveProfileInTransaction } from './cdk-redemption'
import { closePool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { createPostgresOptimizeJobStore } from './optimize-job-store'
import { selectAuthPayloadProfiles } from '../handlers/auth-payload-profiles'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY } from '../free-preview-trial'
import {
  lockSklandUidProfilesInTransaction,
  recordSklandUidMismatchInTransaction,
} from './skland-binding-store'
import {
  emptyWorkspace,
  getProfileById,
  getProfileForUser,
  getProfileWorkspace,
  insertUserAccountForRegistration,
  listProfilesForUser,
  saveUserProfileByAdmin,
  updateProfileWorkspaceAtomically,
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
  it('merges a preview into the CDK profile without losing data, capacity, claims or authorization', async () => {
    const user = await seedUser('profile-merge@example.test')
    const [preview, cdk] = await seedMergeProfiles(user.id)
    const config = { layout: '2-4-3', desc: 'preview' } as LicenseConfig
    await withTransaction(async (client) => {
      await updateProfileWorkspaceInTransaction(client, preview.id, () => ({
        ...emptyWorkspace(preview.id), config,
        operators: [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 5 }],
        saved_configs: Array.from({ length: 4 }, (_, i) => ({ id: `plan-${i}`, name: `Plan ${i}`,
          config, created_at: preview.created_at, updated_at: preview.created_at, last_used_at: null })),
      }))
      await client.query(`insert into optimization_result_history (profile_id, id, name, created_at, result_json, operator_count, source, archived_at)
        values ($1, 'result-active', 'Active', now(), '{}', 1, 'generated', null),
               ($1, 'result-archived', 'Archived', now(), '{}', 1, 'generated', now())`, [preview.id])
      await client.query(`insert into profile_entitlement_balances (profile_id, entitlement_type, units, updated_at)
        values ($1, 'plan_slots', 2, now()), ($2, 'archive_slots', 3, now())`, [preview.id, cdk.id])
      await client.query(`insert into free_preview_claims (uid_hash, user_id, profile_id, claimed_at, record_json)
        values ('merge-uid-hash', $1, $2, now(), $3::jsonb)`, [user.id, preview.id, JSON.stringify({ profile_id: preview.id })])
    })

    const merged = await listProfilesForUser(user.id)
    expect(merged.map((profile) => profile.id)).toEqual([cdk.id])
    expect(merged[0]).toMatchObject({ kind: 'cdk', permission: cdk.permission, cdk_key: cdk.cdk_key,
      cdk_code_hash: cdk.cdk_code_hash, expires_at: cdk.expires_at, merged_profile_ids: [preview.id] })
    expect(selectAuthPayloadProfiles(merged, preview.id).activeProfileRecord?.id).toBe(cdk.id)
    const workspace = await getProfileWorkspace(cdk.id)
    expect(workspace?.config).toEqual(config)
    expect(workspace?.operators).toHaveLength(1)
    expect(workspace?.saved_configs).toHaveLength(4)
    expect(await getProfileWorkspace(preview.id)).toMatchObject({ config, saved_configs: workspace?.saved_configs })
    expect(await getProfileById(preview.id)).toMatchObject({ status: 'revoked', merged_into_profile_id: cdk.id })
    expect((await getProfileForUser(user.id, preview.id))?.id).toBe(cdk.id)
    await expect(updateProfileWorkspaceAtomically(preview.id, () => emptyWorkspace(preview.id)))
      .rejects.toMatchObject({ code: 'profile_merged' })
    expect((await query('select 1 from optimization_result_history where profile_id = $1', [cdk.id])).rowCount).toBe(2)
    expect((await query('select 1 from free_preview_claims where profile_id = $1', [preview.id])).rowCount).toBe(1)
    const balances = await query<{ entitlement_type: string; units: number }>('select entitlement_type, units from profile_entitlement_balances where profile_id = $1', [cdk.id])
    expect(balances.rows).toEqual(expect.arrayContaining([{ entitlement_type: 'plan_slots', units: 2 }, { entitlement_type: 'archive_slots', units: 3 }]))

    await Promise.all([listProfilesForUser(user.id), listProfilesForUser(user.id)])
    expect((await query('select 1 from optimization_result_history where profile_id = $1', [cdk.id])).rowCount).toBe(2)
    expect((await query("select 1 from entitlement_ledger where profile_id = $1 and reference_type = 'profile_merge'", [cdk.id])).rowCount).toBe(1)
    await grantItem({ userId: user.id, itemCode: 'plan_capacity_certificate', quantity: 1, expiry: { mode: 'never' },
      sourceType: 'test', sourceId: 'merged-capacity', recipientRole: 'test' })
    await expect(useInventoryItem(user.id, { item_code: 'plan_capacity_certificate', quantity: 1,
      profile_id: preview.id, idempotency_key: randomUUID() })).rejects.toMatchObject({ code: 'profile_inactive' })
    expect(await getItemBalance(user.id, 'plan_capacity_certificate')).toBe(1)
  })

  it('merges multiple previews while preserving conflicting plans, current configs and result order', async () => {
    const user = await seedUser('profile-merge-multiple@example.test')
    const [preview, cdk] = await seedMergeProfiles(user.id)
    const another = { ...preview, id: randomUUID() }
    const paidConfig = { layout: '2-4-3', desc: 'paid' } as LicenseConfig
    const previewConfig = { layout: '2-4-3', desc: 'unsaved preview config' } as LicenseConfig
    await withTransaction(async (client) => {
      await saveProfileInTransaction(client, another)
      for (const profile of [cdk, preview, another]) {
        await updateProfileWorkspaceInTransaction(client, profile.id, () => ({
          ...emptyWorkspace(profile.id), config: profile === cdk ? paidConfig : previewConfig,
          saved_configs: [{ id: 'same-plan-id', name: profile.id, config: paidConfig,
            created_at: profile.created_at, updated_at: profile.created_at, last_used_at: null }],
        }))
        await client.query(`insert into optimization_result_history (profile_id, id, name, created_at, result_json, operator_count, source)
          values ($1, 'same-result-id', $1, $2, '{}', 1, 'generated')`, [profile.id, profile.created_at])
      }
    })
    const profiles = await listProfilesForUser(user.id)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].merged_profile_ids).toEqual(expect.arrayContaining([preview.id, another.id]))
    const workspace = await getProfileWorkspace(cdk.id)
    expect(workspace?.config).toEqual(paidConfig)
    expect(workspace?.saved_configs).toHaveLength(4)
    expect(new Set(workspace?.saved_configs.map((item) => item.id)).size).toBe(4)
    expect(workspace?.saved_configs.map((item) => item.config)).toContainEqual(previewConfig)
    const results = await query<{ name: string }>('select name from optimization_result_history where profile_id = $1 order by position desc', [cdk.id])
    expect(results.rows.map((row) => row.name)).toEqual([another.id, preview.id, cdk.id])
    expect((await getProfileForUser(user.id, another.id))?.id).toBe(cdk.id)
  })

  it('keeps both profiles when all saved data would exceed the supported capacity', async () => {
    const user = await seedUser('profile-merge-full@example.test')
    const [preview, cdk] = await seedMergeProfiles(user.id)
    await withTransaction(async (client) => {
      for (const profile of [preview, cdk]) await updateProfileWorkspaceInTransaction(client, profile.id, () => ({
        ...emptyWorkspace(profile.id), saved_configs: Array.from({ length: profile === preview ? 20 : 1 }, (_, i) => ({
          id: `${profile.id}-${i}`, name: `Plan ${i}`, config: { layout: '2-4-3', desc: '' } as LicenseConfig,
          created_at: profile.created_at, updated_at: profile.created_at, last_used_at: null,
        })),
      }))
    })
    expect(await listProfilesForUser(user.id)).toHaveLength(2)
    expect((await getProfileWorkspace(preview.id))?.saved_configs).toHaveLength(20)
    expect((await getProfileWorkspace(cdk.id))?.saved_configs).toHaveLength(1)
  })

  it('waits for active jobs and rejects stale submissions after merging', async () => {
    const user = await seedUser('profile-merge-busy@example.test')
    const [preview, cdk] = await seedMergeProfiles(user.id)
    const store = createPostgresOptimizeJobStore()
    const input = { id: randomUUID(), owner_key: `profile:${preview.id}`, profile_id: preview.id,
      priority: 60, source: 'free_preview', permission: 'growth', payload_json: {} }
    await store.createJob(input)
    expect(await listProfilesForUser(user.id)).toHaveLength(2)
    await query("update optimize_jobs set status = 'succeeded' where id = $1", [input.id])
    const results = await Promise.all([listProfilesForUser(user.id), listProfilesForUser(user.id)])
    expect(results.map((profiles) => profiles.map((profile) => profile.id))).toEqual([[cdk.id], [cdk.id]])
    await expect(store.admitJob({ ...input, id: randomUUID(), idempotency_key: randomUUID(), request_hash: 'stale' }))
      .rejects.toMatchObject({ code: 'profile_merged', status: 409 })
  })

  it.each(['different_uid', 'different_user', 'frozen', 'expired', 'two_cdk', 'license_frozen', 'license_missing'] as const)('preserves independent or unavailable profiles (%s)', async (scenario) => {
    const user = await seedUser(`profile-merge-${scenario}@example.test`)
    const [preview, cdk] = await seedMergeProfiles(user.id)
    if (scenario === 'different_uid') cdk.skland_binding!.uid = 'other-uid'
    if (scenario === 'frozen') cdk.status = 'frozen'
    if (scenario === 'expired') cdk.expires_at = '2020-01-01T00:00:00.000Z'
    if (scenario === 'two_cdk') preview.kind = 'cdk'
    if (scenario === 'license_frozen') await query("update cdk_records set status = 'frozen' where key = $1", [cdk.cdk_key])
    if (scenario === 'license_missing') cdk.cdk_key = null
    if (scenario === 'different_user') {
      const other = await seedUser('profile-merge-other@example.test')
      await query('delete from user_game_accounts where id = $1', [cdk.id])
      cdk.user_id = other.id
    }
    await withTransaction(async (client) => {
      await saveProfileInTransaction(client, preview)
      await saveProfileInTransaction(client, cdk)
    })
    expect(await listProfilesForUser(user.id)).toHaveLength(scenario === 'different_user' ? 1 : 2)
    expect((await getProfileForUser(user.id, preview.id))?.merged_into_profile_id).toBeUndefined()
  })

  it('preserves a higher free trial permission until it ends', async () => {
    const user = await seedUser('profile-merge-trial@example.test')
    const [preview, cdk] = await seedMergeProfiles(user.id)
    preview.temporary_permission = { source: 'limited_profile_voucher', activity_id: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
      permission: 'advanced', starts_at: '2000-01-01T00:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z', operation_id: randomUUID() }
    cdk.permission = 'growth'
    await withTransaction(async (client) => {
      await saveProfileInTransaction(client, preview)
      await saveProfileInTransaction(client, cdk)
      await client.query("update cdk_records set permission = 'growth', record_json = record_json || '{\"permission\":\"growth\"}'::jsonb where key = $1", [cdk.cdk_key])
    })
    expect(await listProfilesForUser(user.id)).toHaveLength(2)
    preview.temporary_permission.ends_at = '2020-01-01T00:00:00.000Z'
    await withTransaction((client) => saveProfileInTransaction(client, preview))
    expect((await listProfilesForUser(user.id)).map((profile) => profile.id)).toEqual([cdk.id])
  })

  it('rolls back all merge writes if the final source archival fails', async () => {
    const user = await seedUser('profile-merge-rollback@example.test')
    const [preview, cdk] = await seedMergeProfiles(user.id)
    await withTransaction((client) => updateProfileWorkspaceInTransaction(client, preview.id, () => ({
      ...emptyWorkspace(preview.id), operators: [{ id: 'amiya', name: '阿米娅', own: true, elite: 2, rarity: 5 }],
    })))
    await query(`create function reject_profile_merge() returns trigger language plpgsql as $$
      begin
        if new.record_json->>'merged_into_profile_id' is not null then raise exception 'injected merge failure'; end if;
        return new;
      end $$`)
    await query('create trigger reject_profile_merge before update on user_game_accounts for each row execute function reject_profile_merge()')
    try {
      await expect(listProfilesForUser(user.id)).rejects.toThrow('injected merge failure')
    } finally {
      await query('drop trigger reject_profile_merge on user_game_accounts')
      await query('drop function reject_profile_merge()')
    }
    expect((await getProfileWorkspace(cdk.id))?.operators).toBeNull()
    expect((await getProfileForUser(user.id, cdk.id))?.merged_profile_ids).toBeUndefined()
    expect((await getProfileForUser(user.id, preview.id))?.archived_at).toBeFalsy()
  })

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

async function seedMergeProfiles(userId: string): Promise<[UserGameAccountRecord, UserGameAccountRecord]> {
  const preview = { ...profileRecord(userId), kind: 'free_preview' as const, permission: 'growth' as const }
  const cdk = { ...profileRecord(userId), expires_at: '2099-01-01T00:00:00.000Z' }
  for (const profile of [preview, cdk]) profile.skland_binding = {
    uid: 'merge-uid', nickname: 'Doctor', channel_name: '官服', bound_at: profile.created_at,
    last_imported_at: profile.created_at, encrypted_cred: 'encrypted-test-credential', credential_status: 'available',
  }
  await withTransaction(async (client) => {
    const authorization = await createLifetimeVoucherProfileAuthorizationInTransaction(client, {
      operationId: randomUUID(), userId, profileId: cdk.id, authorizedAt: cdk.created_at,
    })
    cdk.cdk_key = authorization.cdkKey
    cdk.cdk_code_hash = authorization.codeHash
    cdk.cdk_order_hash = authorization.orderHash
    await saveProfileInTransaction(client, preview)
    await saveProfileInTransaction(client, cdk)
    await updateProfileWorkspaceInTransaction(client, cdk.id, () => emptyWorkspace(cdk.id))
  })
  return [preview, cdk]
}

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
