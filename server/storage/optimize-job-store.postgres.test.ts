import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, getPool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  createPostgresOptimizeJobStore,
  getAdminOptimizationQueueSnapshot,
  OptimizeJobAdmissionError,
} from './optimize-job-store'
import { emptyWorkspace, getWorkspace, saveWorkspace, updateProfileWorkspaceAtomically, updateProfileWorkspaceInTransaction } from './user-store'
import {
  activateInvitationForUser,
  ensureInvitationCode,
  getInvitationSummary,
  getPriorityCouponBalances,
  manageInvitationCode,
  processInvitationSettlementBatch,
  replayInvitationSettlement,
  saveInvitationSettings,
  type InvitationSettingsPatch,
  validateInvitationCode,
} from './invitation-store'
import { confirmFreeScheduleEntitlement, getFreeScheduleEntitlement } from './reorder-admission'
import { adjustBalance, getBalanceSummary, reverseQualificationCredit } from './balance-store'
import { issueMeteredScheduleQuote } from './metered-billing-store'
import { recordOperatorFingerprintInTransaction } from './cdk-store'
import { getItemBalance, grantItem } from './inventory-store'
import { SettingsConflictError } from './settings-conflict'
import {
  getLatestProfileOptimizationResult,
  insertProfileOptimizationResultInTransaction,
  listProfileOptimizationResults,
} from './optimization-result-store'

let container: PostgreSqlContainer
const legacyJobId = randomUUID()
const legacyJobCreatedAt = '2026-01-01T00:00:00.000Z'

