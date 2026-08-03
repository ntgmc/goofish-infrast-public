import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, getPool, query, withPostgresAdvisoryLock } from './postgres'
import { DATABASE_SCHEMA_VERSION, migrateDatabaseSchema } from './schema'
import {
  getDepotValueSampleStore,
  type DepotValueSampleRecord,
} from './depot-value-sample-store'
import { buildLifetimeVoucherProfileAuthorization } from './cdk-redemption'
import { replayInvitationSettlement } from './invitation-store'
import {
  confirmPersonalUseDeclaration,
  getPersonalUseDeclarationAcceptance,
  recordPersonalUseDeclarationUsage,
} from './personal-use-declaration-store'
import { CURRENT_PERSONAL_USE_DECLARATION } from '../personal-use-declaration'
import { createPostgresAdminUserStore } from './admin-user-store'
import type { AdminUserRecord } from '../handlers/admin-auth'

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
  it('allows only one maintenance leader for the same advisory lock', async () => {
    const lockName = `maintenance-test:${randomUUID()}`
    let releaseLeader: () => void = () => undefined
    let leaderAcquired: () => void = () => undefined
    const acquired = new Promise<void>((resolve) => { leaderAcquired = resolve })
    const leader = withPostgresAdvisoryLock(lockName, async () => {
      leaderAcquired()
      await new Promise<void>((resolve) => { releaseLeader = resolve })
      return 'leader'
    })

    await acquired
    await expect(withPostgresAdvisoryLock(lockName, async () => 'duplicate'))
      .resolves.toEqual({ acquired: false })
    releaseLeader()
    await expect(leader).resolves.toEqual({ acquired: true, value: 'leader' })
  })

  it('rolls back administrator account changes when their audit insert fails', async () => {
    const store = createPostgresAdminUserStore()
    const username = `audit-rollback-${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    const user: AdminUserRecord = {
      version: 2,
      username,
      role: 'security_admin',
      disabled: false,
      password_hash: 'hash-before',
      salt: 'salt',
      iterations: 1,
      password_algorithm: 'pbkdf2-sha256',
      created_at: now,
      updated_at: now,
    }
    const audit = {
      actorUsername: 'rollback-admin-test',
      action: 'admin_user.create',
      targetType: 'admin_user',
      targetId: username,
      reason: '验证管理员账号与审计共同回滚。',
      requestId: randomUUID(),
      after: { username },
    }
    await query(`
      create function reject_admin_account_audit() returns trigger language plpgsql as $$
      begin
        if new.actor_username = 'rollback-admin-test' then
          raise exception 'injected administrator audit failure';
        end if;
        return new;
      end
      $$
    `)
    await query(`
      create trigger reject_admin_account_audit
      before insert on admin_operation_audit
      for each row execute function reject_admin_account_audit()
    `)

    try {
      await expect(store.create(username, user, audit)).rejects.toThrow('injected administrator audit failure')
      await expect(store.get(username)).resolves.toBeNull()

      await expect(store.create(username, user)).resolves.toBe(true)
      await expect(store.delete(username, { ...audit, action: 'admin_user.delete', before: { username } }))
        .rejects.toThrow('injected administrator audit failure')
      await expect(store.get(username)).resolves.toMatchObject({ username, password_hash: 'hash-before' })
    } finally {
      await query('drop trigger reject_admin_account_audit on admin_operation_audit')
      await query('drop function reject_admin_account_audit()')
      await query('delete from admin_users where username = $1', [username])
    }
  })

  it('keeps unified administrator audit records append-only', async () => {
    const id = randomUUID()
    await query(
      `insert into admin_operation_audit
        (id, actor_username, action, target_type, target_id, reason, request_id, created_at)
       values ($1, 'append-only-test', 'test.insert', 'test', $1, '验证审计不可变。', $1, now())`,
      [id],
    )
    await expect(query(
      'update admin_operation_audit set reason = $2 where id = $1',
      [id, '不得修改'],
    )).rejects.toThrow('admin_operation_audit is append-only')
    await expect(query('delete from admin_operation_audit where id = $1', [id]))
      .rejects.toThrow('admin_operation_audit is append-only')
  })

  it('accepts a first metered-personal confirmation and records protected operations', async () => {
    const userId = randomUUID()
    const acceptance = await confirmPersonalUseDeclaration(
      userId,
      'metered_personal_create',
      '203.0.113.10',
      null,
      new Date('2026-08-01T01:00:00.000Z'),
    )
    const usage = await recordPersonalUseDeclarationUsage({
      userId,
      profileId: 'profile-metered-1',
      action: 'optimization_generate',
      clientIp: '203.0.113.10',
      occurredAt: new Date('2026-08-01T01:05:00.000Z'),
    })

    expect(acceptance).toMatchObject({
      action: 'metered_personal_create',
      declaration_id: CURRENT_PERSONAL_USE_DECLARATION.id,
      declaration_version: CURRENT_PERSONAL_USE_DECLARATION.version,
      content_hash: CURRENT_PERSONAL_USE_DECLARATION.contentHash,
    })
    expect(usage).toMatchObject({
      acceptance_id: acceptance.id,
      action: 'optimization_generate',
      profile_id: 'profile-metered-1',
      acceptance_accepted_at: '2026-08-01T01:00:00.000Z',
      occurred_at: '2026-08-01T01:05:00.000Z',
    })
    await query('delete from personal_use_declaration_acceptances where user_id = $1', [userId])
  })

  it('fails fast when an existing declaration ID has different immutable content', async () => {
    await query(
      'update personal_use_declaration_versions set content_hash = $2 where declaration_id = $1',
      [CURRENT_PERSONAL_USE_DECLARATION.id, '0'.repeat(64)],
    )
    try {
      await expect(migrateDatabaseSchema()).rejects.toThrow(/does not match the immutable runtime document/)
    } finally {
      await query(
        `update personal_use_declaration_versions
            set display_version = $2, effective_date = $3, content_text = $4, content_hash = $5
          where declaration_id = $1`,
        [
          CURRENT_PERSONAL_USE_DECLARATION.id,
          CURRENT_PERSONAL_USE_DECLARATION.version,
          CURRENT_PERSONAL_USE_DECLARATION.effectiveDate,
          CURRENT_PERSONAL_USE_DECLARATION.content,
          CURRENT_PERSONAL_USE_DECLARATION.contentHash,
        ],
      )
    }
  })

  it('does not treat a mismatched version or hash as a current acceptance', async () => {
    const userId = randomUUID()
    await query(
      `insert into personal_use_declaration_acceptances
        (id, user_id, profile_id, declaration_id, declaration_version, content_hash, action,
         client_ip, accepted_at, account_deleted_at, retain_until)
       values ($1, $2, null, $3, 'V0.9', $4, 'free_preview_claim', '203.0.113.11', now(), null, null)`,
      [randomUUID(), userId, CURRENT_PERSONAL_USE_DECLARATION.id, '0'.repeat(64)],
    )
    try {
      await expect(getPersonalUseDeclarationAcceptance(userId)).resolves.toBeNull()
      await expect(confirmPersonalUseDeclaration(
        userId,
        'metered_personal_create',
        '203.0.113.11',
      )).rejects.toThrow(/当前版本或内容哈希不一致/)
    } finally {
      await query('delete from personal_use_declaration_acceptances where user_id = $1', [userId])
    }
  })

  it('preserves workspace entries above base limits across idempotent migrations', async () => {
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
      expect(afterFirstMigration.saved_configs.map((item) => item.id)).toEqual(['config-1', 'config-2', 'config-3', 'config-4'])
      expect(afterFirstMigration.result_history.map((item) => item.id)).toEqual([
        'result-1',
        'result-2',
        'result-3',
        'result-4',
        'result-5',
        'result-6',
      ])

      await migrateDatabaseSchema()

      const afterSecondMigration = await readWorkspace(profile.profileId)
      expect(afterSecondMigration.saved_configs.map((item) => item.id)).toEqual(['config-1', 'config-2', 'config-3', 'config-4'])
      expect(afterSecondMigration.result_history.map((item) => item.id)).toEqual([
        'result-1',
        'result-2',
        'result-3',
        'result-4',
        'result-5',
        'result-6',
      ])
    } finally {
      await query('delete from user_accounts where id = $1', [profile.userId])
    }
  })

  it('rotates depot sample hashes atomically and isolates distributions by valuation version', async () => {
    const firstProfile = await seedProfile()
    const secondProfile = await seedProfile()
    const previousHash = `previous-${randomUUID()}`
    const currentHash = `current-${randomUUID()}`
    const otherHash = `other-${randomUUID()}`
    const valuationVersion = `valuation-${randomUUID()}`
    const otherValuationVersion = `valuation-${randomUUID()}`
    const store = getDepotValueSampleStore()
    if (!store) throw new Error('Expected the PostgreSQL depot sample store to be available.')

    try {
      await store.save(buildDepotSample({
        uid_hash: previousHash,
        contributor_profile_id: firstProfile.profileId,
        valuation_version: valuationVersion,
      }))
      await store.save(buildDepotSample({
        uid_hash: currentHash,
        uid_hash_key_version: 'current',
        contributor_profile_id: firstProfile.profileId,
        valuation_version: valuationVersion,
      }), [previousHash])
      await store.save(buildDepotSample({
        uid_hash: otherHash,
        contributor_profile_id: secondProfile.profileId,
        valuation_version: otherValuationVersion,
      }))

      const hashes = await query<{ uid_hash: string }>(
        'select uid_hash from depot_value_samples where uid_hash = any($1::text[]) order by uid_hash',
        [[previousHash, currentHash, otherHash]],
      )
      expect(hashes.rows.map((row) => row.uid_hash)).toEqual([currentHash, otherHash].sort())
      await expect(store.getDistribution(100, valuationVersion)).resolves.toEqual({
        sample_count: 1,
        less_count: 0,
        equal_count: 1,
      })
      await expect(store.getDistribution(100, otherValuationVersion)).resolves.toEqual({
        sample_count: 1,
        less_count: 0,
        equal_count: 1,
      })

      await expect(store.deleteForContributorProfile(firstProfile.profileId)).resolves.toBe(1)
      await expect(store.getDistribution(100, valuationVersion)).resolves.toEqual({
        sample_count: 0,
        less_count: 0,
        equal_count: 0,
      })
    } finally {
      await query('delete from user_accounts where id = any($1::text[])', [[firstProfile.userId, secondProfile.userId]])
    }
  })

  it('rejects unsafe or incomplete depot sample records at the database boundary', async () => {
    const profile = await seedProfile()
    const store = getDepotValueSampleStore()
    if (!store) throw new Error('Expected the PostgreSQL depot sample store to be available.')

    try {
      await expect(store.save(buildDepotSample({
        uid_hash: `negative-level-${randomUUID()}`,
        contributor_profile_id: profile.profileId,
        account_level: -1,
      }))).rejects.toThrow(/depot_samples_account_level_check/)
      await expect(store.save(buildDepotSample({
        uid_hash: `unsafe-total-${randomUUID()}`,
        contributor_profile_id: profile.profileId,
        total_equivalent_sanity: Number.MAX_SAFE_INTEGER + 1,
      }))).rejects.toThrow(/depot_samples_safe_numeric_check/)
      await expect(store.save(buildDepotSample({
        uid_hash: `low-coverage-${randomUUID()}`,
        contributor_profile_id: profile.profileId,
        pricing_coverage: 0.79,
      }))).rejects.toThrow(/depot_samples_complete_metadata_check/)
    } finally {
      await query('delete from user_accounts where id = $1', [profile.userId])
    }
  })

  it('backfills lifetime voucher profile authorization idempotently', async () => {
    const userId = randomUUID()
    const profileId = randomUUID()
    const operationId = randomUUID()
    const now = '2026-08-02T00:00:00.000Z'
    const authorization = buildLifetimeVoucherProfileAuthorization(operationId)
    const profile = {
      version: 1,
      id: profileId,
      user_id: userId,
      kind: 'cdk',
      cdk_key: null,
      cdk_code_hash: null,
      cdk_order_hash: null,
      permission: 'advanced',
      status: 'active',
      display_name: '待修复终身档案',
      note: '',
      created_at: now,
      updated_at: now,
    }
    try {
      await query(
        `insert into user_accounts
          (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
         values ($1, $2, 'hash', 'salt', 1, 'growth', 'active', $3::jsonb, $4, $4)`,
        [userId, `${userId}@example.test`, JSON.stringify({ id: userId }), now],
      )
      await query(
        `insert into user_game_accounts
          (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status, display_name, note,
           kind, archived_at, record_json, created_at, updated_at)
         values ($1, $2, null, null, null, 'advanced', 'active', $3, '', 'cdk', null, $4::jsonb, $5, $5)`,
        [profileId, userId, profile.display_name, JSON.stringify(profile), now],
      )
      await query(
        `insert into inventory_operations
          (id, user_id, idempotency_key, operation_type, request_hash, response_json, created_at, completed_at)
         values ($1, $2, $3, 'create_lifetime_profile', $4, $5::jsonb, $6, $6)`,
        [operationId, userId, randomUUID(), randomUUID(), JSON.stringify({ profile_id: profileId, import_mode: 'json' }), now],
      )

      await markCurrentMigrationPending()
      await migrateDatabaseSchema()
      await migrateDatabaseSchema()

      const repairedProfile = await query<{
        cdk_key: string
        cdk_code_hash: string
        cdk_order_hash: string
        record_json: typeof profile
      }>(
        'select cdk_key, cdk_code_hash, cdk_order_hash, record_json from user_game_accounts where id = $1',
        [profileId],
      )
      expect(repairedProfile.rows[0]).toMatchObject({
        cdk_key: authorization.cdkKey,
        cdk_code_hash: authorization.codeHash,
        cdk_order_hash: authorization.orderHash,
        record_json: {
          cdk_key: authorization.cdkKey,
          cdk_code_hash: authorization.codeHash,
          cdk_order_hash: authorization.orderHash,
        },
      })
      const records = await query<{ record_json: Record<string, unknown> }>(
        `select record_json
           from cdk_records where key = $1`,
        [authorization.cdkKey],
      )
      expect(records.rowCount).toBe(1)
      expect(records.rows[0]?.record_json).toMatchObject({
        status: 'used',
        permission: 'advanced',
        account_id: userId,
        profile_id: profileId,
        authorization_source: 'lifetime_profile_voucher',
      })
    } finally {
      await query('delete from cdk_records where key = $1', [authorization.cdkKey])
      await query('delete from user_accounts where id = $1', [userId])
    }
  })

  it('quarantines legacy invitation snapshots before validating the v2 constraint', async () => {
    const pending = await seedProfile()
    const settled = await seedProfile()
    const rejected = await seedProfile()
    const pendingInvitationId = randomUUID()
    const settledInvitationId = randomUUID()
    const now = '2026-08-02T00:00:00.000Z'
    try {
      await query('alter table invitations drop constraint invitations_snapshot_shape_check')
      await query(
        `insert into invitations
          (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, activated_at,
           settings_snapshot, next_retry_at, updated_at)
         values ($1, null, $2, 'LEGACY0001', 'activated', $3, $3, null, $3, $3)`,
        [pendingInvitationId, pending.userId, now],
      )
      await query(
        `insert into invitations
          (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, activated_at,
           settled_at, settings_snapshot, updated_at)
         values ($1, null, $2, 'LEGACY0002', 'settled', $3, $3, $3, '{"version":1}'::jsonb, $3)`,
        [settledInvitationId, settled.userId, now],
      )

      await markCurrentMigrationPending()
      await migrateDatabaseSchema()
      await migrateDatabaseSchema()

      const migrated = await query<{
        id: string
        status: string
        settings_snapshot: unknown
        legacy_snapshot_unavailable: boolean
        dead_lettered_at: string | null
        last_error: string | null
      }>(
        `select id, status, settings_snapshot, legacy_snapshot_unavailable,
                dead_lettered_at::text, last_error
           from invitations where id = any($1::text[]) order by id`,
        [[pendingInvitationId, settledInvitationId]],
      )
      const byId = new Map(migrated.rows.map((row) => [row.id, row]))
      expect(byId.get(pendingInvitationId)).toMatchObject({
        status: 'dead_letter',
        settings_snapshot: null,
        legacy_snapshot_unavailable: true,
        last_error: 'Legacy invitation snapshot is unavailable; settlement cannot be replayed',
      })
      expect(byId.get(pendingInvitationId)?.dead_lettered_at).not.toBeNull()
      expect(byId.get(settledInvitationId)).toMatchObject({
        status: 'settled',
        settings_snapshot: { version: 1 },
        legacy_snapshot_unavailable: true,
      })
      await expect(replayInvitationSettlement(
        'security_admin',
        pendingInvitationId,
        '尝试重放历史坏快照',
      )).resolves.toBe(false)
      await expect(query(
        `insert into invitations
          (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, activated_at,
           settings_snapshot, next_retry_at, updated_at)
         values ($1, null, $2, 'INVALID001', 'activated', $3, $3, null, $3, $3)`,
        [randomUUID(), rejected.userId, now],
      )).rejects.toThrow(/invitations_snapshot_shape_check/)
      const constraint = await query<{ convalidated: boolean }>(
        `select convalidated from pg_constraint
          where conrelid = 'invitations'::regclass and conname = 'invitations_snapshot_shape_check'`,
      )
      expect(constraint.rows[0]?.convalidated).toBe(true)
    } finally {
      await query('delete from user_accounts where id = any($1::text[])', [[pending.userId, settled.userId, rejected.userId]])
      await migrateDatabaseSchema()
    }
  })

  it('releases earlier phase locks before a later migration phase waits', async () => {
    await markCurrentMigrationPending()
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

async function markCurrentMigrationPending(): Promise<void> {
  await query('delete from goofish_schema_migrations where version = $1', [DATABASE_SCHEMA_VERSION])
}

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
     values ($1, $2, 'growth', 'active', 'Free', '', $3::jsonb, now(), now())`,
    [profileId, userId, JSON.stringify({ id: profileId, user_id: userId, kind: 'free_preview', permission: 'growth' })],
  )
  return { userId, profileId }
}

type StoredWorkspaceRecord = {
  saved_configs: Array<{ id: string }>
  result_history: Array<{ id: string }>
}

function buildDepotSample(overrides: Partial<DepotValueSampleRecord> = {}): DepotValueSampleRecord {
  const now = '2026-08-02T00:00:00.000Z'
  return {
    version: 2,
    uid_hash: `sample-${randomUUID()}`,
    uid_hash_key_version: 'previous',
    contributor_profile_id: null,
    valuation_version: 'valuation-v2',
    pricing_snapshot_id: 'snapshot-v2',
    pricing_fetched_at: now,
    pricing_status: 'fresh',
    pricing_coverage: 1,
    complete: true,
    total_equivalent_sanity: 100,
    account_level: 120,
    operator_power_score: 10,
    operator_count: 1,
    elite2_count: 1,
    six_star_count: 1,
    six_star_e2_count: 1,
    e2_90_count: 0,
    inventory_item_count: 1,
    priced_count: 1,
    unpriced_count: 0,
    sample_json: { version: 2 },
    sampled_at: now,
    updated_at: now,
    ...overrides,
  }
}
