import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { getOptimizeGlobalWorkerConcurrency, getOptimizeJobHardTimeoutMs } from '../optimize-job-config'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  consumePriorityCouponInTransaction,
  PriorityCouponUnavailableError,
  refundPriorityCouponInTransaction,
} from './invitation-store'

export type OptimizeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead_lettered'
export type OptimizeJobPriority = 'priority_coupon' | 'paid' | 'analysis' | 'standard'
type OptimizeJobAttemptStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'interrupted' | 'lease_lost' | 'cancelled'
export type OptimizeJobFailureKind = 'application_error' | 'worker_crash' | 'timed_out' | 'lease_lost'

export interface OptimizeJobRecord<TPayload = unknown, TResult = unknown> {
  id: string
  status: OptimizeJobStatus
  priority: number
  owner_key: string
  profile_id: string | null
  permission: string | null
  source: string
  payload_json: TPayload
  result_json: TResult | null
  error_message: string | null
  failure_kind: string | null
  public_error_code: string | null
  attempt_count: number
  failure_count: number
  worker_id: string | null
  heartbeat_at: string | null
  lock_token: string | null
  lock_expires_at: string | null
  next_attempt_at: string | null
  expires_at: string | null
  cancel_requested_at: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

interface CreateOptimizeJobInput<TPayload = unknown> {
  id: string
  priority: number
  owner_key: string
  profile_id?: string | null
  permission: string | null
  source: string
  payload_json: TPayload
  created_at?: string
}

interface AdmitOptimizeJobInput<TPayload = unknown> extends CreateOptimizeJobInput<TPayload> {
  idempotency_key: string
  request_hash: string
  free_profile_id?: string | null
  reward_user_id?: string | null
  use_priority_coupon?: boolean
}

export class OptimizeJobAdmissionError extends Error {
  constructor(
    readonly code: 'idempotency_conflict' | 'idempotency_in_progress' | 'active_job_exists' | 'queue_capacity_exceeded' | 'global_queue_capacity_exceeded' | 'queue_wait_capacity_exceeded' | 'submission_rate_exceeded' | 'free_revision_limit_exceeded' | 'priority_coupon_unavailable',
    readonly status: 409 | 429,
    message: string,
  ) {
    super(message)
    this.name = 'OptimizeJobAdmissionError'
  }
}

export interface OptimizeJobStore {
  createJob: (input: CreateOptimizeJobInput) => Promise<OptimizeJobRecord>
  admitJob: (input: AdmitOptimizeJobInput) => Promise<{ job: OptimizeJobRecord; replayed: boolean }>
  getJob: (id: string) => Promise<OptimizeJobRecord | null>
  listJobsByProfile: (profileId: string, limit?: number, before?: string | null) => Promise<OptimizeJobRecord[]>
  findActiveByOwnerKey: (ownerKey: string) => Promise<OptimizeJobRecord | null>
  getQueuePosition: (id: string) => Promise<number | null>
  claimNextJob: (workerId: string, lockToken: string, lockExpiresAt: string, maxFailures: number, maxGlobalRunning?: number) => Promise<OptimizeJobRecord | null>
  heartbeatAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, lockExpiresAt: string) => Promise<boolean>
  ownsAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  completeAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, result: unknown) => Promise<boolean>
  failAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, errorMessage: string) => Promise<boolean>
  retryFailedAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, failureKind: OptimizeJobFailureKind, errorMessage: string, maxFailures: number) => Promise<OptimizeJobStatus | null>
  releaseInterruptedAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  requestCancel: (id: string) => Promise<OptimizeJobRecord | null>
  cancelAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  recoverExpiredAttempts: (nowIso: string, maxFailures: number) => Promise<number>
  expireQueuedJobs: (nowIso: string) => Promise<number>
  cleanupOldJobs: (beforeIso: string) => Promise<void>
}

export interface OptimizationDeadLetterRecord {
  id: string
  job_id: string
  owner_key: string
  profile_id: string | null
  source: string
  failure_kind: string
  public_error_code: string
  internal_error_message: string
  diagnostic_json: Record<string, unknown>
  attempt_count: number
  status: 'pending_review' | 'replayed' | 'discarded' | 'resolved'
  replay_count: number
  replayed_job_id: string | null
  replayed_by: string | null
  replayed_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface OptimizationDeadLetterDetail extends OptimizationDeadLetterRecord {
  payload_json: unknown
}

interface AdminOptimizationQueueJob {
  id: string
  status: OptimizeJobStatus
  queue_position: number | null
  source: string
  priority: {
    value: number
    label: '优先券' | '付费任务' | '分析任务' | '标准任务'
  }
  permission: string | null
  user: { id: string; email: string } | null
  profile: { id: string; display_name: string } | null
  attempt_count: number
  failure_count: number
  worker_id: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
  heartbeat_at: string | null
  next_attempt_at: string | null
  expires_at: string | null
  cancel_requested_at: string | null
  failure_kind: string | null
  public_error_code: string | null
  error_summary: string | null
}

export interface AdminOptimizationQueueSnapshot {
  snapshot_at: string
  capacity: {
    queue_limit: number
    worker_concurrency: number
  }
  counts: {
    queued: number
    running: number
    retry_waiting: number
    recent_failed: number
  }
  queued_jobs: AdminOptimizationQueueJob[]
  running_jobs: AdminOptimizationQueueJob[]
  recent_jobs: AdminOptimizationQueueJob[]
}

declare global {
  var __maaOptimizeJobStoreForTesting: OptimizeJobStore | undefined
}

let schemaReady: Promise<void> | null = null

export function getOptimizeJobStore(): OptimizeJobStore {
  return globalThis.__maaOptimizeJobStoreForTesting ?? createPostgresOptimizeJobStore()
}

export function createPostgresOptimizeJobStore(): OptimizeJobStore {
  return {
    createJob: async (input) => {
      await ensureSchema()
      const now = input.created_at ?? new Date().toISOString()
      const result = await query<OptimizeJobRow>([
        'insert into optimize_jobs',
        '  (id, status, priority, owner_key, profile_id, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, next_attempt_at, expires_at, created_at, started_at, finished_at, updated_at)',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, 0, null, null, $9, $10, $9, null, null, $9)',
        'returning *',
      ].join(' '), [input.id, 'queued', input.priority, input.owner_key, input.profile_id ?? null, input.permission, input.source, input.payload_json, now, queueExpiresAt(now)])
      return fromRow(result.rows[0])
    },
    admitJob: async (input) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const now = input.created_at ?? new Date().toISOString()
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [input.owner_key])
        await client.query("select pg_advisory_xact_lock(hashtextextended('optimize:global-admission', 0))")
        const duplicate = await client.query<{ request_hash: string; status: string; job_id: string | null }>(
          `select request_hash, status, job_id from optimization_idempotency
           where owner_key = $1 and idempotency_key = $2 for update`,
          [input.owner_key, input.idempotency_key],
        )
        const existing = duplicate.rows[0]
        if (existing) {
          if (existing.request_hash !== input.request_hash) {
            throw new OptimizeJobAdmissionError('idempotency_conflict', 409, 'Idempotency-Key is already used for a different request.')
          }
          if (!existing.job_id || existing.status !== 'accepted') {
            throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
          }
          const job = await client.query<OptimizeJobRow>('select * from optimize_jobs where id = $1', [existing.job_id])
          if (!job.rows[0]) throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
          return { job: fromRow(job.rows[0]), replayed: true }
        }