async function saveTestInvitationSettings(patch: InvitationSettingsPatch) {
  const revision = (await query<{ revision: number }>(
    "select revision from invitation_settings where key = 'global'",
  )).rows[0]?.revision ?? 0
  return saveInvitationSettings('root', patch, revision)
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await query(`
    create table optimize_jobs (
      id text primary key,
      status text not null,
      priority integer not null,
      owner_key text not null,
      permission text,
      source text not null,
      payload_json jsonb not null,
      result_json jsonb,
      error_message text,
      attempt_count integer not null default 0,
      failure_count integer not null default 0,
      worker_id text,
      heartbeat_at timestamptz,
      lock_token text,
      lock_expires_at timestamptz,
      created_at timestamptz not null,
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz not null
    )
  `)
  await query(
    `insert into optimize_jobs
      (id, status, priority, owner_key, source, payload_json, created_at, updated_at)
     values ($1, 'queued', -1000000, $2, 'legacy_migration_test', '{}'::jsonb, $3, $3)`,
    [legacyJobId, `legacy:${legacyJobId}`, legacyJobCreatedAt],
  )
  await ensureDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('PostgreSQL optimization job admission', () => {
  it('upgrades queued jobs created before retry and expiry columns were added', async () => {
    const columns = await query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'optimize_jobs'
         and column_name = any($1::text[])
       order by column_name`,
      [['execution_stage', 'expires_at', 'next_attempt_at', 'stage_updated_at']],
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'execution_stage',
      'expires_at',
      'next_attempt_at',
      'stage_updated_at',
    ])

    const backfill = await query<{ expires_at_backfilled: boolean; next_attempt_at_backfilled: boolean }>(
      `select
         next_attempt_at = created_at as next_attempt_at_backfilled,
         expires_at = created_at + interval '24 hours' as expires_at_backfilled
       from optimize_jobs
       where id = $1`,
      [legacyJobId],
    )
    expect(backfill.rows[0]).toEqual({
      expires_at_backfilled: true,
      next_attempt_at_backfilled: true,
    })

    const indexes = await query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'optimize_jobs'
         and indexname = any($1::text[])
       order by indexname`,
      [['idx_optimize_jobs_dispatch_ready', 'idx_optimize_jobs_queue_expires_at']],
    )
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'idx_optimize_jobs_dispatch_ready',
      'idx_optimize_jobs_queue_expires_at',
    ])
  })

  it('handles unexpected errors from idle pool clients', () => {
    expect(getPool().listenerCount('error')).toBeGreaterThan(0)
  })

  it('validates the production API schema without waiting for a row-write lock', async () => {
    const client = await getPool().connect()
    const previousRole = process.env.APP_ROLE
    const previousNodeEnv = process.env.NODE_ENV
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await client.query('begin')
      await client.query('lock table optimize_jobs in row exclusive mode')
      process.env.APP_ROLE = 'api'
      process.env.NODE_ENV = 'production'

      await expect(Promise.race([
        ensureDatabaseSchema().then(() => 'validated'),
        new Promise<string>((resolve) => {
          timeout = setTimeout(() => resolve('blocked'), 1_000)
        }),
      ])).resolves.toBe('validated')
    } finally {
      if (timeout) clearTimeout(timeout)
      if (previousRole === undefined) delete process.env.APP_ROLE
      else process.env.APP_ROLE = previousRole
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      await client.query('rollback')
      client.release()
    }
  })

  it('reads an ordered safe admin queue snapshot with user and profile context', async () => {
    const profileId = await seedProfile()
    const queuedHighId = randomUUID()
    const queuedRetryId = randomUUID()
    const runningId = randomUUID()
    const failedId = randomUUID()
    const workerRegistryId = `worker-snapshot-${randomUUID()}`
    const ids = [queuedHighId, queuedRetryId, runningId, failedId]
    const now = new Date()
    const createdAt = new Date(now.getTime() - 60_000).toISOString()
    const finishedAt = new Date(now.getTime() - 5_000).toISOString()
    try {
      await query(
        `insert into optimize_jobs
          (id, status, priority, owner_key, profile_id, permission, source, payload_json,
           result_json, error_message, failure_kind, public_error_code, attempt_count, failure_count,
           worker_id, heartbeat_at, next_attempt_at, expires_at, created_at, started_at, finished_at, updated_at)
         values
          ($1, 'queued', 2000000000, $5, $6, 'growth', 'account_profile', '{"secret":"payload"}'::jsonb,
           null, null, null, null, 0, 0, null, null, $9, $10, $9, null, null, $9),
          ($2, 'queued', 1999999999, $7, null, 'free_preview', 'scenario_comparison', '{}'::jsonb,
           null, 'internal retry detail', 'worker_crash', 'execution_retries_exhausted', 1, 1, null, null, $11, $10, $9, null, null, $9),
          ($3, 'running', 10, $8, null, 'growth', 'account_profile', '{}'::jsonb,
           null, null, null, null, 1, 0, 'worker-integration', $9, null, null, $9, $9, null, $9),
          ($4, 'failed', 0, $12, null, 'free_preview', 'free_preview', '{}'::jsonb,
           null, 'internal exception detail', 'timed_out', 'execution_retries_exhausted', 2, 2, null, null, null, null, $9, $9, $13, $13)`,
        [
          queuedHighId,
          queuedRetryId,
          runningId,
          failedId,
          `profile:${profileId}`,
          profileId,
          `snapshot-retry:${queuedRetryId}`,
          `snapshot-running:${runningId}`,
          createdAt,
          new Date(now.getTime() + 30 * 60_000).toISOString(),
          new Date(now.getTime() + 10_000).toISOString(),
          `snapshot-failed:${failedId}`,
          finishedAt,
        ],
      )
      await query(
        `insert into optimize_worker_registry
          (worker_id, concurrency, heartbeat_interval_ms, stale_after_ms, capabilities,
           build_sha, started_at, heartbeat_at, draining)
         values ($1, 2, 10000, 30000, '{optimize_jobs}', 'test-sha', $2, $2, false)`,
        [workerRegistryId, now.toISOString()],
      )

      const snapshot = await getAdminOptimizationQueueSnapshot(4)
      expect(snapshot.capacity).toMatchObject({
        worker_concurrency: 2,
        worker_instances: 1,
        source: 'runtime_registry',
        stale_after_ms: 30_000,
      })
      const highIndex = snapshot.queued_jobs.findIndex((job) => job.id === queuedHighId)
      const retryIndex = snapshot.queued_jobs.findIndex((job) => job.id === queuedRetryId)
      expect(highIndex).toBeGreaterThanOrEqual(0)
      expect(retryIndex).toBe(highIndex + 1)
      expect(snapshot.queued_jobs[highIndex]).toMatchObject({
        profile: { id: profileId, display_name: 'Free' },
        user: { email: expect.stringMatching(/@example\.test$/) },
      })
      expect(snapshot.running_jobs).toContainEqual(expect.objectContaining({ id: runningId, worker_id: 'worker-integration' }))
      expect(snapshot.recent_jobs).toContainEqual(expect.objectContaining({
        id: failedId,
        error_summary: '任务执行重试次数已用尽。',
      }))
      expect(snapshot.counts.retry_waiting).toBeGreaterThanOrEqual(1)
      expect(JSON.stringify(snapshot)).not.toContain('secret')
      expect(JSON.stringify(snapshot)).not.toContain('internal exception detail')
    } finally {
      await query('delete from optimize_worker_registry where worker_id = $1', [workerRegistryId])
      await query('delete from optimize_jobs where id = any($1::text[])', [ids])
    }
  })

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

  it('atomically reserves reorder quota once and releases it when the queued job is cancelled', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const windowKey = shanghaiMonthKey(new Date().toISOString())
    const firstInput = input({
      owner_key: `reorder-job:${randomUUID()}`,
      profile_id: profileId,
      source: 'reorder_check',
      payload_json: { version: 3, kind: 'reorder_check' },
      reorderCheckQuota: { profileId, windowKey, limit: 1 },
    })
    const first = await store.admitJob(firstInput)
    await expect(store.admitJob({ ...firstInput, id: randomUUID() })).resolves.toMatchObject({
      replayed: true,
      job: { id: first.job.id },
    })
    expect((await query<{ count: string }>(
      `select count(*)::text as count from entitlement_ledger
       where profile_id = $1 and entitlement_type = 'reorder_check' and status = 'reserved'`,
      [profileId],
    )).rows[0]?.count).toBe('1')

    await expect(store.admitJob(input({
      owner_key: `reorder-job:${randomUUID()}`,
      profile_id: profileId,
      source: 'reorder_check',
      payload_json: { version: 3, kind: 'reorder_check' },
      reorderCheckQuota: { profileId, windowKey, limit: 1 },
    }))).rejects.toMatchObject({ code: 'reorder_check_quota_exceeded', status: 429 })

    await store.requestCancel(first.job.id)
    expect((await query<{ status: string }>(
      `select status from entitlement_ledger
       where reference_type = 'optimization_job' and reference_id = $1`,
      [first.job.id],
    )).rows[0]?.status).toBe('released')

    const replacement = await store.admitJob(input({
      owner_key: `reorder-job:${randomUUID()}`,
      profile_id: profileId,
      source: 'reorder_check',
      payload_json: { version: 3, kind: 'reorder_check' },
      reorderCheckQuota: { profileId, windowKey, limit: 1 },
    }))
    await store.requestCancel(replacement.job.id)
  })

  it('consumes reorder quota and grants the strong bonus in the successful attempt transaction', async () => {
    const profileId = await seedProfile()
    const payload = formalReorderPayload(profileId)
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      priority: 2_000_000_000,
      owner_key: `reorder-job:${randomUUID()}`,
      profile_id: profileId,
      source: 'reorder_check',
      payload_json: payload,
      reorderCheckQuota: {
        profileId,
        windowKey: shanghaiMonthKey(new Date().toISOString()),
        limit: 2,
      },
    }))
    const lockToken = randomUUID()
    const claimed = await store.claimNextJob('reorder-success-worker', lockToken, new Date(Date.now() + 60_000).toISOString(), 2, 10)
    expect(claimed?.id).toBe(admitted.job.id)

    await expect(store.completeAttempt(
      admitted.job.id,
      claimed!.attempt_count,
      'reorder-success-worker',
      lockToken,
      formalReorderResult(payload, 'strongly_recommended'),
    )).resolves.toBe(true)

    expect((await query<{ status: string }>(
      `select status from entitlement_ledger
       where reference_type = 'optimization_job' and reference_id = $1 and entitlement_type = 'reorder_check'`,
      [admitted.job.id],
    )).rows[0]?.status).toBe('consumed')
    expect((await query<{ strong_reorder_bonus_month: string | null }>(
      'select strong_reorder_bonus_month from profile_entitlements where profile_id = $1',
      [profileId],
    )).rows[0]?.strong_reorder_bonus_month).toBe(shanghaiMonthKey(new Date().toISOString()))
    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({
      status: 'succeeded',
      result_json: {
        recommendation: 'strongly_recommended',
        quota: { limit: 2, used: 1, remaining: 1, timezone: 'Asia/Shanghai' },
        free_schedule_entitlement: {
          strong_reorder_bonus: { used_at: null },
        },
      },
    })
    expect((await query<{ effect_type: string }>(
      `select effect_type from optimization_job_effects
       where job_id = $1 and effect_type = 'reorder_check_completion'`,
      [admitted.job.id],
    )).rows).toEqual([{ effect_type: 'reorder_check_completion' }])
  })

  it('allows a coupon transaction after two successful ledger-backed reorder checks', async () => {
    const profileId = await seedProfile()
    const userId = (await query<{ user_id: string }>(
      'select user_id from user_game_accounts where id = $1',
      [profileId],
    )).rows[0]!.user_id
    await grantItem({
      userId,
      itemCode: 'reorder_check_coupon',
      quantity: 1,
      expiry: { mode: 'never' },
      sourceType: 'test',
      sourceId: `reorder-coupon:${profileId}`,
      recipientRole: 'test',
    })
    const store = createPostgresOptimizeJobStore()
    const windowKey = shanghaiMonthKey(new Date().toISOString())

    for (let index = 0; index < 2; index += 1) {
      const payload = formalReorderPayload(profileId)
      const admitted = await store.admitJob(input({
        priority: 2_000_000_000,
        owner_key: `reorder-job:${profileId}`,
        profile_id: profileId,
        source: 'reorder_check',
        payload_json: payload,
        reorderCheckQuota: { profileId, windowKey, limit: 2, useCoupon: false },
      }))
      await query('update optimize_dispatch_state set prioritized_streak = 0 where id = true')
      const lockToken = randomUUID()
      const claimed = await store.claimNextJob(`reorder-quota-worker-${index}`, lockToken, new Date(Date.now() + 60_000).toISOString(), 2, 10)
      expect(claimed?.id).toBe(admitted.job.id)
      await expect(store.completeAttempt(
        admitted.job.id,
        claimed!.attempt_count,
        `reorder-quota-worker-${index}`,
        lockToken,
        formalReorderResult(payload, 'recommended'),
      )).resolves.toBe(true)
    }

    const couponPayload = formalReorderPayload(profileId)
    const couponJob = await store.admitJob(input({
      priority: 2_000_000_000,
      owner_key: `reorder-job:${profileId}`,
      profile_id: profileId,
      source: 'reorder_check',
      payload_json: couponPayload,
      reward_user_id: userId,
      reward_item_codes: ['reorder_check_coupon'],
      reorderCheckQuota: { profileId, windowKey, limit: 2, useCoupon: true },
    }))
    await query('update optimize_dispatch_state set prioritized_streak = 0 where id = true')
    const couponLock = randomUUID()
    const claimedCoupon = await store.claimNextJob('reorder-coupon-worker', couponLock, new Date(Date.now() + 60_000).toISOString(), 2, 10)
    expect(claimedCoupon?.id).toBe(couponJob.job.id)
    await expect(store.completeAttempt(
      couponJob.job.id,
      claimedCoupon!.attempt_count,
      'reorder-coupon-worker',
      couponLock,
      formalReorderResult(couponPayload, 'recommended'),
    )).resolves.toBe(true)

    await expect(store.getJob(couponJob.job.id)).resolves.toMatchObject({
      status: 'succeeded',
      result_json: { quota: { used: 2, remaining: 0, timezone: 'Asia/Shanghai' } },
    })
    expect((await query<{ count: string }>(
      `select count(*)::text as count from entitlement_ledger
       where profile_id = $1 and entitlement_type = 'reorder_check'
         and window_key = $2 and status = 'consumed'`,
      [profileId, windowKey],
    )).rows[0]?.count).toBe('2')
    await expect(getItemBalance(userId, 'reorder_check_coupon')).resolves.toBe(0)
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

  it('counts each merged schedule request once', async () => {
    const store = createPostgresOptimizeJobStore()
    const owner = `license:${randomUUID()}`

    for (let index = 0; index < 12; index += 1) {
      const schedule = await store.admitJob(input({ owner_key: owner }))
      await query("update optimize_jobs set status = 'succeeded', updated_at = now() where id = $1", [schedule.job.id])
    }

    await expect(query<{ count: string }>(
      'select count(*)::text as count from optimization_submissions where owner_key = $1',
      [owner],
    )).resolves.toMatchObject({ rows: [{ count: '12' }] })
    await expect(store.admitJob(input({ owner_key: owner }))).rejects.toMatchObject({
      code: 'submission_rate_exceeded',
      status: 429,
      message: '当前账号的优化提交次数已达小时上限。请1小时后再试。',
    })
  })

  it('settles an activated invitation once using the current settings', async () => {
    const inviterProfileId = await seedProfile()
    const inviter = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [inviterProfileId])).rows[0]!.user_id
    const code = await ensureInvitationCode(inviter)
    const inviteeProfileId = await seedProfile()
    const invitee = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [inviteeProfileId])).rows[0]!.user_id
    await query(
      `insert into invitations (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
       values ($1, $2, $3, $4, 'registered', now(), now())`,
      [randomUUID(), inviter, invitee, code],
    )
    await saveTestInvitationSettings({
      rewards: [
        { recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, gift_pack_version_id: null },
        { recipient: 'invitee', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'relative_days', days: 30 }, gift_pack_version_id: null },
      ],
    })
    await Promise.all(Array.from({ length: 4 }, () => activateInvitationForUser(invitee)))
    expect((await query<{ status: string }>('select status from invitations where invitee_user_id = $1', [invitee])).rows[0]?.status).toBe('activated')
    await expect(processInvitationSettlementBatch(10)).resolves.toBeGreaterThanOrEqual(1)
    expect((await getPriorityCouponBalances(inviter))[0].available).toBe(1)
    expect((await getPriorityCouponBalances(invitee))[0].available).toBe(1)
    expect((await query<{ count: string }>('select count(*)::text as count from reward_grants where source_type = $1 and user_id = $2', ['invitation', inviter])).rows[0]?.count).toBe('1')
  })

  it('rejects a stale invitation settings revision', async () => {
    const revision = (await query<{ revision: number }>(
      "select revision from invitation_settings where key = 'global'",
    )).rows[0]?.revision ?? 0
    await saveInvitationSettings('first-admin', { daily_inviter_reward_limit: 9 }, revision)
    await expect(saveInvitationSettings('second-admin', { daily_inviter_reward_limit: 8 }, revision))
      .rejects.toBeInstanceOf(SettingsConflictError)
  })

  it('pauses, resumes, and rotates a recommendation code with cooldown audit', async () => {
    const profileId = await seedProfile()
    const userId = (await query<{ user_id: string }>(
      'select user_id from user_game_accounts where id = $1', [profileId],
    )).rows[0]!.user_id
    const original = await ensureInvitationCode(userId)
    const base = Date.now() + 60_000
    await manageInvitationCode(userId, 'pause', new Date(base))
    await expect(validateInvitationCode(original)).rejects.toMatchObject({ code: 'invalid_invite_code' })
    await manageInvitationCode(userId, 'resume', new Date(base + 60_000))
    await expect(validateInvitationCode(original)).resolves.toMatchObject({ inviter_user_id: userId })
    const rotated = await manageInvitationCode(userId, 'rotate', new Date(base + 120_000))
    expect(rotated.code).not.toBe(original)
    await expect(validateInvitationCode(original)).rejects.toMatchObject({ code: 'invalid_invite_code' })
    await expect(validateInvitationCode(rotated.code)).resolves.toMatchObject({ inviter_user_id: userId })
    await expect(getInvitationSummary(userId)).resolves.toMatchObject({
      code: rotated.code,
      code_status: 'active',
      as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
    await expect(manageInvitationCode(userId, 'rotate', new Date(base + 60 * 60_000)))
      .rejects.toMatchObject({ code: 'rotation_cooldown' })
    expect((await query<{ actions: string[] }>(
      'select array_agg(action order by created_at) as actions from invitation_code_audit where user_id = $1',
      [userId],
    )).rows[0]?.actions).toEqual(['create', 'pause', 'resume', 'rotate'])
  })

  it('counts a multi-item inviter reward group as one daily invitation under concurrency', async () => {
    const inviterProfileId = await seedProfile()
    const inviter = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [inviterProfileId])).rows[0]!.user_id
    const code = await ensureInvitationCode(inviter)
    const invitees = await Promise.all([seedProfile(), seedProfile()])
    const inviteeUsers = await Promise.all(invitees.map(async (profileId) => (
      (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [profileId])).rows[0]!.user_id
    )))
    await saveTestInvitationSettings({
      enabled: true,
      daily_inviter_reward_limit: 1,
      rewards: [
        { recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, gift_pack_version_id: null },
        { recipient: 'inviter', item_code: 'training_diagnosis_coupon', quantity: 2, expiry: { mode: 'never' }, gift_pack_version_id: null },
        { recipient: 'invitee', item_code: 'reorder_check_coupon', quantity: 1, expiry: { mode: 'never' }, gift_pack_version_id: null },
      ],
    })
    for (const invitee of inviteeUsers) {
      await query(
        `insert into invitations (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
         values ($1, $2, $3, $4, 'registered', now(), now())`,
        [randomUUID(), inviter, invitee, code],
      )
    }

    await Promise.all(inviteeUsers.map((invitee) => activateInvitationForUser(invitee)))
    await Promise.all([processInvitationSettlementBatch(10), processInvitationSettlementBatch(10)])

    const invitations = await query<{ rewarded: string; settled: string }>(
      `select count(*) filter (where inviter_rewarded_at is not null)::text as rewarded,
              count(*) filter (where status = 'settled')::text as settled
         from invitations where inviter_user_id = $1 and invitee_user_id = any($2::text[])`,
      [inviter, inviteeUsers],
    )
    expect(invitations.rows[0]).toEqual({ rewarded: '1', settled: '2' })
    expect((await query<{ count: string }>(
      `select count(*)::text as count from reward_grants
        where user_id = $1 and source_type = 'invitation' and recipient_role = 'inviter'`,
      [inviter],
    )).rows[0]?.count).toBe('2')
    expect((await query<{ count: string }>(
      `select count(*)::text as count from reward_grants
        where user_id = any($1::text[]) and source_type = 'invitation' and recipient_role = 'invitee'`,
      [inviteeUsers],
    )).rows[0]?.count).toBe('2')
  })

  it('keeps an activation snapshot while paused and lets the worker settle it after resume', async () => {
    const inviterProfileId = await seedProfile()
    const inviter = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [inviterProfileId])).rows[0]!.user_id
    const code = await ensureInvitationCode(inviter)
    const inviteeProfileId = await seedProfile()
    const invitee = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [inviteeProfileId])).rows[0]!.user_id
    await saveTestInvitationSettings({
      enabled: false,
      rewards: [{ recipient: 'inviter', item_code: 'scenario_simulation_coupon', quantity: 1, expiry: { mode: 'relative_days', days: 7 }, gift_pack_version_id: null }],
    })
    const invitationId = randomUUID()
    await query(
      `insert into invitations (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
       values ($1, $2, $3, $4, 'registered', now(), now())`,
      [invitationId, inviter, invitee, code],
    )

    await activateInvitationForUser(invitee)
    expect((await query<{ status: string; settings_snapshot: { enabled: boolean } }>(
      'select status, settings_snapshot from invitations where id = $1', [invitationId],
    )).rows[0]).toMatchObject({ status: 'activated', settings_snapshot: { enabled: false } })
    expect((await query<{ count: string }>('select count(*)::text as count from reward_grants where source_id = $1', [invitationId])).rows[0]?.count).toBe('0')

    await saveTestInvitationSettings({
      enabled: true,
      rewards: [{ recipient: 'inviter', item_code: 'priority_compute_coupon', quantity: 99, expiry: { mode: 'never' }, gift_pack_version_id: null }],
    })
    await expect(processInvitationSettlementBatch(10)).resolves.toBeGreaterThanOrEqual(1)

    const grants = await query<{ reward_type: string; original_quantity: number; validity_days: number }>(
      'select reward_type, original_quantity, validity_days from reward_grants where source_id = $1', [invitationId],
    )
    expect(grants.rows).toEqual([{ reward_type: 'scenario_simulation_coupon', original_quantity: 1, validity_days: 7 }])
    expect((await query<{ status: string }>('select status from invitations where id = $1', [invitationId])).rows[0]?.status).toBe('settled')
  })

  it('reconciles a registered invitation when the invitee already has an active profile', async () => {
    const inviterProfileId = await seedProfile()
    const inviter = (await query<{ user_id: string }>(
      'select user_id from user_game_accounts where id = $1', [inviterProfileId],
    )).rows[0]!.user_id
    const code = await ensureInvitationCode(inviter)
    const inviteeProfileId = await seedProfile()
    const invitee = (await query<{ user_id: string }>(
      'select user_id from user_game_accounts where id = $1', [inviteeProfileId],
    )).rows[0]!.user_id
    const invitationId = randomUUID()
    await saveTestInvitationSettings({
      enabled: true,
      rewards: [{
        recipient: 'invitee', item_code: 'priority_compute_coupon', quantity: 1,
        expiry: { mode: 'never' }, gift_pack_version_id: null,
      }],
    })
    await query(
      `insert into invitations (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
       values ($1, $2, $3, $4, 'registered', now(), now())`,
      [invitationId, inviter, invitee, code],
    )

    await expect(processInvitationSettlementBatch(10)).resolves.toBeGreaterThanOrEqual(1)

    expect((await query<{ status: string; activated_at: string | null }>(
      'select status, activated_at::text from invitations where id = $1', [invitationId],
    )).rows[0]).toMatchObject({ status: 'settled', activated_at: expect.any(String) })
    expect((await getPriorityCouponBalances(invitee))[0].available).toBe(1)
  })

  it('isolates a poison invitation and dead-letters it without blocking later settlements', async () => {
    const inviterProfileId = await seedProfile()
    const inviter = (await query<{ user_id: string }>(
      'select user_id from user_game_accounts where id = $1', [inviterProfileId],
    )).rows[0]!.user_id
    const code = await ensureInvitationCode(inviter)
    const inviteeProfileIds = await Promise.all([seedProfile(), seedProfile()])
    const invitees = await Promise.all(inviteeProfileIds.map(async (profileId) => (
      (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [profileId])).rows[0]!.user_id
    )))
    await saveTestInvitationSettings({
      enabled: true,
      rewards: [{
        recipient: 'invitee', item_code: 'priority_compute_coupon', quantity: 1,
        expiry: { mode: 'never' }, gift_pack_version_id: null,
      }],
    })
    const poisonId = randomUUID()
    const healthyId = randomUUID()
    for (const [id, invitee] of [[poisonId, invitees[0]!], [healthyId, invitees[1]!]] as const) {
      await query(
        `insert into invitations (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
         values ($1, $2, $3, $4, 'registered', now(), now())`,
        [id, inviter, invitee, code],
      )
      await activateInvitationForUser(invitee)
    }
    await query(
      `update invitations
          set settings_snapshot = jsonb_set(settings_snapshot, '{rewards,0,quantity}', '0'::jsonb),
              activated_at = now() - interval '1 hour'
        where id = $1`,
      [poisonId],
    )

    await expect(processInvitationSettlementBatch(2)).resolves.toBe(2)
    expect((await query<{ status: string; attempt_count: number }>(
      'select status, attempt_count from invitations where id = $1', [poisonId],
    )).rows[0]).toEqual({ status: 'failed', attempt_count: 1 })
    expect((await query<{ status: string }>('select status from invitations where id = $1', [healthyId])).rows[0]?.status).toBe('settled')

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await query("update invitations set next_retry_at = now() where id = $1 and status = 'failed'", [poisonId])
      await expect(processInvitationSettlementBatch(1)).resolves.toBe(1)
    }
    expect((await query<{ status: string; attempt_count: number; dead_lettered_at: string | null }>(
      'select status, attempt_count, dead_lettered_at::text from invitations where id = $1', [poisonId],
    )).rows[0]).toMatchObject({ status: 'dead_letter', attempt_count: 5, dead_lettered_at: expect.any(String) })
    expect((await getPriorityCouponBalances(invitees[1]!))[0].available).toBe(1)

    await query(
      `update invitations poison
          set settings_snapshot = healthy.settings_snapshot
         from invitations healthy
        where poison.id = $1 and healthy.id = $2`,
      [poisonId, healthyId],
    )
    await expect(replayInvitationSettlement('root', poisonId, 'snapshot repaired')).resolves.toBe(true)
    await expect(processInvitationSettlementBatch(1)).resolves.toBe(1)
    expect((await query<{ status: string }>('select status from invitations where id = $1', [poisonId])).rows[0]?.status).toBe('settled')
    expect((await query<{ count: string }>(
      `select count(*)::text as count from admin_registration_invitation_audit
        where invitation_id = $1 and action = 'replay_settlement'`,
      [poisonId],
    )).rows[0]?.count).toBe('1')
  })

  it('atomically consumes a priority coupon and refunds it once on terminal failure', async () => {
    const profileId = await seedProfile()
    const userId = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [profileId])).rows[0]!.user_id
    await query(
      `insert into reward_grants
        (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity, validity_days, metadata_json, created_at)
       values ($1, $2, 'priority_compute_coupon', 'test', $3, 'inviter', 1, 1, 0, '{}'::jsonb, now())`,
      [randomUUID(), userId, randomUUID()],
    )
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      priority: 20,
      source: 'account_profile',
      reward_user_id: userId,
      use_priority_coupon: true,
    }))
    expect((await getPriorityCouponBalances(userId))[0].available).toBe(0)
    const claimed = await store.claimNextJob('test-worker', 'coupon-lock', new Date(Date.now() + 60_000).toISOString(), 2)
    expect(claimed?.id).toBe(admitted.job.id)
    await store.failAttempt(admitted.job.id, claimed!.attempt_count, 'test-worker', 'coupon-lock', 'system failure')
    await store.failAttempt(admitted.job.id, claimed!.attempt_count, 'test-worker', 'coupon-lock', 'duplicate failure')
    expect((await getPriorityCouponBalances(userId))[0].available).toBe(1)
    expect((await query<{ status: string }>('select status from reward_consumptions where optimization_job_id = $1', [admitted.job.id])).rows[0]?.status).toBe('refunded')
  })

  it('records attempt heartbeats and releases deployment interruptions without failure budget', async () => {
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({ priority: 1_000 }))
    const claimed = await store.claimNextJob('worker-a', 'attempt-lock', new Date(Date.now() + 60_000).toISOString(), 2)
    expect(claimed).toMatchObject({ id: admitted.job.id, status: 'running', expires_at: null, execution_stage: 'starting' })

    await expect(store.heartbeatAttempt(admitted.job.id, claimed!.attempt_count, 'worker-b', 'attempt-lock', new Date(Date.now() + 60_000).toISOString())).resolves.toBe(false)
    await expect(store.heartbeatAttempt(admitted.job.id, claimed!.attempt_count, 'worker-a', 'attempt-lock', new Date(Date.now() + 60_000).toISOString())).resolves.toBe(true)
    await expect(store.updateAttemptStage(admitted.job.id, claimed!.attempt_count, 'worker-b', 'attempt-lock', 'simulating_upgrades')).resolves.toBe(false)
    await expect(store.updateAttemptStage(admitted.job.id, claimed!.attempt_count, 'worker-a', 'attempt-lock', 'simulating_upgrades')).resolves.toBe(true)
    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({ execution_stage: 'simulating_upgrades' })
    await expect(store.releaseInterruptedAttempt(admitted.job.id, claimed!.attempt_count, 'worker-a', 'attempt-lock')).resolves.toBe(true)

    expect(await store.getJob(admitted.job.id)).toMatchObject({ status: 'queued', failure_count: 0, attempt_count: 1, execution_stage: null })
    expect((await query<{ status: string }>(
      'select status from optimize_job_attempts where job_id = $1 and attempt_no = $2',
      [admitted.job.id, claimed!.attempt_count],
    )).rows[0]?.status).toBe('interrupted')
  })

  it('recovers expired attempts and schedules worker retries with timestamp parameters', async () => {
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({ priority: 150_000 }))
    await query('update optimize_dispatch_state set prioritized_streak = 0 where id = true')
    const first = await store.claimNextJob('recovery-worker', 'recovery-lock', '2020-01-01T00:00:00.000Z', 3, 10)
    expect(first?.id).toBe(admitted.job.id)

    await expect(store.recoverExpiredAttempts(new Date().toISOString(), 3)).resolves.toBeGreaterThanOrEqual(1)
    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({
      status: 'queued',
      failure_count: 1,
      attempt_count: 1,
    })

    await query('update optimize_jobs set next_attempt_at = $2 where id = $1', [admitted.job.id, '2020-01-01T00:00:00.000Z'])
    await query('update optimize_dispatch_state set prioritized_streak = 0 where id = true')
    const second = await store.claimNextJob('retry-worker', 'retry-lock', '2020-01-01T00:00:00.000Z', 3, 10)
    expect(second?.id).toBe(admitted.job.id)
    await expect(store.retryFailedAttempt(
      admitted.job.id,
      second!.attempt_count,
      'retry-worker',
      'retry-lock',
      'worker_crash',
      'retry regression test',
      3,
    )).resolves.toBe('queued')
    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({
      status: 'queued',
      failure_count: 2,
      attempt_count: 2,
    })
    await query("update optimize_jobs set status = 'failed', next_attempt_at = null, finished_at = now(), updated_at = now() where id = $1", [admitted.job.id])
  })

  it('dead-letters a long-running attempt even while its lease remains valid', async () => {
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({ priority: 150_000 }))
    const claimed = await store.claimNextJob('deadline-worker', 'deadline-lock', new Date(Date.now() + 60_000).toISOString(), 2, 10)
    expect(claimed?.id).toBe(admitted.job.id)
    await query(
      `update optimize_jobs
       set started_at = $2, lock_expires_at = $3, updated_at = $3
       where id = $1`,
      [
        admitted.job.id,
        new Date(Date.now() - 15 * 60_000 - 1).toISOString(),
        new Date(Date.now() + 60_000).toISOString(),
      ],
    )

    await expect(store.recoverExpiredAttempts(new Date().toISOString(), 2)).resolves.toBeGreaterThanOrEqual(1)
    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({
      status: 'dead_lettered',
      attempt_count: claimed!.attempt_count,
      failure_count: 1,
      failure_kind: 'timed_out',
      public_error_code: 'execution_retries_exhausted',
    })
    expect((await query<{ status: string; failure_kind: string }>(
      'select status, failure_kind from optimize_job_attempts where job_id = $1 and attempt_no = $2',
      [admitted.job.id, claimed!.attempt_count],
    )).rows[0]).toEqual({ status: 'timed_out', failure_kind: 'timed_out' })
  })

  it('expires never-started jobs and releases their reserved free entitlement', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const createdAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
      created_at: createdAt,
      payload_json: { freeScheduleDecision: { ok: true, mode: 'revision' } },
    }))

    await expect(store.expireQueuedJobs(new Date().toISOString())).resolves.toBeGreaterThanOrEqual(1)
    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({ status: 'failed', attempt_count: 0 })
    expect((await query<{ status: string }>(
      "select status from entitlement_ledger where reference_type = 'optimization_job' and reference_id = $1",
      [admitted.job.id],
    )).rows[0]?.status).toBe('released')
    expect((await query<{ free_revision_count: number }>(
      'select free_revision_count from profile_entitlements where profile_id = $1',
      [profileId],
    )).rows[0]?.free_revision_count).toBe(0)
  })

  it('reads the authoritative free entitlement instead of a stale workspace snapshot', async () => {
    const profileId = await seedProfile()
    const lockedAt = new Date().toISOString()
    await query(
      `insert into profile_entitlements
        (profile_id, first_generated_at, free_revision_count, locked_at, lock_reason, updated_at)
       values ($1, $2, 3, $2, 'revision_limit', $2)`,
      [profileId, lockedAt],
    )

    await expect(getFreeScheduleEntitlement(profileId, null)).resolves.toMatchObject({
      first_generated_at: lockedAt,
      revision_count: 3,
      locked_at: lockedAt,
      lock_reason: 'revision_limit',
    })
  })

  it('rejects another free generation after an atomic schedule confirmation', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
    }))
    const createdAt = new Date().toISOString()
    await query("update optimize_jobs set status = 'succeeded', finished_at = now(), updated_at = now() where id = $1", [admitted.job.id])
    await query(
      "update entitlement_ledger set status = 'consumed', settled_at = now() where reference_type = 'optimization_job' and reference_id = $1",
      [admitted.job.id],
    )
    await withTransaction(async (client) => {
      await insertProfileOptimizationResultInTransaction(client, profileId, {
        id: admitted.job.id,
        name: '首次免费方案',
        created_at: createdAt,
        config: formalConfig(),
        result: formalScheduleResult('首次免费方案'),
        operator_count: 1,
        source: 'generated',
      }, 5)
    })

    const confirmed = await confirmFreeScheduleEntitlement(profileId, admitted.job.id, createdAt)

    expect(confirmed.free_schedule_entitlement).toMatchObject({
      revision_count: 1,
      confirmed_at: createdAt,
      locked_at: createdAt,
      lock_reason: 'confirmed',
    })
    expect((await query<{ confirmed_at: string | null; lock_reason: string | null }>(
      'select confirmed_at, lock_reason from profile_entitlements where profile_id = $1',
      [profileId],
    )).rows[0]).toMatchObject({ confirmed_at: expect.anything(), lock_reason: 'confirmed' })
    await expect(store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
    }))).rejects.toMatchObject({ code: 'free_revision_limit_exceeded' })
  })

  it('releases a reserved free entitlement when a started job fails', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
      payload_json: { freeScheduleDecision: { ok: true, mode: 'revision' } },
    }))
    const workerId = 'failed-free-worker'
    const lockToken = randomUUID()
    await query(
      `update optimize_jobs
       set status = 'running', attempt_count = 1, worker_id = $2, lock_token = $3,
           started_at = now(), updated_at = now()
       where id = $1`,
      [admitted.job.id, workerId, lockToken],
    )

    await expect(store.failAttempt(admitted.job.id, 1, workerId, lockToken, 'optimizer failed')).resolves.toBe(true)
    expect((await query<{ free_revision_count: number }>(
      'select free_revision_count from profile_entitlements where profile_id = $1',
      [profileId],
    )).rows[0]?.free_revision_count).toBe(0)
    expect((await query<{ status: string }>(
      "select status from entitlement_ledger where reference_type = 'optimization_job' and reference_id = $1",
      [admitted.job.id],
    )).rows[0]?.status).toBe('released')
  })

  it('reconciles a free entitlement reserved by a legacy failed job', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
      payload_json: { freeScheduleDecision: { ok: true, mode: 'revision' } },
    }))
    await query("update optimize_jobs set status = 'failed', finished_at = now(), updated_at = now() where id = $1", [admitted.job.id])

    await expect(getFreeScheduleEntitlement(profileId, null)).resolves.toMatchObject({
      first_generated_at: null,
      revision_count: 0,
      locked_at: null,
      lock_reason: null,
    })
    expect((await query<{ status: string }>(
      "select status from entitlement_ledger where reference_type = 'optimization_job' and reference_id = $1",
      [admitted.job.id],
    )).rows[0]?.status).toBe('released')
  })

  it('refunds a priority coupon when its queued job expires before starting', async () => {
    const profileId = await seedProfile()
    const userId = (await query<{ user_id: string }>('select user_id from user_game_accounts where id = $1', [profileId])).rows[0]!.user_id
    await query(
      `insert into reward_grants
        (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity, validity_days, metadata_json, created_at)
       values ($1, $2, 'priority_compute_coupon', 'test', $3, 'inviter', 1, 1, 0, '{}'::jsonb, now())`,
      [randomUUID(), userId, randomUUID()],
    )
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      priority: 20,
      source: 'account_profile',
      reward_user_id: userId,
      use_priority_coupon: true,
      created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    }))

    expect((await getPriorityCouponBalances(userId))[0].available).toBe(0)
    await expect(store.expireQueuedJobs(new Date().toISOString())).resolves.toBeGreaterThanOrEqual(1)
    expect((await getPriorityCouponBalances(userId))[0].available).toBe(1)
    expect((await query<{ status: string }>(
      'select status from reward_consumptions where optimization_job_id = $1',
      [admitted.job.id],
    )).rows[0]?.status).toBe('refunded')
  })

  it('restores an unused strong reorder bonus when its queued job expires', async () => {
    const profileId = await seedProfile()
    const createdAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString()
    await query(
      `insert into profile_entitlements (profile_id, free_revision_count, strong_reorder_bonus_month, updated_at)
       values ($1, 0, $2, now())`,
      [profileId, shanghaiMonthKey(createdAt)],
    )
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      owner_key: `profile:${profileId}`,
      source: 'free_preview',
      free_profile_id: profileId,
      created_at: createdAt,
      payload_json: { freeScheduleDecision: { ok: true, mode: 'strong_reorder_bonus' } },
    }))

    expect((await query<{ strong_reorder_bonus_used_at: string | null }>(
      'select strong_reorder_bonus_used_at from profile_entitlements where profile_id = $1',
      [profileId],
    )).rows[0]?.strong_reorder_bonus_used_at).not.toBeNull()
    await expect(store.expireQueuedJobs(new Date().toISOString())).resolves.toBeGreaterThanOrEqual(1)
    expect((await query<{ status: string }>(
      "select status from entitlement_ledger where reference_type = 'optimization_job' and reference_id = $1",
      [admitted.job.id],
    )).rows[0]?.status).toBe('released')
    expect((await query<{ strong_reorder_bonus_used_at: string | null }>(
      'select strong_reorder_bonus_used_at from profile_entitlements where profile_id = $1',
      [profileId],
    )).rows[0]?.strong_reorder_bonus_used_at).toBeNull()
  })

  it('serializes running jobs per owner while allowing other owners to run', async () => {
    const store = createPostgresOptimizeJobStore()
    const owner = `license:serial-${randomUUID()}`
    const first = await store.createJob(input({ owner_key: owner, priority: 100_000 }))
    const second = await store.createJob(input({ owner_key: owner, priority: 99_999 }))
    const claims = await Promise.all([
      store.claimNextJob('parallel-a', randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 10),
      store.claimNextJob('parallel-b', randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 10),
    ])

    expect(claims.filter((job) => job?.owner_key === owner)).toHaveLength(1)
    expect((await query<{ count: string }>(
      "select count(*)::text as count from optimize_jobs where owner_key = $1 and status = 'running'",
      [owner],
    )).rows[0]?.count).toBe('1')
    expect([await store.getJob(first.id), await store.getJob(second.id)].filter((job) => job?.status === 'queued')).toHaveLength(1)

    for (const claimed of claims) {
      if (claimed) await store.failAttempt(claimed.id, claimed.attempt_count, claimed.worker_id!, claimed.lock_token!, 'test settlement')
    }
  })

  it('enforces the global running limit across concurrent dispatchers', async () => {
    const store = createPostgresOptimizeJobStore()
    const first = await store.createJob(input({ owner_key: `license:global-a-${randomUUID()}`, priority: 120_000 }))
    const second = await store.createJob(input({ owner_key: `license:global-b-${randomUUID()}`, priority: 119_999 }))
    const claims = await Promise.all([
      store.claimNextJob('global-worker-a', randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 1),
      store.claimNextJob('global-worker-b', randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 1),
    ])

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect((await query<{ count: string }>(
      "select count(*)::text as count from optimize_jobs where id = any($1::text[]) and status = 'running'",
      [[first.id, second.id]],
    )).rows[0]?.count).toBe('1')

    const claimed = claims.find((job) => job !== null)!
    await store.failAttempt(claimed.id, claimed.attempt_count, claimed.worker_id!, claimed.lock_token!, 'test settlement')
  })

  it('enforces a global queued capacity across different owners', async () => {
    const store = createPostgresOptimizeJobStore()
    await store.admitJob(input({ owner_key: `license:capacity-seed-${randomUUID()}` }))
    const queued = Number((await query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued'")).rows[0]?.count ?? 0)
    const previous = process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT
    process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT = String(Math.max(1, queued))
    try {
      await expect(store.admitJob(input({ owner_key: `license:capacity-rejected-${randomUUID()}` }))).rejects.toMatchObject({
        code: 'global_queue_capacity_exceeded',
        status: 429,
      })
    } finally {
      if (previous === undefined) delete process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT
      else process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT = previous
    }
  })

  it('cleans terminal jobs together with submission and idempotency metadata', async () => {
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({ priority: 200_000 }))
    const claimed = await store.claimNextJob('cleanup-worker', 'cleanup-lock', new Date(Date.now() + 60_000).toISOString(), 2, 10)
    expect(claimed?.id).toBe(admitted.job.id)
    await store.failAttempt(claimed!.id, claimed!.attempt_count, 'cleanup-worker', 'cleanup-lock', 'cleanup test')
    await query('update optimize_jobs set updated_at = $2 where id = $1', [admitted.job.id, '2020-01-01T00:00:00.000Z'])
    await query('update optimization_idempotency set updated_at = $2 where job_id = $1', [admitted.job.id, '2020-01-01T00:00:00.000Z'])
    await query('update optimization_submissions set created_at = $2 where owner_key = $1', [admitted.job.owner_key, '2020-01-01T00:00:00.000Z'])

    await store.cleanupOldJobs('2021-01-01T00:00:00.000Z')
    expect(await store.getJob(admitted.job.id)).toBeNull()
    expect((await query<{ count: string }>('select count(*)::text as count from optimization_idempotency where job_id = $1', [admitted.job.id])).rows[0]?.count).toBe('0')
    expect((await query<{ count: string }>('select count(*)::text as count from optimization_submissions where owner_key = $1', [admitted.job.owner_key])).rows[0]?.count).toBe('0')
  })

  it('reserves metered points atomically, settles success, and releases terminal failure', async () => {
    const store = createPostgresOptimizeJobStore()
    const { userId, profileId } = await seedMeteredProfile()
    await adjustBalance({
      userId, kind: 'admin_credit', amount: '2400.00', referenceType: 'admin_adjustment',
      referenceId: randomUUID(), idempotencyKey: `fund:${userId}`, adminUsername: 'root', reason: 'metered test',
    })
    const first = await store.admitJob(input({
      priority: 500_000, owner_key: `profile:${profileId}`, profile_id: profileId,
      permission: 'metered_advanced', billing: await meteredBillingConfirmation(userId, profileId),
    }))
    expect(first.job.billing_json).toMatchObject({ status: 'reserved', charge: '1000.00' })
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '1400.00', reserved: '1000.00' })
    const claimed = await store.claimNextJob('billing-success-worker', randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 100)
    expect(claimed?.id).toBe(first.job.id)
    await store.completeAttempt(claimed!.id, claimed!.attempt_count, claimed!.worker_id!, claimed!.lock_token!, { ok: true })
    expect((await store.getJob(first.job.id))?.billing_json?.status).toBe('settled')
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '1400.00', reserved: '0.00' })

    const second = await store.admitJob(input({
      priority: 500_001, owner_key: `profile:${profileId}`, profile_id: profileId,
      permission: 'metered_advanced', billing: await meteredBillingConfirmation(userId, profileId),
    }))
    const failedClaim = await store.claimNextJob('billing-failure-worker', randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 100)
    expect(failedClaim?.id).toBe(second.job.id)
    await store.failAttempt(failedClaim!.id, failedClaim!.attempt_count, failedClaim!.worker_id!, failedClaim!.lock_token!, 'expected failure')
    expect((await store.getJob(second.job.id))?.billing_json?.status).toBe('released')
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '1400.00', reserved: '0.00' })
    expect((await query<{ count: string }>("select count(*)::text as count from user_balance_transactions where user_id = $1 and kind = 'schedule_debit'", [userId])).rows[0]?.count).toBe('1')

    const pending = await store.admitJob(input({
      priority: 500_002, owner_key: `profile:${profileId}`, profile_id: profileId,
      permission: 'metered_advanced', billing: await meteredBillingConfirmation(userId, profileId),
    }))
    await query("update optimize_jobs set status = 'failed', updated_at = now() - interval '2 days' where id = $1", [pending.job.id])
    await store.cleanupOldJobs(new Date(Date.now() - 24 * 60 * 60_000).toISOString())
    expect(await store.getJob(pending.job.id)).not.toBeNull()
    expect((await query<{ status: string }>('select status from user_balance_reservations where job_id = $1', [pending.job.id])).rows[0]?.status).toBe('reserved')
    await store.reconcileBilling?.()
    await query("update optimize_jobs set updated_at = now() - interval '2 days' where id = $1", [pending.job.id])
    await store.cleanupOldJobs(new Date(Date.now() - 24 * 60 * 60_000).toISOString())
    expect(await store.getJob(pending.job.id)).toBeNull()
  })

  it('quotes commercial billing from net qualification points and free balance', async () => {
    const { userId, profileId } = await seedMeteredProfile()
    await query(
      `update user_game_accounts
          set kind = 'metered_commercial', record_json = record_json || '{"kind":"metered_commercial"}'::jsonb
        where id = $1`,
      [profileId],
    )
    await query(
      `insert into user_balance_accounts
        (user_id, available, reserved, lifetime_credited, qualification_reversed, debt, updated_at)
       values ($1, 1000, 250, 100000, 90000, 0, now())
       on conflict (user_id) do update
         set available = excluded.available,
             reserved = excluded.reserved,
             lifetime_credited = excluded.lifetime_credited,
             qualification_reversed = excluded.qualification_reversed,
             debt = excluded.debt,
             updated_at = excluded.updated_at`,
      [userId],
    )

    const quote = await issueMeteredScheduleQuote(userId, profileId)

    expect(quote).toMatchObject({
      billing_kind: 'metered_commercial',
      tier: 1,
      charge: '1350.00',
      available: '750.00',
      sufficient: false,
    })
  })

  it('rejects a confirmed commercial price after a qualification reversal raises the charge', async () => {
    const { userId, profileId } = await seedMeteredProfile()
    await query(
      `update user_game_accounts
          set kind = 'metered_commercial', record_json = record_json || '{"kind":"metered_commercial"}'::jsonb
        where id = $1`,
      [profileId],
    )
    const credit = await adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '30000.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `commercial-price-fund:${userId}`,
      adminUsername: 'operator',
      approvedBy: 'root',
      reason: 'commercial price revalidation test',
    })
    const billing = await meteredBillingConfirmation(userId, profileId)
    expect(billing.confirmation.acceptedMaxPoints).toBe('1250.00')
    await reverseQualificationCredit({
      userId,
      originalTransactionId: credit.transaction.id,
      amount: '20000.00',
      reason: 'qualification correction after quote',
      idempotencyKey: `commercial-price-reversal:${userId}`,
      adminUsername: 'operator',
      approvedBy: 'root',
    })

    await expect(createPostgresOptimizeJobStore().admitJob(input({
      priority: 500_005,
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      permission: 'metered_advanced',
      billing,
    }))).rejects.toMatchObject({ code: 'pricing_changed', status: 409 })
    expect((await query<{ count: string }>(
      'select count(*)::text as count from user_balance_reservations where profile_id = $1',
      [profileId],
    )).rows[0]?.count).toBe('0')
  })

  it('rejects reused and expired billing quote ids without creating another reservation', async () => {
    const store = createPostgresOptimizeJobStore()
    const used = await seedMeteredProfile()
    await adjustBalance({
      userId: used.userId,
      kind: 'admin_credit',
      amount: '1200.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `used-quote-fund:${used.userId}`,
      adminUsername: 'operator',
      approvedBy: 'root',
      reason: 'used quote test',
    })
    const usedBilling = await meteredBillingConfirmation(used.userId, used.profileId)
    await store.admitJob(input({
      priority: 500_006,
      owner_key: `profile:${used.profileId}`,
      profile_id: used.profileId,
      permission: 'metered_advanced',
      billing: usedBilling,
    }))
    await expect(store.admitJob(input({
      priority: 500_007,
      owner_key: `profile:${used.profileId}`,
      profile_id: used.profileId,
      permission: 'metered_advanced',
      billing: usedBilling,
    }))).rejects.toMatchObject({ code: 'quote_already_used', status: 409 })
    expect((await query<{ count: string }>(
      'select count(*)::text as count from user_balance_reservations where profile_id = $1',
      [used.profileId],
    )).rows[0]?.count).toBe('1')

    const expired = await seedMeteredProfile()
    await adjustBalance({
      userId: expired.userId,
      kind: 'admin_credit',
      amount: '1200.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `expired-quote-fund:${expired.userId}`,
      adminUsername: 'operator',
      approvedBy: 'root',
      reason: 'expired quote test',
    })
    const expiredBilling = await meteredBillingConfirmation(expired.userId, expired.profileId)
    await query('update metered_billing_quotes set expires_at = now() - interval \'1 second\' where id = $1', [
      expiredBilling.confirmation.quoteId,
    ])
    await expect(store.admitJob(input({
      priority: 500_008,
      owner_key: `profile:${expired.profileId}`,
      profile_id: expired.profileId,
      permission: 'metered_advanced',
      billing: expiredBilling,
    }))).rejects.toMatchObject({ code: 'pricing_changed', status: 409 })
    expect((await query<{ count: string }>(
      'select count(*)::text as count from user_balance_reservations where profile_id = $1',
      [expired.profileId],
    )).rows[0]?.count).toBe('0')
  })

  it('revalidates a commercial suspension inside the admission transaction', async () => {
    const { userId, profileId } = await seedMeteredProfile()
    await query(
      `update user_game_accounts
          set kind = 'metered_commercial', record_json = record_json || '{"kind":"metered_commercial"}'::jsonb
        where id = $1`,
      [profileId],
    )
    await adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '10000.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `commercial-fund:${userId}`,
      adminUsername: 'operator',
      approvedBy: 'root',
      reason: 'commercial admission race test',
    })
    const billing = await meteredBillingConfirmation(userId, profileId)
    await query(
      `insert into commercial_account_limits
        (user_id, active_profile_limit, total_profile_limit, suspended_at, suspension_reason, updated_at)
       values ($1, 100, 1000, now(), 'concurrent review', now())
       on conflict (user_id) do update
         set suspended_at = excluded.suspended_at,
             suspension_reason = excluded.suspension_reason,
             revision = commercial_account_limits.revision + 1,
             updated_at = excluded.updated_at`,
      [userId],
    )

    await expect(createPostgresOptimizeJobStore().admitJob(input({
      priority: 500_010,
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      permission: 'metered_advanced',
      billing,
    }))).rejects.toMatchObject({ code: 'commercial_suspended', status: 409 })
    expect((await query<{ count: string }>(
      'select count(*)::text as count from user_balance_reservations where profile_id = $1',
      [profileId],
    )).rows[0]?.count).toBe('0')
  })

  it('repairs balance projections and quarantines ambiguous billing mismatches', async () => {
    const { userId, profileId } = await seedMeteredProfile()
    await adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '1200.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `reconciliation-fund:${userId}`,
      adminUsername: 'operator',
      approvedBy: 'root',
      reason: 'billing reconciliation test',
    })
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      priority: 500_020,
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      permission: 'metered_advanced',
      billing: await meteredBillingConfirmation(userId, profileId),
    }))
    await query('update user_balance_accounts set reserved = 700 where user_id = $1', [userId])

    const repaired = await store.reconcileBilling?.()

    expect(repaired?.repaired).toBeGreaterThanOrEqual(1)
    expect((await query<{ reserved: string }>(
      'select reserved::text from user_balance_accounts where user_id = $1',
      [userId],
    )).rows[0]?.reserved).toBe('1000.00')
    expect((await query<{ status: string }>(
      "select status from billing_reconciliation_cases where kind = 'account_projection_mismatch' and user_id = $1 order by last_seen_at desc limit 1",
      [userId],
    )).rows[0]?.status).toBe('resolved')

    await query("update user_balance_reservations set status = 'consumed', settled_at = now() where job_id = $1", [admitted.job.id])
    await query('update user_balance_accounts set reserved = 0 where user_id = $1', [userId])
    await query("update optimize_jobs set status = 'failed', finished_at = now(), updated_at = now() where id = $1", [admitted.job.id])

    const quarantined = await store.reconcileBilling?.()

    expect(quarantined?.quarantined).toBeGreaterThanOrEqual(1)
    expect((await query<{ status: string }>(
      "select status from billing_reconciliation_cases where kind = 'reservation_job_mismatch' and job_id = $1",
      [admitted.job.id],
    )).rows[0]?.status).toBe('pending_review')
    expect((await query<{ status: string }>(
      'select status from user_balance_reservations where job_id = $1',
      [admitted.job.id],
    )).rows[0]?.status).toBe('consumed')
  })

  it('preserves both concurrent workspace updates under the profile lock', async () => {
    const profileId = await seedProfile()
    await saveWorkspace(emptyWorkspace(profileId))
    await Promise.all([
      updateProfileWorkspaceAtomically(profileId, (workspace) => ({
        ...(workspace ?? emptyWorkspace(profileId)),
        elite_overrides: { ...(workspace?.elite_overrides ?? {}), alpha: 1 },
        updated_at: new Date().toISOString(),
      })),
      updateProfileWorkspaceAtomically(profileId, (workspace) => ({
        ...(workspace ?? emptyWorkspace(profileId)),
        elite_overrides: { ...(workspace?.elite_overrides ?? {}), beta: 2 },
        updated_at: new Date().toISOString(),
      })),
    ])

    await expect(getWorkspace(profileId)).resolves.toMatchObject({ elite_overrides: { alpha: 1, beta: 2 } })
  })

  it('persists a successful schedule into rolling workspace history and a durable effect outbox', async () => {
    const profileId = await seedProfile()
    const existingHistory = Array.from({ length: 6 }, (_, index) => ({
      id: `history-${index}`,
      name: `History ${index}`,
      created_at: new Date(Date.parse('2026-07-01T00:00:00.000Z') - index * 1_000).toISOString(),
      config: formalConfig(),
      result: formalScheduleResult(`old-${index}`),
      operator_count: 1,
      source: 'generated' as const,
    }))
    await saveWorkspace({
      ...emptyWorkspace(profileId),
      operators: formalOperators(),
      config: formalConfig(),
    })
    await withTransaction(async (client) => {
      for (const item of [...existingHistory].reverse()) {
        await insertProfileOptimizationResultInTransaction(client, profileId, item, 6)
      }
    })
    await query(
      `insert into profile_entitlement_balances (profile_id, entitlement_type, units, updated_at)
       values ($1, 'history_slots', 1, now())`,
      [profileId],
    )
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      priority: 2_100_000_000,
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      source: 'account_profile',
      payload_json: formalSchedulePayload(profileId),
    }))
    const claimed = await store.claimNextJob('schedule-success-worker', 'schedule-success-lock', new Date(Date.now() + 60_000).toISOString(), 2, 100)
    expect(claimed?.id).toBe(admitted.job.id)

    await expect(store.completeAttempt(
      claimed!.id,
      claimed!.attempt_count,
      'schedule-success-worker',
      'schedule-success-lock',
      formalScheduleResult('new-result'),
    )).resolves.toBe(true)

    const history = await listProfileOptimizationResults(profileId, 'active', { limit: 50 })
    expect(history.items).toHaveLength(6)
    expect(history.items.map((item) => item.id)).toEqual([
      admitted.job.id,
      'history-0',
      'history-1',
      'history-2',
      'history-3',
      'history-4',
    ])
    expect(history.items[0]).toMatchObject({
      id: admitted.job.id,
      job_id: admitted.job.id,
    })
    await expect(getLatestProfileOptimizationResult(profileId)).resolves.toMatchObject({
      id: admitted.job.id,
      result: { title: 'new-result' },
    })
    expect((await query<{ effect_type: string; status: string | null }>(
      `select effect_type, metadata_json->>'status' as status
       from optimization_job_effects where job_id = $1 order by effect_type`,
      [admitted.job.id],
    )).rows).toEqual([
      { effect_type: 'schedule_completion', status: 'pending' },
      { effect_type: 'workspace_schedule_result', status: null },
    ])
    await expect(store.completeAttempt(
      claimed!.id,
      claimed!.attempt_count,
      'schedule-success-worker',
      'schedule-success-lock',
      formalScheduleResult('duplicate'),
    )).resolves.toBe(false)
    expect((await listProfileOptimizationResults(profileId, 'active', { limit: 50 })).items).toHaveLength(6)
  })

  it('rejects an invalid formal optimizer result without charging or persisting success effects', async () => {
    const { userId, profileId } = await seedMeteredProfile()
    await adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '1200.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `invalid-result-fund:${userId}`,
      adminUsername: 'root',
      reason: 'invalid result test',
    })
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({
      priority: 2_120_000_000,
      owner_key: `profile:${profileId}`,
      profile_id: profileId,
      permission: 'metered_advanced',
      source: 'account_profile',
      payload_json: formalSchedulePayload(profileId),
      billing: await meteredBillingConfirmation(userId, profileId),
    }))
    const claimed = await store.claimNextJob('invalid-result-worker', 'invalid-result-lock', new Date(Date.now() + 60_000).toISOString(), 2, 100)
    expect(claimed?.id).toBe(admitted.job.id)

    await expect(store.completeAttempt(
      claimed!.id,
      claimed!.attempt_count,
      'invalid-result-worker',
      'invalid-result-lock',
      { ok: true },
    )).resolves.toBe(false)

    await expect(store.getJob(admitted.job.id)).resolves.toMatchObject({
      status: 'failed',
      failure_kind: 'validation_error',
      public_error_code: 'invalid_optimizer_result',
      billing_json: { status: 'released' },
    })
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '1200.00', reserved: '0.00' })
    expect((await query<{ count: string }>(
      "select count(*)::text as count from user_balance_transactions where user_id = $1 and kind = 'schedule_debit'",
      [userId],
    )).rows[0]?.count).toBe('0')
    expect((await query<{ count: string }>(
      'select count(*)::text as count from optimization_job_effects where job_id = $1',
      [admitted.job.id],
    )).rows[0]?.count).toBe('0')
    expect((await listProfileOptimizationResults(profileId, 'active')).items).toHaveLength(0)
  })

  it('commits and rolls back workspace and operator fingerprint updates together', async () => {
    const profileId = await seedProfile()
    const codeHash = randomUUID().replaceAll('-', '')
    const key = `cdk/${codeHash}.json`
    const now = new Date().toISOString()
    const record = {
      version: 1 as const,
      code_hash: codeHash,
      permission: 'advanced' as const,
      status: 'used' as const,
      created_at: now,
      used_at: now,
      order_note: null,
      license_order_hash: randomUUID(),
      operator_count: null,
      config_desc: null,
    }
    const fingerprint = {
      hash: 'f'.repeat(64),
      owned_count: 1,
      operators: { alpha: { name: '测试干员', own: true, elite: 1, rarity: 5 } },
    }
    await saveWorkspace(emptyWorkspace(profileId))
    await query(
      `insert into cdk_records
        (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
       values ($1, $2, 'used', 'advanced', $3, $4::jsonb, $5, $5)`,
      [key, codeHash, record.license_order_hash, JSON.stringify(record), now],
    )

    await expect(withTransaction(async (client) => {
      await updateProfileWorkspaceInTransaction(client, profileId, (workspace) => ({
        ...(workspace ?? emptyWorkspace(profileId)),
        elite_overrides: { alpha: 1 },
        updated_at: now,
      }))
      await recordOperatorFingerprintInTransaction(client, record, fingerprint)
      throw new Error('injected transaction failure')
    })).rejects.toThrow('injected transaction failure')

    await expect(getWorkspace(profileId)).resolves.toMatchObject({ elite_overrides: {} })
    expect((await query<{ record_json: typeof record & { latest_operator_fingerprint?: unknown } }>(
      'select record_json from cdk_records where key = $1',
      [key],
    )).rows[0]?.record_json.latest_operator_fingerprint).toBeUndefined()

    await withTransaction(async (client) => {
      await updateProfileWorkspaceInTransaction(client, profileId, (workspace) => ({
        ...(workspace ?? emptyWorkspace(profileId)),
        elite_overrides: { alpha: 1 },
        updated_at: now,
      }))
      await recordOperatorFingerprintInTransaction(client, record, fingerprint)
    })

    await expect(getWorkspace(profileId)).resolves.toMatchObject({ elite_overrides: { alpha: 1 } })
    expect((await query<{ record_json: { latest_operator_fingerprint?: { hash: string } } }>(
      'select record_json from cdk_records where key = $1',
      [key],
    )).rows[0]?.record_json.latest_operator_fingerprint?.hash).toBe(fingerprint.hash)
  })
})

