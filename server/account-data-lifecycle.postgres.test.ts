import { createHash, randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAccountDeletion,
  cancelAccountDeletionOnLogin,
  getAccountDeletionConfigurationHealth,
  processAccountDeletionEmailOutbox,
  processDueAccountDeletions,
  requestAccountDeletion,
} from './account-data-lifecycle'
import { closePool, query, withTransaction } from './storage/postgres'
import { getItemBalance, grantItem, reserveItemsInTransaction } from './storage/inventory-store'
import { createPostgresOptimizeJobStore } from './storage/optimize-job-store'
import { ensureDatabaseSchema } from './storage/schema'
import type { UserAccountRecord, UserGameAccountRecord } from './storage/user-store'
import { createPasswordHash } from './security/password'
import { loginUser } from './handlers/user-auth'

const mocks = vi.hoisted(() => ({
  recordAccountDeletedBehaviorEvent: vi.fn(),
  sendAccountDeletionReceiptEmail: vi.fn(),
}))

vi.mock('./handlers/email', () => ({
  sendAccountDeletionReceiptEmail: mocks.sendAccountDeletionReceiptEmail,
}))

vi.mock('./behavior-risk/service', () => ({
  recordAccountDeletedBehaviorEvent: mocks.recordAccountDeletedBehaviorEvent,
}))

let container: StartedPostgreSqlContainer | undefined
const originalPublicAppUrl = process.env.PUBLIC_APP_URL
const originalDepotSecret = process.env.DEPOT_SAMPLE_HASH_SECRET

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.PUBLIC_APP_URL = 'https://example.test'
  process.env.DEPOT_SAMPLE_HASH_SECRET = 'test-depot-sample-secret'
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('truncate table account_deletion_email_outbox, user_accounts cascade')
  mocks.recordAccountDeletedBehaviorEvent.mockReset().mockResolvedValue(undefined)
  mocks.sendAccountDeletionReceiptEmail.mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
  restoreEnvironment('PUBLIC_APP_URL', originalPublicAppUrl)
  restoreEnvironment('DEPOT_SAMPLE_HASH_SECRET', originalDepotSecret)
})