        const limits = input.source === 'free_preview'
          ? { running: 1, queued: 0, perHour: 2 }
          : { running: 1, queued: 3, perHour: 12 }
        const current = await client.query<{ running: string; queued: string }>(
          `select count(*) filter (where status = 'running')::text as running,
                  count(*) filter (where status = 'queued')::text as queued
           from optimize_jobs where owner_key = $1 and status in ('queued', 'running')`,
          [input.owner_key],
        )
        const running = Number(current.rows[0]?.running ?? 0)
        const queued = Number(current.rows[0]?.queued ?? 0)
        const globalQueued = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued'")
        if (Number(globalQueued.rows[0]?.count ?? 0) >= getOptimizeGlobalQueueLimit()) {
          throw new OptimizeJobAdmissionError('global_queue_capacity_exceeded', 429, '优化服务全局队列已满，请稍后重试。')
        }
        if (input.source === 'scenario_comparison') {
          const analysisQueued = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued' and source = 'scenario_comparison'")
          if (Number(analysisQueued.rows[0]?.count ?? 0) >= analysisQueueLimit()) {
            throw new OptimizeJobAdmissionError('global_queue_capacity_exceeded', 429, '场景分析队列已满，请稍后重试。')
          }
        }
        const activeQueue = await client.query<OptimizeQueueCapacityRow>(
          `select status, priority, owner_key, payload_json, created_at, started_at
           from optimize_jobs where status in ('queued', 'running')`,
        )
        assertOptimizeQueueWaitCapacity(activeQueue.rows.map(fromQueueCapacityRow), input.owner_key, now)
        if (input.source === 'free_preview' && running + queued > 0) {
          throw new OptimizeJobAdmissionError('active_job_exists', 429, '当前已有一个免费优化任务正在排队或执行。')
        }
        if (running >= limits.running || queued >= limits.queued + (input.source === 'free_preview' ? 1 : 0)) {
          throw new OptimizeJobAdmissionError('queue_capacity_exceeded', 429, '当前账号的优化队列已满，请稍后重试。')
        }
        const submitted = await client.query<{ count: string }>(
          `select count(*)::text as count from optimization_submissions
           where owner_key = $1 and created_at >= now() - interval '1 hour'`, [input.owner_key],
        )
        if (Number(submitted.rows[0]?.count ?? 0) >= limits.perHour) {
          throw new OptimizeJobAdmissionError('submission_rate_exceeded', 429, '当前账号的优化提交次数已达小时上限。请1小时后再试。')
        }

        if (input.free_profile_id) {
          await client.query(
            `insert into profile_entitlements (profile_id, free_revision_count, updated_at)
             values ($1, 0, now()) on conflict (profile_id) do nothing`, [input.free_profile_id],
          )
          const entitlement = await client.query<{
            first_generated_at: string | null; free_revision_count: number; confirmed_at: string | null; locked_at: string | null;
            strong_reorder_bonus_month: string | null; strong_reorder_bonus_used_at: string | null;
          }>(`select first_generated_at, free_revision_count, confirmed_at, locked_at,
                     strong_reorder_bonus_month, strong_reorder_bonus_used_at
              from profile_entitlements where profile_id = $1 for update`, [input.free_profile_id])
          const row = entitlement.rows[0]
          const month = shanghaiMonthKey(new Date(now))
          const bonusAvailable = row?.strong_reorder_bonus_month === month && !row.strong_reorder_bonus_used_at
          const windowExpired = row?.first_generated_at && Date.parse(row.first_generated_at) + 24 * 60 * 60_000 <= Date.parse(now)
          if (!row || row.confirmed_at || row.locked_at || (!bonusAvailable && (windowExpired || Number(row.free_revision_count) >= 3))) {
            throw new OptimizeJobAdmissionError('free_revision_limit_exceeded', 429, '免费排班次数已用完，请确认方案或稍后再试。')
          }
          await client.query(
            bonusAvailable
              ? `update profile_entitlements set strong_reorder_bonus_used_at = $2, updated_at = $2 where profile_id = $1`
              : `update profile_entitlements
                 set first_generated_at = coalesce(first_generated_at, $2), free_revision_count = free_revision_count + 1,
                     locked_at = case when free_revision_count + 1 >= 3 then $2 else locked_at end,
                     lock_reason = case when free_revision_count + 1 >= 3 then 'revision_limit' else lock_reason end,
                     updated_at = $2 where profile_id = $1`,
            [input.free_profile_id, now],
          )
          await client.query(
            `insert into entitlement_ledger (id, profile_id, entitlement_type, status, reference_type, reference_id, window_key, created_at)
             values ($1, $2, 'free_schedule', 'reserved', 'optimization_job', $3, $4, $5)`,
            [randomUUID(), input.free_profile_id, input.id, month, now],
          )
        }

        if (input.use_priority_coupon) {
          if (!input.reward_user_id) throw new OptimizeJobAdmissionError('priority_coupon_unavailable', 409, '没有可用的优先计算券。')
          try {
            await consumePriorityCouponInTransaction(client, input.reward_user_id, input.id, now)
          } catch (error) {
            if (error instanceof PriorityCouponUnavailableError) {
              throw new OptimizeJobAdmissionError('priority_coupon_unavailable', 409, error.message)
            }
            throw error
          }
        }