function input(overrides: Partial<Parameters<ReturnType<typeof createPostgresOptimizeJobStore>['admitJob']>[0]> = {}) {
  return {
    id: randomUUID(),
    priority: 10,
    owner_key: `license:${randomUUID()}`,
    permission: 'growth',
    source: 'account_profile',
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
    `insert into user_game_accounts (id, user_id, permission, status, display_name, note, kind, record_json, created_at, updated_at)
     values ($1, $2, 'growth', 'active', 'Free', '', 'free_preview', $3::jsonb, now(), now())`,
    [profileId, userId, JSON.stringify({ id: profileId, user_id: userId })],
  )
  return profileId
}

function formalOperators() {
  return [{ id: 'op-1', name: 'Operator', own: true, elite: 2, rarity: 6 }]
}

function formalConfig() {
  return {
    layout: '243', desc: 'test', schedule_mode: 'maa', trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: { trading_stations: { lmd: 2 }, manufacturing_stations: { pure_gold: 4 } },
  }
}

function formalSchedulePayload(profileId: string) {
  return {
    version: 3,
    submittedAt: Date.now(),
    operators: formalOperators(),
    effectiveConfig: formalConfig(),
    scheduleUsageBase: { profile_id: profileId, permission: 'growth', source: 'optimize' },
    activeProfileId: profileId,
    isPreviewProfile: false,
    isPreviewTrial: false,
    freeScheduleDecision: null,
    estimate: { estimated_duration_ms: 2_000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95', estimate_sample_count: 0 },
    request: { include_upgrade_suggestions: false, upgrade_suggestions_allowed: false, history_source: 'generated' },
    configPermission: 'growth',
    cdkUsageRef: null,
  }
}

function formalScheduleResult(title: string) {
  return { author: 'test', title, description: title, buildingType: 2, planTimes: '8h', plans: [], raw_results: [] }
}

function formalReorderPayload(profileId: string) {
  return {
    version: 3 as const,
    kind: 'reorder_check' as const,
    submittedAt: Date.now(),
    operators: formalOperators(),
    effectiveConfig: formalConfig(),
    activeProfileId: profileId,
    isPreviewTrial: false,
    baseline: {
      id: `history-${profileId}`,
      name: 'History',
      created_at: '2026-07-31T00:00:00.000Z',
      config: formalConfig(),
      result: formalScheduleResult('baseline'),
      operator_count: 1,
      source: 'generated' as const,
    },
    estimate: { estimated_duration_ms: 2_000, estimate_bucket: 'maa_plain' as const, estimate_source: 'fallback_p95' as const, estimate_sample_count: 0 },
  }
}

function formalReorderResult(
  payload: ReturnType<typeof formalReorderPayload>,
  recommendation: 'recommended' | 'strongly_recommended',
) {
  return {
    recommendation,
    estimated_gain_range: { min: 1, max: 2, unit: 'equivalent_sanity_per_day' as const, label: '1-2' },
    changed_room_count: 1,
    affected_facility_types: ['trading'],
    key_operators: [],
    current_plan_usable: true,
    quota: { limit: 2 as const, used: 0, remaining: 2, reset_at: '2026-08-31T16:00:00.000Z', timezone: 'Asia/Shanghai' as const },
    baseline: {
      history_id: payload.baseline.id,
      created_at: payload.baseline.created_at,
      name: payload.baseline.name,
    },
    reasons: ['存在可验证的房间调整收益。'],
  }
}

async function seedMeteredProfile(): Promise<{ userId: string; profileId: string }> {
  const userId = randomUUID()
  const profileId = randomUUID()
  await query(
    `insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
     values ($1, $2, 'hash', 'salt', 1, 'growth', 'active', $3::jsonb, now(), now())`,
    [userId, `${userId}@example.test`, JSON.stringify({ id: userId })],
  )
  const profile = {
    version: 1, id: profileId, user_id: userId, kind: 'metered_personal', permission: 'metered_advanced',
    status: 'active', display_name: 'Metered', note: '', cdk_key: null, cdk_code_hash: null,
    cdk_order_hash: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  await query(
    `insert into user_game_accounts
      (id, user_id, permission, status, display_name, note, kind, record_json, created_at, updated_at)
     values ($1, $2, 'metered_advanced', 'active', 'Metered', '', 'metered_personal', $3::jsonb, now(), now())`,
    [profileId, userId, JSON.stringify(profile)],
  )
  return { userId, profileId }
}

async function meteredBillingConfirmation(userId: string, profileId: string) {
  const quote = await issueMeteredScheduleQuote(userId, profileId)
  return {
    userId,
    operation: 'main_schedule' as const,
    billingKind: quote.billing_kind,
    confirmation: {
      quoteId: quote.quote_id,
      pricingVersion: quote.pricing_version,
      acceptedMaxPoints: quote.charge,
    },
  }
}

function shanghaiMonthKey(value: string): string {
  const shanghai = new Date(Date.parse(value) + 8 * 60 * 60_000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

describe('worker claim priority (postgres)', () => {
  async function resetPriorityWorkers(): Promise<void> {
    await query(`delete from optimize_worker_registry where worker_id like 'hz-%' or worker_id like 'resident-%'`)
  }

  it('prefers a live higher-priority worker over the resident fallback', async () => {
    await resetPriorityWorkers()
    const store = createPostgresOptimizeJobStore()
    const highWorker = `hz-${randomUUID()}`
    const lowWorker = `resident-${randomUUID()}`
    await query(
      `insert into optimize_worker_registry
         (worker_id, concurrency, heartbeat_interval_ms, stale_after_ms, capabilities, build_sha, started_at, heartbeat_at, draining)
       values ($1, 1, 10000, 30000, $2::text[], 'test-sha', now(), now(), false)`,
      [highWorker, ['optimize_jobs', 'worker-claim-priority:10']],
    )
    const admitted = await store.admitJob(input({ priority: 2_000_000_000 }))
    await expect(
      store.claimNextJob(lowWorker, randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 10, 0),
    ).resolves.toBeNull()
    await expect(
      store.claimNextJob(highWorker, randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 10, 10),
    ).resolves.toMatchObject({ id: admitted.job.id })
  })

  it('lets the resident fallback claim when the higher-priority worker is stale or draining', async () => {
    await resetPriorityWorkers()
    const store = createPostgresOptimizeJobStore()
    const lowWorker = `resident-${randomUUID()}`
    const cases = [
      { label: 'stale', heartbeatAgoMs: 60_000, draining: false },
      { label: 'draining', heartbeatAgoMs: 0, draining: true },
    ]
    for (const testCase of cases) {
      const highWorker = `hz-${testCase.label}-${randomUUID()}`
      const heartbeatAt = new Date(Date.now() - testCase.heartbeatAgoMs).toISOString()
      await query(
        `insert into optimize_worker_registry
           (worker_id, concurrency, heartbeat_interval_ms, stale_after_ms, capabilities, build_sha, started_at, heartbeat_at, draining)
         values ($1, 1, 10000, 30000, $2::text[], 'test-sha', $3, $3, $4)`,
        [highWorker, ['optimize_jobs', 'worker-claim-priority:10'], heartbeatAt, testCase.draining],
      )
      const admitted = await store.admitJob(input({ priority: 2_000_000_000 }))
      await expect(
        store.claimNextJob(lowWorker, randomUUID(), new Date(Date.now() + 60_000).toISOString(), 2, 10, 0),
      ).resolves.toMatchObject({ id: admitted.job.id })
    }
  })
})