describe('account deletion PostgreSQL lifecycle', () => {
  it('creates one request without cancellation email or a public URL for concurrent retries', async () => {
    const now = new Date('2026-07-31T00:00:00.000Z')
    const user = await seedUser('concurrent-request@example.test', now)
    await seedSession(user.id, now)
    delete process.env.PUBLIC_APP_URL

    const results = await Promise.all([
      requestAccountDeletion(user, now),
      requestAccountDeletion(user, now),
    ])

    expect(results[0]).toEqual(results[1])
    expect(results[0]).toEqual({ scheduledFor: '2026-08-07T00:00:00.000Z' })
    expect(await countRows('account_deletion_requests', 'user_id', user.id)).toBe(1)
    expect(await countRows('account_deletion_email_outbox', 'kind', 'cancellation')).toBe(0)
    expect(await countRows('user_sessions', 'user_id', user.id)).toBe(0)
    expect((await readUserStatus(user.id))).toBe('pending_deletion')
  })

  it('cancels deletion only after a successful password login and creates a new session', async () => {
    const now = new Date()
    const user = await seedUser('login-cancellation@example.test', now)
    await requestAccountDeletion(user, now)

    expect(await loginUser(user.email, 'wrong-password')).toMatchObject({ ok: false, status: 401 })
    expect(await readUserStatus(user.id)).toBe('pending_deletion')
    expect(await countRows('user_sessions', 'user_id', user.id)).toBe(0)

    expect(await loginUser(user.email, 'correct-password')).toMatchObject({
      ok: true, user: { id: user.id, status: 'active' }, cookie: expect.stringContaining('maa_session='),
    })
    expect(await readUserStatus(user.id)).toBe('active')
    expect(await countRows('account_deletion_requests', 'user_id', user.id)).toBe(0)
    expect(await countRows('user_sessions', 'user_id', user.id)).toBe(1)
    expect(await processDueAccountDeletions(new Date(now.getTime() + 8 * 86_400_000))).toBe(0)
  })

  it('rejects login at the deletion deadline even before the deletion worker runs', async () => {
    const now = new Date(Date.now() - 7 * 86_400_000)
    const user = await seedUser('expired-login@example.test', now)
    const accepted = await requestAccountDeletion(user, now)

    expect(await cancelAccountDeletionOnLogin(user, new Date(accepted.scheduledFor))).toBeNull()
    expect(await loginUser(user.email, 'correct-password')).toMatchObject({ ok: false, status: 403 })
    expect(await readUserStatus(user.id)).toBe('pending_deletion')
    expect(await countRows('user_sessions', 'user_id', user.id)).toBe(0)
  })

  it('does not restore a frozen account or accept an outdated password hash', async () => {
    const now = new Date()
    const user = await seedUser('changed-login@example.test', now)
    await requestAccountDeletion(user, now)
    expect(await cancelAccountDeletionOnLogin({ ...user, password_hash: 'outdated-hash' }, now)).toBeNull()
    await query(`update user_accounts set status = 'frozen',
      record_json = jsonb_set(record_json, '{status}', '"frozen"') where id = $1`, [user.id])
    expect(await cancelAccountDeletionOnLogin(user, now)).toBeNull()
    expect(await loginUser(user.email, 'correct-password')).toMatchObject({ ok: false, status: 403 })
    expect(await readUserStatus(user.id)).toBe('frozen')
  })

  it('honors previously issued cancellation links and discards queued cancellation emails', async () => {
    const now = new Date()
    const user = await seedUser('legacy-cancellation@example.test', now)
    await requestAccountDeletion(user, now)
    await seedEmail(user.id, user.email, now, 'cancellation')
    expect(await processAccountDeletionEmailOutbox(now)).toBe(0)
    expect(await countRows('account_deletion_email_outbox', 'kind', 'cancellation')).toBe(0)
    const token = 'previously-issued-token'
    await query('update account_deletion_requests set cancel_token_hash = $2 where user_id = $1',
      [user.id, createHash('sha256').update(token).digest('hex')])
    expect(await cancelAccountDeletion(token, now)).toBe(true)
    expect(await cancelAccountDeletion(token, now)).toBe(false)
    expect(await readUserStatus(user.id)).toBe('active')
  })

  it.each(['queued', 'running'])('releases every reservation when deletion cancels a %s job, including after withdrawal', async (status) => {
    const now = new Date()
    const timestamp = now.toISOString()
    const user = await seedUser(`reservations-${status}@example.test`, now)
    const profile = await seedProfile(user.id, now)
    const jobId = randomUUID()
    const key = `cdk/${randomUUID()}.json`
    await query(
      `insert into optimize_jobs (id, status, priority, owner_key, permission, source, payload_json,
         profile_id, worker_id, lock_token, attempt_count, created_at, updated_at)
       values ($1, $2, 0, $3, 'growth', 'account_profile', '{}', $4, 'worker-1', 'lock-1', 1, $5, $5)`,
      [jobId, status, `profile:${profile.id}`, profile.id, timestamp],
    )
    await grantItem({
      userId: user.id, itemCode: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' },
      sourceType: 'test', sourceId: jobId, recipientRole: 'test',
    })
    await withTransaction((client) => reserveItemsInTransaction(
      client, user.id, ['priority_compute_coupon'], 'optimization_job', jobId, profile.id, timestamp,
    ))
    await query(
      `insert into profile_entitlements (profile_id, first_generated_at, free_revision_count, updated_at)
       values ($1, $2, 1, $2)`, [profile.id, timestamp],
    )
    await query(
      `insert into entitlement_ledger (id, profile_id, entitlement_type, status, reference_type, reference_id, created_at)
       values ($1, $2, 'free_schedule', 'reserved', 'optimization_job', $3, $4)`,
      [randomUUID(), profile.id, jobId, timestamp],
    )
    await query(
      `insert into cdk_records (key, code_hash, status, permission, record_json) values ($1, $2, 'used', 'growth', $3::jsonb)`,
      [key, randomUUID(), JSON.stringify({ status: 'used', permission: 'growth', schedule_generate_reserved_count: 1, scenario_comparison_reserved_count: 1 })],
    )
    for (const effect of ['cdk_schedule_quota', 'cdk_scenario_quota']) {
      await query(
        `insert into optimization_job_effects (job_id, effect_type, metadata_json, applied_at) values ($1, $2, $3::jsonb, $4)`,
        [jobId, effect, JSON.stringify({ key, status: 'reserved' }), timestamp],
      )
    }
    await requestAccountDeletion(user, now)
    // Repeating the request must not refund or decrement counters twice.
    await requestAccountDeletion(user, now)
    expect(await cancelAccountDeletionOnLogin(user, now)).toMatchObject({ id: user.id, status: 'active' })
    expect(await getItemBalance(user.id, 'priority_compute_coupon')).toBe(1)
    expect((await query('select status from entitlement_ledger where reference_id = $1', [jobId])).rows[0]?.status).toBe('released')
    expect((await query('select free_revision_count, first_generated_at from profile_entitlements where profile_id = $1', [profile.id])).rows[0]).toEqual({ free_revision_count: 0, first_generated_at: null })
    expect((await query('select record_json from cdk_records where key = $1', [key])).rows[0]?.record_json).toMatchObject({ schedule_generate_reserved_count: 0, scenario_comparison_reserved_count: 0 })
    expect((await query("select metadata_json->>'status' as status from optimization_job_effects where job_id = $1", [jobId])).rows.map((row) => row.status)).toEqual(['released', 'released'])
    expect(await createPostgresOptimizeJobStore().completeAttempt(jobId, 1, 'worker-1', 'lock-1', {})).toBe(false)
    expect((await query('select status from optimize_jobs where id = $1', [jobId])).rows[0]?.status).toBe('failed')
    await query('delete from cdk_records where key = $1', [key])
  })

  it('rolls back the request, outbox, account state, and session when the transaction fails', async () => {
    const now = new Date('2026-07-31T01:00:00.000Z')
    const user = await seedUser('rollback-request@example.test', now)
    await seedSession(user.id, now)
    await query(`
      create function reject_pending_account_deletion() returns trigger language plpgsql as $$
      begin
        if new.status = 'pending_deletion' then raise exception 'injected account deletion failure'; end if;
        return new;
      end
      $$
    `)
    await query(`
      create trigger reject_pending_account_deletion
      before update on user_accounts
      for each row execute function reject_pending_account_deletion()
    `)

    try {
      await expect(requestAccountDeletion(user, now)).rejects.toThrow('injected account deletion failure')
    } finally {
      await query('drop trigger reject_pending_account_deletion on user_accounts')
      await query('drop function reject_pending_account_deletion()')
    }

    expect(await countRows('account_deletion_requests', 'user_id', user.id)).toBe(0)
    expect(await countRows('account_deletion_email_outbox', 'kind', 'cancellation')).toBe(0)
    expect(await countRows('user_sessions', 'user_id', user.id)).toBe(1)
    expect(await readUserStatus(user.id)).toBe('active')
  })

  it('allows cancellation or due deletion to win atomically, but never both', async () => {
    const now = new Date('2026-07-31T02:00:00.000Z')
    const user = await seedUser('cancel-race@example.test', now)
    const accepted = await requestAccountDeletion(user, now)
    const dueAt = new Date(accepted.scheduledFor)
    const beforeDue = new Date(dueAt.getTime() - 1)

    const [cancelled, deleted] = await Promise.all([
      cancelAccountDeletionOnLogin(user, beforeDue),
      processDueAccountDeletions(dueAt),
    ])
    const status = await readUserStatus(user.id)

    expect(Number(Boolean(cancelled)) + deleted).toBe(1)
    if (cancelled) {
      expect(status).toBe('active')
      expect(await countRows('account_deletion_requests', 'user_id', user.id)).toBe(0)
    } else {
      expect(status).toBeNull()
      expect(deleted).toBe(1)
    }
  })

  it('lets two workers delete once and removes profile and reorder-job optimization residue', async () => {
    const now = new Date('2026-07-31T03:00:00.000Z')
    const user = await seedUser('worker-race@example.test', now)
    const profile = await seedProfile(user.id, now)
    await seedOptimizationResidue(user.id, profile.id, now)
    const accepted = await requestAccountDeletion(user, now)
    const dueAt = new Date(accepted.scheduledFor)

    const counts = await Promise.all([
      processDueAccountDeletions(dueAt),
      processDueAccountDeletions(dueAt),
    ])

    expect(counts.reduce((total, count) => total + count, 0)).toBe(1)
    expect(await readUserStatus(user.id)).toBeNull()
    expect(await countOwnerRows('optimization_submissions', profile.id)).toBe(0)
    expect(await countOwnerRows('optimization_idempotency', profile.id)).toBe(0)
    expect(await countOwnerRows('optimization_dead_letters', profile.id)).toBe(0)
    expect(await countRows('account_deletion_email_outbox', 'kind', 'receipt')).toBe(1)
    expect(mocks.recordAccountDeletedBehaviorEvent).toHaveBeenCalledOnce()
  })

  it('deletes profile-linked depot samples when hash secrets are unavailable', async () => {
    const now = new Date('2026-07-31T03:30:00.000Z')
    const user = await seedUser('missing-depot-secret@example.test', now)
    const profile = await seedProfile(user.id, now)
    const linkedHash = `linked-${randomUUID()}`
    const legacyHash = `legacy-${randomUUID()}`
    await query(
      `update user_game_accounts
          set record_json = jsonb_set(record_json, '{skland_binding}', $2::jsonb)
        where id = $1`,
      [profile.id, JSON.stringify({ uid: 'missing-secret-test-uid' })],
    )
    await seedDepotSample(linkedHash, profile.id)
    await seedDepotSample(legacyHash, null)
    const accepted = await requestAccountDeletion(user, now)
    const currentSecret = process.env.DEPOT_SAMPLE_HASH_SECRET
    const previousSecret = process.env.DEPOT_SAMPLE_HASH_SECRET_PREVIOUS
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      delete process.env.DEPOT_SAMPLE_HASH_SECRET
      delete process.env.DEPOT_SAMPLE_HASH_SECRET_PREVIOUS
      await expect(processDueAccountDeletions(new Date(accepted.scheduledFor))).resolves.toBe(1)

      expect(await readUserStatus(user.id)).toBeNull()
      const samples = await query<{ uid_hash: string }>(
        'select uid_hash from depot_value_samples where uid_hash = any($1::text[]) order by uid_hash',
        [[linkedHash, legacyHash]],
      )
      expect(samples.rows.map((row) => row.uid_hash)).toEqual([legacyHash])
      expect(warn).toHaveBeenCalledWith(
        'depot sample hash secrets are unavailable; account deletion skipped legacy hash-only sample cleanup',
      )
    } finally {
      restoreEnvironment('DEPOT_SAMPLE_HASH_SECRET', currentSecret)
      restoreEnvironment('DEPOT_SAMPLE_HASH_SECRET_PREVIOUS', previousSecret)
      warn.mockRestore()
      await query('delete from depot_value_samples where uid_hash = $1', [legacyHash])
    }
  })

  it('persists email failures and removes short-lived recipient data after a retry succeeds', async () => {
    const now = new Date('2026-07-31T04:00:00.000Z')
    const user = await seedUser('outbox-retry@example.test', now)
    const accepted = await requestAccountDeletion(user, now)
    const dueAt = new Date(accepted.scheduledFor)
    await processDueAccountDeletions(dueAt)
    mocks.sendAccountDeletionReceiptEmail.mockRejectedValueOnce(new Error('temporary provider failure'))

    expect(await processAccountDeletionEmailOutbox(dueAt)).toBe(0)
    const failed = await query<{ status: string; attempts: number; last_error: string | null }>(
      `select status, attempts, last_error
         from account_deletion_email_outbox
        where kind = 'receipt'`,
    )
    expect(failed.rows[0]).toMatchObject({ status: 'pending', attempts: 1 })
    expect(failed.rows[0]?.last_error).toContain('temporary provider failure')

    const retryAt = new Date(dueAt.getTime() + 61_000)
    expect(await processAccountDeletionEmailOutbox(retryAt)).toBe(1)
    expect(await countRows('account_deletion_email_outbox', 'kind', 'receipt')).toBe(0)
    expect(mocks.sendAccountDeletionReceiptEmail).toHaveBeenCalledTimes(2)
  })

  it('reports whether the physical deletion dependency is configured', () => {
    expect(getAccountDeletionConfigurationHealth({})).toEqual({ ok: false })
    expect(getAccountDeletionConfigurationHealth({ DEPOT_SAMPLE_HASH_SECRET: 'configured' })).toEqual({ ok: true })
  })

  it('moves expired final-attempt leases to manual handling states', async () => {
    const now = new Date('2026-07-31T05:00:00.000Z')
    const user = await seedUser('expired-lease@example.test', now)
    const accepted = await requestAccountDeletion(user, now)
    await seedEmail(user.id, user.email, now, 'receipt')
    const expiredAt = new Date(now.getTime() - 1).toISOString()
    await query(
      `update account_deletion_requests
          set status = 'processing', attempts = 8, lease_token = 'expired-delete', lease_expires_at = $2
        where user_id = $1`,
      [user.id, expiredAt],
    )
    await query(
      `update account_deletion_email_outbox
          set status = 'processing', attempts = 10, lease_token = 'expired-email', lease_expires_at = $2
        where kind = 'receipt' and deletion_request_id in (
          select id from account_deletion_requests where user_id = $1
        )`,
      [user.id, expiredAt],
    )

    expect(await processDueAccountDeletions(new Date(accepted.scheduledFor))).toBe(0)
    expect(await processAccountDeletionEmailOutbox(now)).toBe(0)
    const deletion = await query<{ status: string; last_error: string }>(
      'select status, last_error from account_deletion_requests where user_id = $1',
      [user.id],
    )
    const email = await query<{ status: string; last_error: string }>(
      `select status, last_error from account_deletion_email_outbox where deletion_request_id in (
        select id from account_deletion_requests where user_id = $1
      )`,
      [user.id],
    )
    expect(deletion.rows[0]).toMatchObject({ status: 'failed' })
    expect(deletion.rows[0]?.last_error).toContain('lease expired')
    expect(email.rows[0]).toMatchObject({ status: 'dead_letter' })
    expect(email.rows[0]?.last_error).toContain('lease expired')
  })
})