        const inserted = await client.query<OptimizeJobRow>([
          'insert into optimize_jobs',
          '  (id, status, priority, owner_key, profile_id, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, next_attempt_at, expires_at, created_at, started_at, finished_at, updated_at)',
          'values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, 0, null, null, $9, $10, $9, null, null, $9)',
          'returning *',
        ].join(' '), [input.id, 'queued', input.priority, input.owner_key, input.profile_id ?? null, input.permission, input.source, input.payload_json, now, queueExpiresAt(now)])
        await client.query('insert into optimization_submissions (id, owner_key, created_at) values ($1, $2, $3)', [randomUUID(), input.owner_key, now])
        await client.query(
          `insert into optimization_idempotency (owner_key, idempotency_key, request_hash, status, job_id, created_at, updated_at)
           values ($1, $2, $3, 'accepted', $4, $5, $5)`,
          [input.owner_key, input.idempotency_key, input.request_hash, input.id, now],
        )
        return { job: fromRow(inserted.rows[0]), replayed: false }
      })
    },
    getJob: async (id) => {
      await ensureSchema()
      const result = await query<OptimizeJobRow>('select * from optimize_jobs where id = $1', [id])
      return result.rows[0] ? fromRow(result.rows[0]) : null
    },
    listJobsByProfile: async (profileId, limit = 50, before = null) => {
      await ensureSchema()
      const result = await query<OptimizeJobRow>(
        `select * from optimize_jobs
         where profile_id = $1 and ($2::timestamptz is null or created_at < $2::timestamptz)
         order by created_at desc, id desc limit $3`,
        [profileId, before, Math.max(1, Math.min(100, Math.floor(limit)))],
      )
      return result.rows.map(fromRow)
    },
    findActiveByOwnerKey: async (ownerKey) => {
      await ensureSchema()
      const result = await query<OptimizeJobRow>([
        'select * from optimize_jobs',
        'where owner_key = $1 and status = any($2)',
        'order by created_at desc',
        'limit 1',
      ].join(' '), [ownerKey, ['queued', 'running']])
      return result.rows[0] ? fromRow(result.rows[0]) : null
    },
    getQueuePosition: async (id) => {
      await ensureSchema()
      const job = await query<{ priority: number; created_at: string; status: OptimizeJobStatus }>('select priority, created_at, status from optimize_jobs where id = $1', [id])
      const row = job.rows[0]
      if (!row || row.status !== 'queued') return null
      const result = await query<{ position: string }>([
        'select (count(*) + 1)::text position from optimize_jobs',
        'where status = $3',
        'and (priority > $1 or (priority = $1 and created_at < $2))',
      ].join(' '), [row.priority, row.created_at, 'queued'])
      return Number(result.rows[0]?.position ?? 1)
    },
    claimNextJob: async (workerId, lockToken, lockExpiresAt, maxFailures, maxGlobalRunning = Number.MAX_SAFE_INTEGER) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
      const state = await client.query<{ prioritized_streak: number }>('select prioritized_streak from optimize_dispatch_state where id = true for update')
      const runningTotal = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'running'")
      if (Number(runningTotal.rows[0]?.count ?? 0) >= maxGlobalRunning) return null
      const waitingStandard = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued' and priority < 10 and failure_count < $1", [maxFailures])
      const forceStandard = Number(state.rows[0]?.prioritized_streak ?? 0) >= 3 && Number(waitingStandard.rows[0]?.count ?? 0) > 0
      const result = await client.query<OptimizeJobRow>([
        'with next_job as (',
        '  select id from optimize_jobs',
        '  where status = $6 and cancel_requested_at is null and failure_count < $4 and (next_attempt_at is null or next_attempt_at <= $5)',
        "  and not exists (select 1 from optimize_jobs running where running.owner_key = optimize_jobs.owner_key and running.status = 'running')",
        forceStandard ? '  and priority < 10' : '',
        '  order by priority desc, created_at asc',
        '  limit 1',
        '  for update skip locked',
        ')',
        'update optimize_jobs job',
        'set status = $7,',
        '    attempt_count = job.attempt_count + 1,',
        '    worker_id = $1,',
        '    lock_token = $2,',
        '    heartbeat_at = $5,',
        '    lock_expires_at = $3,',
        '    next_attempt_at = null,',
        '    expires_at = null,',
        '    started_at = coalesce(job.started_at, $5),',
        '    finished_at = null,',
        '    updated_at = $5',
        'from next_job',
        'where job.id = next_job.id',
        'returning job.*',
      ].join(' '), [workerId, lockToken, lockExpiresAt, maxFailures, now, 'queued', 'running'])
      const claimed = result.rows[0] ? fromRow(result.rows[0]) : null
      if (claimed) {
        await client.query(
          `insert into optimize_job_attempts
            (job_id, attempt_no, worker_id, lock_token, status, started_at, heartbeat_at)
           values ($1, $2, $3, $4, 'running', $5, $5)`,
          [claimed.id, claimed.attempt_count, workerId, lockToken, now],
        )
        const nextStreak = claimed.priority >= 10 ? Number(state.rows[0]?.prioritized_streak ?? 0) + 1 : 0
        await client.query('update optimize_dispatch_state set prioritized_streak = $1, updated_at = $2 where id = true', [nextStreak, now])
      }
      return claimed
      })
    },
    heartbeatAttempt: async (id, attemptNo, workerId, lockToken, lockExpiresAt) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const owned = await client.query(
          `update optimize_jobs set heartbeat_at = $6, lock_expires_at = $5, updated_at = $6
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running' and cancel_requested_at is null
           returning id`,
          [id, attemptNo, workerId, lockToken, lockExpiresAt, now],
        )
        if (!owned.rowCount) return false
        await client.query(
          `update optimize_job_attempts set heartbeat_at = $5
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4 and status = 'running'`,
          [id, attemptNo, workerId, lockToken, now],
        )
        return true
      })
    },
    ownsAttempt: async (id, attemptNo, workerId, lockToken) => {
      await ensureSchema()
      const owned = await query(
        `select id from optimize_jobs
         where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running' and cancel_requested_at is null`,
        [id, attemptNo, workerId, lockToken],
      )
      return Boolean(owned.rowCount)
    },
    completeAttempt: async (id, attemptNo, workerId, lockToken, resultJson) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const completed = await client.query([
          'update optimize_jobs',
          'set status = $7, result_json = $5, error_message = null, failure_kind = null, public_error_code = null, worker_id = null, heartbeat_at = null,',
          '    lock_token = null, lock_expires_at = null, finished_at = $6, updated_at = $6',
          'where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = $8 and cancel_requested_at is null',
          'returning id',
        ].join(' '), [id, attemptNo, workerId, lockToken, resultJson, now, 'succeeded', 'running'])
        if (!completed.rowCount) return false
        await client.query(
          `update optimize_job_attempts set status = 'succeeded', finished_at = $5, heartbeat_at = $5
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, now],
        )
        return true
      })
    },
    failAttempt: async (id, attemptNo, workerId, lockToken, errorMessage) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const failed = await client.query<{ payload_json: unknown }>(
          `update optimize_jobs
           set status = 'failed', failure_count = failure_count + 1, error_message = $5,
               failure_kind = 'application_error', public_error_code = 'application_error',
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = null,
               finished_at = $6, updated_at = $6
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running' and cancel_requested_at is null
           returning payload_json`,
          [id, attemptNo, workerId, lockToken, errorMessage, now],
        )
        if (!failed.rowCount) return false
        await client.query(
          `update optimize_job_attempts
           set status = 'failed', failure_kind = 'application_error', error_message = $5, finished_at = $6, heartbeat_at = $6
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, errorMessage, now],
        )
        await refundPriorityCouponInTransaction(client, id, now)
        await releaseQueuedEntitlementInTransaction(client, id, failed.rows[0]?.payload_json, now)
        return true
      })
    },
    retryFailedAttempt: async (id, attemptNo, workerId, lockToken, failureKind, errorMessage, maxFailures) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const updated = await client.query<OptimizeJobRow>(
          `update optimize_jobs
           set failure_count = failure_count + 1,
               status = case when failure_count + 1 >= $6 then 'dead_lettered' else 'queued' end,
               error_message = case when failure_count + 1 >= $6 then $5 else null end,
               failure_kind = case when failure_count + 1 >= $6 then $9 else null end,
               public_error_code = case when failure_count + 1 >= $6 then 'execution_retries_exhausted' else null end,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = case when failure_count + 1 >= $6 then null else $8::timestamptz end,
               finished_at = case when failure_count + 1 >= $6 then $7::timestamptz else null end,
               updated_at = $7
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running' and cancel_requested_at is null
           returning *`,
          [id, attemptNo, workerId, lockToken, errorMessage, maxFailures, now, retryAt(attemptNo), failureKind],
        )
        const updatedJob = updated.rows[0] ? fromRow(updated.rows[0]) : null
        const status = updatedJob?.status ?? null
        if (!status || !updatedJob) return null
        const attemptStatus: OptimizeJobAttemptStatus = failureKind === 'timed_out'
          ? 'timed_out'
          : failureKind === 'lease_lost' ? 'lease_lost' : 'failed'
        await client.query(
          `update optimize_job_attempts
           set status = $5, failure_kind = $6, error_message = $7, finished_at = $8, heartbeat_at = $8
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, attemptStatus, failureKind, errorMessage, now],
        )
        if (status === 'dead_lettered') {
          await refundPriorityCouponInTransaction(client, id, now)
          await releaseQueuedEntitlementInTransaction(client, id, updatedJob.payload_json, now)
          await createDeadLetterInTransaction(client, updatedJob, failureKind, errorMessage, now)
        }
        return status
      })
    },
    releaseInterruptedAttempt: async (id, attemptNo, workerId, lockToken) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const released = await client.query(
          `update optimize_jobs
           set status = 'queued', error_message = null, worker_id = null, heartbeat_at = null,
               lock_token = null, lock_expires_at = null, next_attempt_at = $5,
               expires_at = null, finished_at = null, updated_at = $5
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running'
           returning id`,
          [id, attemptNo, workerId, lockToken, now],
        )
        if (!released.rowCount) return false
        await client.query(
          `update optimize_job_attempts
           set status = 'interrupted', failure_kind = null, error_message = null, finished_at = $5, heartbeat_at = $5
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, now],
        )
        return true
      })
    },
    requestCancel: async (id) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const selected = await client.query<OptimizeJobRow>('select * from optimize_jobs where id = $1 for update', [id])
        const current = selected.rows[0] ? fromRow(selected.rows[0]) : null
        if (!current) return null
        if (current.status === 'queued') {
          const now = new Date().toISOString()
          const cancelled = await client.query<OptimizeJobRow>(
            `update optimize_jobs set status = 'cancelled', error_message = '任务已由用户取消。',
               public_error_code = 'cancelled_by_user', failure_kind = null, cancel_requested_at = $2,
               next_attempt_at = null, expires_at = null, finished_at = $2, updated_at = $2
             where id = $1 and status = 'queued' returning *`, [id, now],
          )
          await refundPriorityCouponInTransaction(client, id, now)
          await releaseQueuedEntitlementInTransaction(client, id, current.payload_json, now)
          return cancelled.rows[0] ? fromRow(cancelled.rows[0]) : current
        }
        if (current.status === 'running' && !current.cancel_requested_at) {
          const now = new Date().toISOString()
          const requested = await client.query<OptimizeJobRow>(
            `update optimize_jobs set cancel_requested_at = $2, updated_at = $2
             where id = $1 and status = 'running' returning *`, [id, now],
          )
          return requested.rows[0] ? fromRow(requested.rows[0]) : current
        }
        return current
      })
    },
    cancelAttempt: async (id, attemptNo, workerId, lockToken) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const cancelled = await client.query<{ payload_json: unknown }>(
          `update optimize_jobs set status = 'cancelled', error_message = '任务已由用户取消。',
             public_error_code = 'cancelled_by_user', failure_kind = null,
             worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
             next_attempt_at = null, expires_at = null, finished_at = $5, updated_at = $5
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4
             and status = 'running' and cancel_requested_at is not null returning payload_json`,
          [id, attemptNo, workerId, lockToken, now],
        )
        if (!cancelled.rowCount) return false
        await client.query(
          `update optimize_job_attempts set status = 'cancelled', failure_kind = null,
             error_message = '任务已由用户取消。', finished_at = $5, heartbeat_at = $5
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, now],
        )
        await refundPriorityCouponInTransaction(client, id, now)
        await releaseQueuedEntitlementInTransaction(client, id, cancelled.rows[0]?.payload_json, now)
        return true
      })
    },
    recoverExpiredAttempts: async (nowIso, maxFailures) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const recovered = await client.query<OptimizeJobRow>(
          `update optimize_jobs
           set failure_count = failure_count + 1,
               status = case when failure_count + 1 >= $2 then 'dead_lettered' else 'queued' end,
               error_message = case when failure_count + 1 >= $2 then coalesce(error_message, '任务执行租约已过期，请重试。') else null end,
               failure_kind = case when failure_count + 1 >= $2 then 'lease_lost' else null end,
               public_error_code = case when failure_count + 1 >= $2 then 'execution_retries_exhausted' else null end,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = case when failure_count + 1 >= $2 then null else $3::timestamptz end,
               finished_at = case when failure_count + 1 >= $2 then $1::timestamptz else null end,
               updated_at = $1
           where status = 'running' and lock_expires_at is not null and lock_expires_at < $1
           returning *`,
          [nowIso, maxFailures, retryAtForNow(nowIso, 1)],
        )
        for (const row of recovered.rows) {
          const job = fromRow(row)
          await client.query(
            `update optimize_job_attempts
             set status = 'lease_lost', failure_kind = 'lease_lost', error_message = '任务执行租约已过期。',
                 finished_at = $3, heartbeat_at = $3
             where job_id = $1 and attempt_no = $2 and status = 'running'`,
            [job.id, job.attempt_count, nowIso],
          )
          if (job.status === 'dead_lettered') {
            await refundPriorityCouponInTransaction(client, job.id, nowIso)
            await releaseQueuedEntitlementInTransaction(client, job.id, job.payload_json, nowIso)
            await createDeadLetterInTransaction(client, job, 'lease_lost', job.error_message || '任务执行租约已过期。', nowIso)
          }
        }
        return recovered.rowCount ?? recovered.rows.length
      })
    },
    expireQueuedJobs: async (nowIso) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const expired = await client.query<{ id: string; payload_json: unknown }>(
          `update optimize_jobs
           set status = 'failed', error_message = '任务排队超时，已释放预留权益，请重新提交。',
               failure_kind = 'queue_expired', public_error_code = 'queue_expired',
               next_attempt_at = null, expires_at = null, finished_at = $1, updated_at = $1
           where status = 'queued' and attempt_count = 0 and expires_at is not null and expires_at < $1
           returning id, payload_json`,
          [nowIso],
        )
        for (const job of expired.rows) {
          await refundPriorityCouponInTransaction(client, job.id, nowIso)
          await releaseQueuedEntitlementInTransaction(client, job.id, job.payload_json, nowIso)
        }
        return expired.rowCount ?? expired.rows.length
      })
    },
    cleanupOldJobs: async (beforeIso) => {
      await ensureSchema()
      await withTransaction(async (client) => {
        await client.query('delete from optimization_submissions where created_at < $1', [beforeIso])
        await client.query('delete from optimization_idempotency where updated_at < $1', [beforeIso])
        await client.query('delete from optimize_jobs where status = any($2) and updated_at < $1', [beforeIso, ['succeeded', 'failed', 'cancelled']])
      })
    },
  }
}

export function createMemoryOptimizeJobStore(): OptimizeJobStore & { records: Map<string, OptimizeJobRecord> } {
  const records = new Map<string, OptimizeJobRecord>()
  const attempts = new Map<string, { status: OptimizeJobAttemptStatus; heartbeat_at: string; failure_kind: OptimizeJobFailureKind | null }>()
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const activeStatuses = new Set<OptimizeJobStatus>(['queued', 'running'])
  const idempotency = new Map<string, { requestHash: string; jobId: string }>()
  const submissions = new Map<string, number[]>()
  return {
    records,
    createJob: async (input) => {
      const now = input.created_at ?? new Date().toISOString()
      const record: OptimizeJobRecord = {
        id: input.id,
        status: 'queued',
        priority: input.priority,
        owner_key: input.owner_key,
        profile_id: input.profile_id ?? null,
        permission: input.permission,
        source: input.source,
        payload_json: clone(input.payload_json),
        result_json: null,
        error_message: null,
        failure_kind: null,
        public_error_code: null,
        attempt_count: 0,
        failure_count: 0,
        worker_id: null,
        heartbeat_at: null,
        lock_token: null,
        lock_expires_at: null,
        next_attempt_at: now,
        expires_at: queueExpiresAt(now),
        cancel_requested_at: null,
        created_at: now,
        started_at: null,
        finished_at: null,
        updated_at: now,
      }
      records.set(record.id, record)
      return clone(record)
    },
    admitJob: async (input) => {
      const key = `${input.owner_key}:${input.idempotency_key}`
      const duplicate = idempotency.get(key)
      if (duplicate) {
        if (duplicate.requestHash !== input.request_hash) throw new OptimizeJobAdmissionError('idempotency_conflict', 409, 'Idempotency-Key is already used for a different request.')
        const job = records.get(duplicate.jobId)
        if (!job) throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
        return { job: clone(job), replayed: true }
      }
      const active = [...records.values()].filter((job) => job.owner_key === input.owner_key && activeStatuses.has(job.status))
      const free = input.source === 'free_preview'
      const globallyQueued = [...records.values()].filter((job) => job.status === 'queued')
      if (globallyQueued.length >= getOptimizeGlobalQueueLimit()
        || (input.source === 'scenario_comparison' && globallyQueued.filter((job) => job.source === 'scenario_comparison').length >= analysisQueueLimit())) {
        throw new OptimizeJobAdmissionError('global_queue_capacity_exceeded', 429, '优化服务全局队列已满，请稍后重试。')
      }
      assertOptimizeQueueWaitCapacity(
        [...records.values()].filter((job) => activeStatuses.has(job.status)),
        input.owner_key,
        input.created_at ?? new Date().toISOString(),
      )
      if (free && active.length) throw new OptimizeJobAdmissionError('active_job_exists', 429, '当前已有一个免费优化任务正在排队或执行。')
      if (!free && (active.filter((job) => job.status === 'running').length >= 1 || active.filter((job) => job.status === 'queued').length >= 3)) {
        throw new OptimizeJobAdmissionError('queue_capacity_exceeded', 429, '当前账号的优化队列已满，请稍后重试。')
      }
      const now = Date.now()
      const recent = (submissions.get(input.owner_key) ?? []).filter((time) => time >= now - 60 * 60_000)
      if (recent.length >= (free ? 2 : 12)) {
        throw new OptimizeJobAdmissionError('submission_rate_exceeded', 429, '当前账号的优化提交次数已达小时上限。请1小时后再试。')
      }
      recent.push(now)
      submissions.set(input.owner_key, recent)
      const job = await (async () => {
        const value = await Promise.resolve({ ...input, created_at: input.created_at ?? new Date(now).toISOString() })
        const record: OptimizeJobRecord = { id: value.id, status: 'queued', priority: value.priority, owner_key: value.owner_key, profile_id: value.profile_id ?? null, permission: value.permission, source: value.source, payload_json: clone(value.payload_json), result_json: null, error_message: null, failure_kind: null, public_error_code: null, attempt_count: 0, failure_count: 0, worker_id: null, heartbeat_at: null, lock_token: null, lock_expires_at: null, next_attempt_at: value.created_at!, expires_at: queueExpiresAt(value.created_at!), cancel_requested_at: null, created_at: value.created_at!, started_at: null, finished_at: null, updated_at: value.created_at! }
        records.set(record.id, record)
        return record
      })()
      idempotency.set(key, { requestHash: input.request_hash, jobId: job.id })
      return { job: clone(job), replayed: false }
    },
    getJob: async (id) => records.has(id) ? clone(records.get(id)!) : null,
    listJobsByProfile: async (profileId, limit = 50, before = null) => [...records.values()]
      .filter((job) => job.profile_id === profileId && (!before || Date.parse(job.created_at) < Date.parse(before)))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, Math.max(1, Math.min(100, Math.floor(limit))))
      .map(clone),
    findActiveByOwnerKey: async (ownerKey) => [...records.values()]
      .filter((job) => job.owner_key === ownerKey && activeStatuses.has(job.status))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null,
    getQueuePosition: async (id) => {
      const job = records.get(id)
      if (!job || job.status !== 'queued') return null
      return [...records.values()].filter((candidate) => candidate.status === 'queued'
        && (candidate.priority > job.priority
          || (candidate.priority === job.priority && Date.parse(candidate.created_at) < Date.parse(job.created_at)))).length + 1
    },
    claimNextJob: async (workerId, lockToken, lockExpiresAt, maxFailures, maxGlobalRunning = Number.MAX_SAFE_INTEGER) => {
      const nowMs = Date.now()
      const runningOwners = new Set([...records.values()].filter((job) => job.status === 'running').map((job) => job.owner_key))
      if (runningOwners.size >= maxGlobalRunning) return null
      const next = [...records.values()]
        .filter((job) => job.status === 'queued' && !job.cancel_requested_at && job.failure_count < maxFailures
          && !runningOwners.has(job.owner_key) && (!job.next_attempt_at || Date.parse(job.next_attempt_at) <= nowMs))
        .sort((a, b) => b.priority - a.priority || Date.parse(a.created_at) - Date.parse(b.created_at))[0]
      if (!next) return null
      const now = new Date().toISOString()
      next.status = 'running'
      next.attempt_count += 1
      next.worker_id = workerId
      next.heartbeat_at = now
      next.lock_token = lockToken
      next.lock_expires_at = lockExpiresAt
      next.next_attempt_at = null
      next.expires_at = null
      next.started_at ??= now
      next.finished_at = null
      next.updated_at = now
      attempts.set(`${next.id}:${next.attempt_count}`, { status: 'running', heartbeat_at: now, failure_kind: null })
      return clone(next)
    },
    heartbeatAttempt: async (id, attemptNo, workerId, lockToken, lockExpiresAt) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return false
      const now = new Date().toISOString()
      job.heartbeat_at = now
      job.lock_expires_at = lockExpiresAt
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) attempt.heartbeat_at = now
      return true
    },
    ownsAttempt: async (id, attemptNo, workerId, lockToken) => {
      const job = records.get(id)
      return ownsMemoryAttempt(job, attemptNo, workerId, lockToken) && !job.cancel_requested_at
    },
    completeAttempt: async (id, attemptNo, workerId, lockToken, resultJson) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return false
      const now = new Date().toISOString()
      job.status = 'succeeded'
      job.result_json = clone(resultJson)
      job.error_message = null
      job.failure_kind = null
      job.public_error_code = null
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = 'succeeded'
        attempt.heartbeat_at = now
      }
      return true
    },
    failAttempt: async (id, attemptNo, workerId, lockToken, errorMessage) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return false
      const now = new Date().toISOString()
      job.status = 'failed'
      job.failure_count += 1
      job.error_message = errorMessage
      job.failure_kind = 'application_error'
      job.public_error_code = 'application_error'
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = 'failed'
        attempt.failure_kind = 'application_error'
        attempt.heartbeat_at = now
      }
      return true
    },
    retryFailedAttempt: async (id, attemptNo, workerId, lockToken, failureKind, errorMessage, maxFailures) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return null
      const now = new Date().toISOString()
      job.failure_count += 1
      job.status = job.failure_count >= maxFailures ? 'dead_lettered' : 'queued'
      job.error_message = job.status === 'dead_lettered' ? errorMessage : null
      job.failure_kind = job.status === 'dead_lettered' ? failureKind : null
      job.public_error_code = job.status === 'dead_lettered' ? 'execution_retries_exhausted' : null
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.next_attempt_at = job.status === 'dead_lettered' ? null : retryAt(attemptNo)
      job.finished_at = job.status === 'dead_lettered' ? now : null
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = failureKind === 'timed_out' ? 'timed_out' : failureKind === 'lease_lost' ? 'lease_lost' : 'failed'
        attempt.failure_kind = failureKind
        attempt.heartbeat_at = now
      }
      return job.status
    },
    releaseInterruptedAttempt: async (id, attemptNo, workerId, lockToken) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken)) return false
      const now = new Date().toISOString()
      job.status = 'queued'
      job.error_message = null
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.next_attempt_at = now
      job.expires_at = null
      job.finished_at = null
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = 'interrupted'
        attempt.heartbeat_at = now
      }
      return true
    },
    requestCancel: async (id) => {
      const job = records.get(id)
      if (!job) return null
      const now = new Date().toISOString()
      if (job.status === 'queued') {
        job.status = 'cancelled'
        job.error_message = '任务已由用户取消。'
        job.public_error_code = 'cancelled_by_user'
        job.failure_kind = null
        job.cancel_requested_at = now
        job.next_attempt_at = null
        job.expires_at = null
        job.finished_at = now
        job.updated_at = now
      } else if (job.status === 'running' && !job.cancel_requested_at) {
        job.cancel_requested_at = now
        job.updated_at = now
      }
      return clone(job)
    },
    cancelAttempt: async (id, attemptNo, workerId, lockToken) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || !job.cancel_requested_at) return false
      const now = new Date().toISOString()
      job.status = 'cancelled'
      job.error_message = '任务已由用户取消。'
      job.failure_kind = null
      job.public_error_code = 'cancelled_by_user'
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.next_attempt_at = null
      job.finished_at = now
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = 'cancelled'
        attempt.failure_kind = null
        attempt.heartbeat_at = now
      }
      return true
    },
    recoverExpiredAttempts: async (nowIso, maxFailures) => {
      let recovered = 0
      for (const job of records.values()) {
        if (job.status !== 'running' || !job.lock_expires_at || Date.parse(job.lock_expires_at) >= Date.parse(nowIso)) continue
        recovered += 1
        const attempt = attempts.get(`${job.id}:${job.attempt_count}`)
        if (attempt) {
          attempt.status = 'lease_lost'
          attempt.failure_kind = 'lease_lost'
          attempt.heartbeat_at = nowIso
        }
        job.failure_count += 1
        job.worker_id = null
        job.heartbeat_at = null
        job.lock_token = null
          job.lock_expires_at = null
          job.next_attempt_at = job.failure_count >= maxFailures ? null : retryAtForNow(nowIso, 1)
        job.updated_at = nowIso
        if (job.failure_count >= maxFailures) {
          job.status = 'dead_lettered'
          job.error_message ||= '任务执行租约已过期，请重试。'
          job.failure_kind = 'lease_lost'
          job.public_error_code = 'execution_retries_exhausted'
          job.finished_at = nowIso
        } else {
          job.status = 'queued'
          job.error_message = null
          job.finished_at = null
        }
      }
      return recovered
    },
    expireQueuedJobs: async (nowIso) => {
      let expired = 0
      for (const job of records.values()) {
        if (job.status !== 'queued' || job.attempt_count !== 0 || !job.expires_at || Date.parse(job.expires_at) >= Date.parse(nowIso)) continue
        expired += 1
        job.status = 'failed'
        job.error_message = '任务排队超时，已释放预留权益，请重新提交。'
        job.failure_kind = 'queue_expired'
        job.public_error_code = 'queue_expired'
        job.next_attempt_at = null
        job.expires_at = null
        job.finished_at = nowIso
        job.updated_at = nowIso
      }
      return expired
    },
    cleanupOldJobs: async (beforeIso) => {
      const before = Date.parse(beforeIso)
      for (const [id, job] of records.entries()) {
        if ((job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') && Date.parse(job.updated_at) < before) records.delete(id)
      }
    },
  }
}

type OptimizeQueueCapacityJob = Pick<OptimizeJobRecord,
  'status' | 'priority' | 'owner_key' | 'payload_json' | 'created_at' | 'started_at'>

type OptimizeQueueCapacityRow = Omit<OptimizeQueueCapacityJob, 'priority' | 'created_at' | 'started_at'> & {
  priority: number | string
  created_at: string | Date
  started_at: string | Date | null
}

type OptimizeJobRow = Omit<OptimizeJobRecord, 'heartbeat_at' | 'lock_expires_at' | 'next_attempt_at' | 'expires_at' | 'cancel_requested_at' | 'created_at' | 'started_at' | 'finished_at' | 'updated_at'> & {
  heartbeat_at: string | Date | null
  lock_expires_at: string | Date | null
  next_attempt_at: string | Date | null
  expires_at: string | Date | null
  cancel_requested_at: string | Date | null
  created_at: string | Date
  started_at: string | Date | null
  finished_at: string | Date | null
  updated_at: string | Date
}

function fromRow(row: OptimizeJobRow): OptimizeJobRecord {
  return {
    ...row,
    priority: Number(row.priority),
    attempt_count: Number(row.attempt_count),
    failure_count: Number(row.failure_count),
    heartbeat_at: normalizeTimestamp(row.heartbeat_at),
    lock_expires_at: normalizeTimestamp(row.lock_expires_at),
    next_attempt_at: normalizeTimestamp(row.next_attempt_at),
    expires_at: normalizeTimestamp(row.expires_at),
    cancel_requested_at: normalizeTimestamp(row.cancel_requested_at),
    created_at: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    started_at: normalizeTimestamp(row.started_at),
    finished_at: normalizeTimestamp(row.finished_at),
    updated_at: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  }
}

function normalizeTimestamp(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function fromQueueCapacityRow(row: OptimizeQueueCapacityRow): OptimizeQueueCapacityJob {
  return {
    ...row,
    priority: Number(row.priority),
    created_at: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    started_at: normalizeTimestamp(row.started_at),
  }
}

function assertOptimizeQueueWaitCapacity(
  activeJobs: OptimizeQueueCapacityJob[],
  ownerKey: string,
  nowIso: string,
): void {
  const maximumAgeMs = queueMaxAgeMs()
  const admissionHeadroomMs = Math.min(60_000, Math.floor(maximumAgeMs / 20))
  const maximumWaitMs = maximumAgeMs - admissionHeadroomMs
  const estimatedWaitMs = estimateOptimizeQueueWaitMs(activeJobs, ownerKey, Date.parse(nowIso))
  if (estimatedWaitMs >= maximumWaitMs) {
    throw new OptimizeJobAdmissionError(
      'queue_wait_capacity_exceeded',
      429,
      '任务等待时间超过队列上限，请稍后重试。',
    )
  }
}

function estimateOptimizeQueueWaitMs(
  activeJobs: OptimizeQueueCapacityJob[],
  ownerKey: string,
  nowMs: number,
): number {
  const workerAvailableAt = Array.from({ length: getOptimizeGlobalWorkerConcurrency() }, () => 0)
  const ownerAvailableAt = new Map<string, number>()
  const runningJobs = activeJobs.filter((job) => job.status === 'running')
  // Count every existing queued job as potential work ahead. Future priority
  // submissions must not push an already admitted job past its expiry time.
  const queuedJobs = activeJobs
    .filter((job) => job.status === 'queued')
    .sort((left, right) => right.priority - left.priority || Date.parse(left.created_at) - Date.parse(right.created_at))

  for (const job of runningJobs) {
    const elapsedMs = Math.max(0, nowMs - parseQueueTimestamp(job.started_at, nowMs))
    const estimatedDurationMs = getQueueJobDurationMs(job.payload_json)
    const remainingMs = elapsedMs >= estimatedDurationMs
      ? Math.max(1_000, getOptimizeJobHardTimeoutMs() - elapsedMs)
      : Math.max(1_000, estimatedDurationMs - elapsedMs)
    scheduleQueueWork(workerAvailableAt, ownerAvailableAt, job.owner_key, remainingMs)
  }
  for (const job of queuedJobs) {
    scheduleQueueWork(workerAvailableAt, ownerAvailableAt, job.owner_key, getQueueJobDurationMs(job.payload_json))
  }

  return getEarliestQueueStart(workerAvailableAt, ownerAvailableAt.get(ownerKey) ?? 0)
}

function scheduleQueueWork(
  workerAvailableAt: number[],
  ownerAvailableAt: Map<string, number>,
  ownerKey: string,
  durationMs: number,
): void {
  const ownerReadyAt = ownerAvailableAt.get(ownerKey) ?? 0
  let selectedWorker = 0
  let selectedStart = Math.max(workerAvailableAt[0] ?? 0, ownerReadyAt)
  for (let index = 1; index < workerAvailableAt.length; index += 1) {
    const candidateStart = Math.max(workerAvailableAt[index], ownerReadyAt)
    if (candidateStart < selectedStart) {
      selectedWorker = index
      selectedStart = candidateStart
    }
  }
  const finishesAt = selectedStart + durationMs
  workerAvailableAt[selectedWorker] = finishesAt
  ownerAvailableAt.set(ownerKey, finishesAt)
}

function getEarliestQueueStart(workerAvailableAt: number[], ownerReadyAt: number): number {
  return workerAvailableAt.reduce(
    (earliest, workerReadyAt) => Math.min(earliest, Math.max(workerReadyAt, ownerReadyAt)),
    Number.POSITIVE_INFINITY,
  )
}

function getQueueJobDurationMs(payload: unknown): number {
  const rawEstimate = payload && typeof payload === 'object'
    && (payload as { estimate?: unknown }).estimate
    && typeof (payload as { estimate: unknown }).estimate === 'object'
    ? Number(((payload as { estimate: { estimated_duration_ms?: unknown } }).estimate).estimated_duration_ms)
    : Number.NaN
  return Number.isFinite(rawEstimate) && rawEstimate > 0
    ? Math.max(1_000, Math.round(rawEstimate))
    : 60_000
}

function parseQueueTimestamp(value: string | null, fallback: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function getOptimizeGlobalQueueLimit(): number {
  return positiveInteger(process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT, 200, 1)
}

function analysisQueueLimit(): number {
  return positiveInteger(process.env.OPTIMIZE_ANALYSIS_QUEUE_LIMIT, 40, 1)
}

function queueMaxAgeMs(): number {
  const maximumAgeMs = positiveInteger(process.env.OPTIMIZE_QUEUE_MAX_AGE_MS, 24 * 60 * 60_000, 60_000)
  // Upgrade the previously documented production value even if an existing
  // EnvironmentFile has not yet been synchronized during deployment.
  return maximumAgeMs === 30 * 60_000 ? 24 * 60 * 60_000 : maximumAgeMs
}

function queueExpiresAt(nowIso: string): string {
  return new Date(Date.parse(nowIso) + queueMaxAgeMs()).toISOString()
}

function retryAt(attemptNo: number): string {
  return retryAtForNow(new Date().toISOString(), attemptNo)
}

function retryAtForNow(nowIso: string, attemptNo: number): string {
  const baseMs = positiveInteger(process.env.OPTIMIZE_RETRY_BASE_MS, 2_000, 100)
  const delayMs = Math.min(60_000, baseMs * (2 ** Math.max(0, attemptNo - 1)))
  return new Date(Date.parse(nowIso) + delayMs).toISOString()
}

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}

async function createDeadLetterInTransaction(
  client: PoolClient,
  job: OptimizeJobRecord,
  failureKind: OptimizeJobFailureKind,
  errorMessage: string,
  nowIso: string,
): Promise<void> {
  await client.query(
    `insert into optimization_dead_letters
      (id, job_id, owner_key, profile_id, source, failure_kind, public_error_code,
       internal_error_message, diagnostic_json, attempt_count, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'execution_retries_exhausted', $7, $8::jsonb, $9, 'pending_review', $10, $10)
     on conflict (job_id) do update set
       failure_kind = excluded.failure_kind,
       internal_error_message = excluded.internal_error_message,
       diagnostic_json = excluded.diagnostic_json,
       attempt_count = excluded.attempt_count,
       updated_at = excluded.updated_at`,
    [
      randomUUID(),
      job.id,
      job.owner_key,
      job.profile_id,
      job.source,
      failureKind,
      errorMessage,
      JSON.stringify(buildDeadLetterDiagnostic(job)),
      job.attempt_count,
      nowIso,
    ],
  )
}

function buildDeadLetterDiagnostic(job: OptimizeJobRecord): Record<string, unknown> {
  const payload = job.payload_json && typeof job.payload_json === 'object'
    ? job.payload_json as Record<string, unknown>
    : {}
  const estimate = payload.estimate && typeof payload.estimate === 'object'
    ? payload.estimate as Record<string, unknown>
    : null
  return {
    payload_version: typeof payload.version === 'number' ? payload.version : null,
    job_kind: typeof payload.kind === 'string' ? payload.kind : 'schedule',
    profile_id: job.profile_id,
    source: job.source,
    permission: job.permission,
    estimate,
  }
}

export async function getAdminOptimizationQueueSnapshot(
  workerConcurrency: number,
  recentLimit = 20,
): Promise<AdminOptimizationQueueSnapshot> {
  await ensureSchema()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const snapshotResult = await client.query<{ snapshot_at: string | Date }>('select transaction_timestamp() as snapshot_at')
    const active = await client.query<AdminOptimizationQueueRow>(
      `${adminOptimizationQueueSelect()}
       where job.status in ('queued', 'running')
       order by
         case when job.status = 'queued' then 0 else 1 end,
         case when job.status = 'queued' then job.priority end desc,
         case when job.status = 'queued' then job.created_at end asc,
         case when job.status = 'running' then job.started_at end asc,
         job.id asc`,
    )
    const recent = await client.query<AdminOptimizationQueueRow>(
      `${adminOptimizationQueueSelect()}
       where job.status in ('succeeded', 'failed', 'cancelled', 'dead_lettered')
       order by coalesce(job.finished_at, job.updated_at) desc, job.id desc
       limit $1`,
      [Math.max(1, Math.min(100, Math.floor(recentLimit)))],
    )

    const queuedRows = active.rows.filter((row) => row.status === 'queued')
    const runningRows = active.rows.filter((row) => row.status === 'running')
    const queuedJobs = queuedRows.map((row, index) => toAdminOptimizationQueueJob(row, index + 1))
    const runningJobs = runningRows.map((row) => toAdminOptimizationQueueJob(row, null))
    const recentJobs = recent.rows.map((row) => toAdminOptimizationQueueJob(row, null))

    return {
      snapshot_at: normalizeTimestamp(snapshotResult.rows[0]?.snapshot_at ?? null) ?? new Date().toISOString(),
      capacity: {
        queue_limit: getOptimizeGlobalQueueLimit(),
        worker_concurrency: Math.max(1, Math.floor(workerConcurrency)),
      },
      counts: {
        queued: queuedJobs.length,
        running: runningJobs.length,
        retry_waiting: queuedJobs.filter((job) => job.attempt_count > 0 || job.failure_count > 0).length,
        recent_failed: recentJobs.filter((job) => job.status === 'failed' || job.status === 'dead_lettered').length,
      },
      queued_jobs: queuedJobs,
      running_jobs: runningJobs,
      recent_jobs: recentJobs,
    }
  })
}

function adminOptimizationQueueSelect(): string {
  return `select
      job.id, job.status, job.priority, job.permission, job.source,
      job.attempt_count, job.failure_count, job.worker_id, job.heartbeat_at,
      job.next_attempt_at, job.expires_at, job.cancel_requested_at,
      job.created_at, job.started_at, job.finished_at, job.updated_at,
      job.failure_kind, job.public_error_code,
      profile.id as profile_id, profile.display_name as profile_display_name,
      account.id as user_id, account.email as user_email
    from optimize_jobs job
    left join user_game_accounts profile on profile.id = job.profile_id
    left join user_accounts account on account.id = profile.user_id`
}

type AdminOptimizationQueueRow = {
  id: string
  status: OptimizeJobStatus
  priority: number | string
  permission: string | null
  source: string
  attempt_count: number | string
  failure_count: number | string
  worker_id: string | null
  heartbeat_at: string | Date | null
  next_attempt_at: string | Date | null
  expires_at: string | Date | null
  cancel_requested_at: string | Date | null
  created_at: string | Date
  started_at: string | Date | null
  finished_at: string | Date | null
  updated_at: string | Date
  failure_kind: string | null
  public_error_code: string | null
  profile_id: string | null
  profile_display_name: string | null
  user_id: string | null
  user_email: string | null
}

function toAdminOptimizationQueueJob(
  row: AdminOptimizationQueueRow,
  queuePosition: number | null,
): AdminOptimizationQueueJob {
  const priority = Number(row.priority)
  return {
    id: row.id,
    status: row.status,
    queue_position: queuePosition,
    source: row.source,
    priority: { value: priority, label: adminPriorityLabel(priority) },
    permission: row.permission,
    user: row.user_id && row.user_email ? { id: row.user_id, email: row.user_email } : null,
    profile: row.profile_id && row.profile_display_name
      ? { id: row.profile_id, display_name: row.profile_display_name }
      : null,
    attempt_count: Number(row.attempt_count),
    failure_count: Number(row.failure_count),
    worker_id: row.worker_id,
    created_at: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    started_at: normalizeTimestamp(row.started_at),
    finished_at: normalizeTimestamp(row.finished_at),
    updated_at: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
    heartbeat_at: normalizeTimestamp(row.heartbeat_at),
    next_attempt_at: normalizeTimestamp(row.next_attempt_at),
    expires_at: normalizeTimestamp(row.expires_at),
    cancel_requested_at: normalizeTimestamp(row.cancel_requested_at),
    failure_kind: row.failure_kind,
    public_error_code: row.public_error_code,
    error_summary: safeOptimizationErrorSummary(row.public_error_code, row.failure_kind),
  }
}

function adminPriorityLabel(priority: number): AdminOptimizationQueueJob['priority']['label'] {
  if (priority >= 20) return '优先券'
  if (priority >= 10) return '付费任务'
  if (priority > 0) return '分析任务'
  return '标准任务'
}

function safeOptimizationErrorSummary(publicErrorCode: string | null, failureKind: string | null): string | null {
  if (publicErrorCode === 'queue_expired') return '任务等待时间超过队列上限。'
  if (publicErrorCode === 'execution_retries_exhausted') return '任务执行重试次数已用尽。'
  if (publicErrorCode === 'cancelled_by_user') return '任务已由用户取消。'
  if (publicErrorCode === 'cancelled') return '任务已取消。'
  if (failureKind === 'timed_out') return '任务执行超时。'
  if (failureKind === 'worker_crash') return '任务 Worker 异常退出。'
  if (failureKind === 'lease_lost') return '任务执行租约已失效。'
  if (failureKind || publicErrorCode) return '任务执行失败，请结合公开错误码排查。'
  return null
}

export async function listOptimizationDeadLetters(
  limit = 50,
  status: OptimizationDeadLetterRecord['status'] | null = null,
): Promise<OptimizationDeadLetterRecord[]> {
  await ensureSchema()
  const result = await query<OptimizationDeadLetterRow>(
    `select * from optimization_dead_letters
     where ($1::text is null or status = $1)
     order by created_at desc limit $2`,
    [status, Math.max(1, Math.min(100, Math.floor(limit)))],
  )
  return result.rows.map(fromDeadLetterRow)
}

export async function getOptimizationDeadLetterDetail(id: string): Promise<OptimizationDeadLetterDetail | null> {
  await ensureSchema()
  const result = await query<OptimizationDeadLetterDetailRow>(
    `select letter.*, job.payload_json
     from optimization_dead_letters letter
     inner join optimize_jobs job on job.id = letter.job_id
     where letter.id = $1`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return null
  const { payload_json, ...letter } = row
  return { ...fromDeadLetterRow(letter), payload_json }
}

export async function replayOptimizationDeadLetter(id: string, replayedBy: string): Promise<OptimizeJobRecord | null> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const deadLetter = await client.query<OptimizationDeadLetterRow>(
      `select * from optimization_dead_letters where id = $1 for update`, [id],
    )
    const letter = deadLetter.rows[0] ? fromDeadLetterRow(deadLetter.rows[0]) : null
    if (!letter || letter.status !== 'pending_review') return null
    const originalResult = await client.query<OptimizeJobRow>('select * from optimize_jobs where id = $1 for update', [letter.job_id])
    const original = originalResult.rows[0] ? fromRow(originalResult.rows[0]) : null
    if (!original || original.status !== 'dead_lettered') return null
    if (isLegacyStandaloneSuggestionJob(original.source, original.payload_json)) return null
    const now = new Date().toISOString()
    const replayedId = randomUUID()
    const inserted = await client.query<OptimizeJobRow>(
      `insert into optimize_jobs
        (id, status, priority, owner_key, profile_id, permission, source, payload_json,
         result_json, error_message, failure_kind, public_error_code, attempt_count, failure_count,
         worker_id, heartbeat_at, lock_token, lock_expires_at, next_attempt_at, expires_at,
         cancel_requested_at, created_at, started_at, finished_at, updated_at)
       values ($1, 'queued', $2, $3, $4, $5, $6, $7::jsonb,
         null, null, null, null, 0, 0, null, null, null, null, $8, $9, null, $8, null, null, $8)
       returning *`,
      [replayedId, original.priority, original.owner_key, original.profile_id, original.permission, original.source,
        JSON.stringify(original.payload_json), now, queueExpiresAt(now)],
    )
    await client.query(
      `update optimization_dead_letters set status = 'replayed', replay_count = replay_count + 1,
         replayed_job_id = $2, replayed_by = $3, replayed_at = $4, resolved_at = $4, updated_at = $4
       where id = $1`,
      [id, replayedId, replayedBy, now],
    )
    return inserted.rows[0] ? fromRow(inserted.rows[0]) : null
  })
}

function isLegacyStandaloneSuggestionJob(source: string, payload: unknown): boolean {
  if (source === 'optimize_suggestions') return true
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const request = (payload as Record<string, unknown>).request
  return Boolean(request && typeof request === 'object' && !Array.isArray(request)
    && (request as Record<string, unknown>).suggestions_only === true)
}

export async function discardOptimizationDeadLetter(id: string): Promise<boolean> {
  await ensureSchema()
  const now = new Date().toISOString()
  const result = await query(
    `update optimization_dead_letters set status = 'discarded', resolved_at = $2, updated_at = $2
     where id = $1 and status = 'pending_review'`,
    [id, now],
  )
  return Boolean(result.rowCount)
}

type OptimizationDeadLetterRow = Omit<OptimizationDeadLetterRecord,
  'attempt_count' | 'replay_count' | 'replayed_at' | 'resolved_at' | 'created_at' | 'updated_at'> & {
  attempt_count: number | string
  replay_count: number | string
  replayed_at: string | Date | null
  resolved_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

type OptimizationDeadLetterDetailRow = OptimizationDeadLetterRow & {
  payload_json: unknown
}

function fromDeadLetterRow(row: OptimizationDeadLetterRow): OptimizationDeadLetterRecord {
  return {
    ...row,
    attempt_count: Number(row.attempt_count),
    replay_count: Number(row.replay_count),
    replayed_at: normalizeTimestamp(row.replayed_at),
    resolved_at: normalizeTimestamp(row.resolved_at),
    created_at: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
  }
}

async function releaseQueuedEntitlementInTransaction(client: PoolClient, jobId: string, payload: unknown, nowIso: string): Promise<void> {
  const released = await client.query<{ profile_id: string }>(
    `update entitlement_ledger set status = 'released', settled_at = $2
     where reference_type = 'optimization_job' and reference_id = $1 and entitlement_type = 'free_schedule' and status = 'reserved'
     returning profile_id`,
    [jobId, nowIso],
  )
  const profileId = released.rows[0]?.profile_id
  if (!profileId) return
  const mode = readFreeScheduleMode(payload)
  if (mode === 'strong_reorder_bonus') {
    await client.query('update profile_entitlements set strong_reorder_bonus_used_at = null, updated_at = $2 where profile_id = $1', [profileId, nowIso])
    return
  }
  await client.query(
    `update profile_entitlements
     set free_revision_count = greatest(0, free_revision_count - 1),
         first_generated_at = case when free_revision_count <= 1 then null else first_generated_at end,
         locked_at = case when lock_reason = 'revision_limit' then null else locked_at end,
         lock_reason = case when lock_reason = 'revision_limit' then null else lock_reason end,
         updated_at = $2
     where profile_id = $1`,
    [profileId, nowIso],
  )
}

function readFreeScheduleMode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const decision = (payload as { freeScheduleDecision?: unknown }).freeScheduleDecision
  return decision && typeof decision === 'object' && typeof (decision as { mode?: unknown }).mode === 'string'
    ? (decision as { mode: string }).mode
    : null
}

function ownsMemoryAttempt(
  job: OptimizeJobRecord | undefined,
  attemptNo: number,
  workerId: string,
  lockToken: string,
): job is OptimizeJobRecord {
  return Boolean(job
    && job.status === 'running'
    && job.attempt_count === attemptNo
    && job.worker_id === workerId
    && job.lock_token === lockToken)
}

function shanghaiMonthKey(value: Date): string {
  const shanghai = new Date(value.getTime() + 8 * 60 * 60_000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
