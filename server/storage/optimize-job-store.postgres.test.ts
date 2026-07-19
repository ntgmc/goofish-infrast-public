import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, getPool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  createPostgresOptimizeJobStore,
  getAdminOptimizationQueueSnapshot,
  OptimizeJobAdmissionError,
} from './optimize-job-store'
import { emptyWorkspace, getWorkspace, saveWorkspace, updateProfileWorkspaceAtomically } from './user-store'
import {
  ensureInvitationCode,
  getRewardBalances,
  saveInvitationSettings,
  settleInvitationForActivatedUser,
} from './invitation-store'
import { getFreeScheduleEntitlement } from './reorder-admission'

let container: PostgreSqlContainer
const legacyJobId = randomUUID()
const legacyJobCreatedAt = '2026-01-01T00:00:00.000Z'

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
      [['expires_at', 'next_attempt_at']],
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual(['expires_at', 'next_attempt_at'])

    const backfill = await query<{ expires_at_backfilled: boolean; next_attempt_at_backfilled: boolean }>(
      `select
         next_attempt_at = created_at as next_attempt_at_backfilled,
         expires_at = created_at + interval '30 minutes' as expires_at_backfilled
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
    await expect(ensureDatabaseSchema()).resolves.toBeUndefined()
  })

  it('handles unexpected errors from idle pool clients', () => {
    expect(getPool().listenerCount('error')).toBeGreaterThan(0)
  })

  it('reads an ordered safe admin queue snapshot with user and profile context', async () => {
    const profileId = await seedProfile()
    const queuedHighId = randomUUID()
    const queuedRetryId = randomUUID()
    const runningId = randomUUID()
    const failedId = randomUUID()
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

      const snapshot = await getAdminOptimizationQueueSnapshot(4)
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

  it('counts upgrade suggestion continuations separately from paid submissions', async () => {
    const store = createPostgresOptimizeJobStore()
    const owner = `license:${randomUUID()}`

    for (let index = 0; index < 12; index += 1) {
      const schedule = await store.admitJob(input({ owner_key: owner }))
      await query("update optimize_jobs set status = 'succeeded', updated_at = now() where id = $1", [schedule.job.id])

      const suggestions = await store.admitJob(input({ owner_key: owner, source: 'optimize_suggestions' }))
      await query("update optimize_jobs set status = 'succeeded', updated_at = now() where id = $1", [suggestions.job.id])
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
    await saveInvitationSettings({
      rewards: [
        { recipient: 'inviter', type: 'priority_compute_coupon', quantity: 1, validity_days: 0 },
        { recipient: 'invitee', type: 'priority_compute_coupon', quantity: 1, validity_days: 30 },
      ],
    })
    await Promise.all(Array.from({ length: 4 }, () => settleInvitationForActivatedUser(invitee)))
    expect((await getRewardBalances(inviter))[0].available).toBe(1)
    expect((await getRewardBalances(invitee))[0].available).toBe(1)
    expect((await query<{ count: string }>('select count(*)::text as count from reward_grants where source_type = $1 and user_id = $2', ['invitation', inviter])).rows[0]?.count).toBe('1')
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
    expect((await getRewardBalances(userId))[0].available).toBe(0)
    const claimed = await store.claimNextJob('test-worker', 'coupon-lock', new Date(Date.now() + 60_000).toISOString(), 2)
    expect(claimed?.id).toBe(admitted.job.id)
    await store.failAttempt(admitted.job.id, claimed!.attempt_count, 'test-worker', 'coupon-lock', 'system failure')
    await store.failAttempt(admitted.job.id, claimed!.attempt_count, 'test-worker', 'coupon-lock', 'duplicate failure')
    expect((await getRewardBalances(userId))[0].available).toBe(1)
    expect((await query<{ status: string }>('select status from reward_consumptions where optimization_job_id = $1', [admitted.job.id])).rows[0]?.status).toBe('refunded')
  })

  it('records attempt heartbeats and releases deployment interruptions without failure budget', async () => {
    const store = createPostgresOptimizeJobStore()
    const admitted = await store.admitJob(input({ priority: 1_000 }))
    const claimed = await store.claimNextJob('worker-a', 'attempt-lock', new Date(Date.now() + 60_000).toISOString(), 2)
    expect(claimed?.id).toBe(admitted.job.id)

    await expect(store.heartbeatAttempt(admitted.job.id, claimed!.attempt_count, 'worker-b', 'attempt-lock', new Date(Date.now() + 60_000).toISOString())).resolves.toBe(false)
    await expect(store.heartbeatAttempt(admitted.job.id, claimed!.attempt_count, 'worker-a', 'attempt-lock', new Date(Date.now() + 60_000).toISOString())).resolves.toBe(true)
    await expect(store.releaseInterruptedAttempt(admitted.job.id, claimed!.attempt_count, 'worker-a', 'attempt-lock')).resolves.toBe(true)

    expect(await store.getJob(admitted.job.id)).toMatchObject({ status: 'queued', failure_count: 0, attempt_count: 1 })
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

  it('expires never-started jobs and releases their reserved free entitlement', async () => {
    const profileId = await seedProfile()
    const store = createPostgresOptimizeJobStore()
    const createdAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
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
      created_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    }))

    expect((await getRewardBalances(userId))[0].available).toBe(0)
    await expect(store.expireQueuedJobs(new Date().toISOString())).resolves.toBeGreaterThanOrEqual(1)
    expect((await getRewardBalances(userId))[0].available).toBe(1)
    expect((await query<{ status: string }>(
      'select status from reward_consumptions where optimization_job_id = $1',
      [admitted.job.id],
    )).rows[0]?.status).toBe('refunded')
  })

  it('restores an unused strong reorder bonus when its queued job expires', async () => {
    const profileId = await seedProfile()
    const createdAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
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
    `insert into user_game_accounts (id, user_id, permission, status, display_name, note, record_json, created_at, updated_at)
     values ($1, $2, 'free_preview', 'active', 'Free', '', $3::jsonb, now(), now())`,
    [profileId, userId, JSON.stringify({ id: profileId, user_id: userId })],
  )
  return profileId
}

function shanghaiMonthKey(value: string): string {
  const shanghai = new Date(Date.parse(value) + 8 * 60 * 60_000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}