async function seedUser(email: string, now: Date): Promise<UserAccountRecord> {
  const timestamp = now.toISOString()
  const user: UserAccountRecord = {
    version: 1,
    id: randomUUID(),
    email,
    ...await createPasswordHash('correct-password'),
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, cdk_key,
       cdk_code_hash, cdk_order_hash, email_verified_at, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, null, null, null, $8, $9::jsonb, $8, $8)`,
    [user.id, user.email, user.password_hash, user.salt, user.iterations, user.permission, user.status, timestamp, JSON.stringify(user)],
  )
  return user
}

async function seedProfile(userId: string, now: Date): Promise<UserGameAccountRecord> {
  const timestamp = now.toISOString()
  const profile: UserGameAccountRecord = {
    version: 1,
    id: randomUUID(),
    user_id: userId,
    kind: 'cdk',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'growth',
    status: 'active',
    archived_at: null,
    display_name: '测试档案',
    note: '',
    skland_binding: null,
    skland_pending_binding: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await query(
    `insert into user_game_accounts
      (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status,
       display_name, note, record_json, created_at, updated_at, kind, archived_at)
     values ($1, $2, null, null, null, $3, $4, $5, $6, $7::jsonb, $8, $8, $9, null)`,
    [profile.id, profile.user_id, profile.permission, profile.status, profile.display_name, profile.note, JSON.stringify(profile), timestamp, profile.kind],
  )
  return profile
}

async function seedSession(userId: string, now: Date): Promise<void> {
  const timestamp = now.toISOString()
  await query(
    `insert into user_sessions
      (id, user_id, token_hash, record_json, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, '{}'::jsonb, $4, $4, $5)`,
    [randomUUID(), userId, randomUUID(), timestamp, new Date(now.getTime() + 86_400_000).toISOString()],
  )
}

async function seedOptimizationResidue(userId: string, profileId: string, now: Date): Promise<void> {
  const timestamp = now.toISOString()
  const jobId = randomUUID()
  const ownerKey = `reorder-job:${profileId}`
  await query(
    `insert into optimize_jobs
      (id, status, priority, owner_key, permission, source, payload_json, created_at, updated_at,
       profile_id, billing_user_id)
     values ($1, 'failed', 0, $2, 'growth', 'reorder_check', '{}'::jsonb, $3, $3, $4, $5)`,
    [jobId, ownerKey, timestamp, profileId, userId],
  )
  await query(
    `insert into optimization_submissions (id, owner_key, billing_user_id, created_at)
     values ($1, $2, $3, $4)`,
    [randomUUID(), ownerKey, userId, timestamp],
  )
  await query(
    `insert into optimization_idempotency
      (owner_key, idempotency_key, request_hash, status, job_id, response_json, created_at, updated_at)
     values ($1, $2, 'request-hash', 'completed', $3, '{"profile_id":"profile-residue"}'::jsonb, $4, $4)`,
    [ownerKey, randomUUID(), jobId, timestamp],
  )
  await query(
    `insert into optimization_dead_letters
      (id, job_id, owner_key, profile_id, source, failure_kind, public_error_code,
       internal_error_message, diagnostic_json, attempt_count, created_at, updated_at)
     values ($1, $2, $3, $4, 'reorder_check', 'application_error', 'failed',
             'diagnostic residue', '{}'::jsonb, 1, $5, $5)`,
    [randomUUID(), jobId, ownerKey, profileId, timestamp],
  )
}

async function seedDepotSample(uidHash: string, contributorProfileId: string | null): Promise<void> {
  await query(
    `insert into depot_value_samples
      (uid_hash, contributor_profile_id, total_equivalent_sanity, account_level,
       operator_power_score, operator_count, elite2_count, six_star_count,
       six_star_e2_count, e2_90_count, inventory_item_count, priced_count,
       unpriced_count, sample_json, sampled_at, updated_at)
     values ($1, $2, 100, 120, 10, 1, 1, 1, 1, 0, 1, 1, 0, '{}'::jsonb, now(), now())`,
    [uidHash, contributorProfileId],
  )
}

async function seedEmail(userId: string, email: string, now: Date, kind: 'cancellation' | 'receipt'): Promise<void> {
  await query(
    `insert into account_deletion_email_outbox
      (id, deletion_request_id, kind, recipient_email, payload_json, status, attempts,
       next_attempt_at, created_at, updated_at, delete_after)
     select $1, id, $2, $3, jsonb_build_object('receipt_id', id), 'pending', 0, $4, $4, $4, $5
       from account_deletion_requests where user_id = $6`,
    [randomUUID(), kind, email, now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString(), userId],
  )
}

async function readUserStatus(userId: string): Promise<string | null> {
  const result = await query<{ status: string }>('select status from user_accounts where id = $1', [userId])
  return result.rows[0]?.status ?? null
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const allowed = new Set([
    'account_deletion_email_outbox:kind',
    'account_deletion_requests:user_id',
    'user_sessions:user_id',
  ])
  if (!allowed.has(`${table}:${column}`)) throw new Error('Unsupported test count query')
  const result = await query<{ count: string }>(`select count(*)::text as count from ${table} where ${column} = $1`, [value])
  return Number(result.rows[0]?.count ?? 0)
}

async function countOwnerRows(table: string, profileId: string): Promise<number> {
  const allowed = new Set(['optimization_submissions', 'optimization_idempotency', 'optimization_dead_letters'])
  if (!allowed.has(table)) throw new Error('Unsupported owner table')
  const result = await query<{ count: string }>(
    `select count(*)::text as count from ${table}
      where owner_key = any($1::text[])`,
    [[`profile:${profileId}`, `reorder-job:${profileId}`]],
  )
  return Number(result.rows[0]?.count ?? 0)
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
