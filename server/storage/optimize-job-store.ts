import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  consumePriorityCouponInTransaction,
  PriorityCouponUnavailableError,
  refundPriorityCouponInTransaction,
} from './invitation-store'

export type OptimizeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type OptimizeJobPriority = 'priority_coupon' | 'paid' | 'analysis' | 'standard'
export type OptimizeJobAttemptStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'interrupted' | 'lease_lost'
export type OptimizeJobFailureKind = 'application_error' | 'worker_crash' | 'timed_out' | 'lease_lost'

export interface OptimizeJobRecord<TPayload = unknown, TResult = unknown> {
  id: string
  status: OptimizeJobStatus
  priority: number
  owner_key: string
  permission: string | null
  source: string
  payload_json: TPayload
  result_json: TResult | null
  error_message: string | null
  attempt_count: number
  failure_count: number
  worker_id: string | null
  heartbeat_at: string | null
  lock_token: string | null
  lock_expires_at: string | null
  next_attempt_at: string | null
  expires_at: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export interface CreateOptimizeJobInput<TPayload = unknown> {
  id: string
  priority: number
  owner_key: string
  profile_id?: string | null
  permission: string | null
  source: string
  payload_json: TPayload
  created_at?: string
}

export interface AdmitOptimizeJobInput<TPayload = unknown> extends CreateOptimizeJobInput<TPayload> {
  idempotency_key: string
  request_hash: string
  free_profile_id?: string | null
  reward_user_id?: string | null
  use_priority_coupon?: boolean
}

export class OptimizeJobAdmissionError extends Error {
  constructor(
    readonly code: 'idempotency_conflict' | 'idempotency_in_progress' | 'active_job_exists' | 'queue_capacity_exceeded' | 'global_queue_capacity_exceeded' | 'submission_rate_exceeded' | 'free_revision_limit_exceeded' | 'priority_coupon_unavailable',
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
  findActiveByOwnerKey: (ownerKey: string) => Promise<OptimizeJobRecord | null>
  getQueuePosition: (id: string) => Promise<number | null>
  claimNextJob: (workerId: string, lockToken: string, lockExpiresAt: string, maxFailures: number, maxGlobalRunning?: number) => Promise<OptimizeJobRecord | null>
  heartbeatAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, lockExpiresAt: string) => Promise<boolean>
  ownsAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  completeAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, result: unknown) => Promise<boolean>
  failAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, errorMessage: string) => Promise<boolean>
  retryFailedAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, failureKind: OptimizeJobFailureKind, errorMessage: string, maxFailures: number) => Promise<OptimizeJobStatus | null>
  releaseInterruptedAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  recoverExpiredAttempts: (nowIso: string, maxFailures: number) => Promise<number>
  expireQueuedJobs: (nowIso: string) => Promise<number>
  cleanupOldJobs: (beforeIso: string) => Promise<void>
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
        if (Number(globalQueued.rows[0]?.count ?? 0) >= globalQueueLimit()) {
          throw new OptimizeJobAdmissionError('global_queue_capacity_exceeded', 429, '优化服务全局队列已满，请稍后重试。')
        }
        if (input.source === 'scenario_comparison') {
          const analysisQueued = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued' and source = 'scenario_comparison'")
          if (Number(analysisQueued.rows[0]?.count ?? 0) >= analysisQueueLimit()) {
            throw new OptimizeJobAdmissionError('global_queue_capacity_exceeded', 429, '场景分析队列已满，请稍后重试。')
          }
        }
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
          throw new OptimizeJobAdmissionError('submission_rate_exceeded', 429, '当前账号的优化提交次数已达小时上限。')
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
        '  where status = $6 and failure_count < $4 and (next_attempt_at is null or next_attempt_at <= $5)',
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
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running'
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
         where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running'`,
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
          'set status = $7, result_json = $5, error_message = null, worker_id = null, heartbeat_at = null,',
          '    lock_token = null, lock_expires_at = null, finished_at = $6, updated_at = $6',
          'where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = $8',
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
        const failed = await client.query(
          `update optimize_jobs
           set status = 'failed', failure_count = failure_count + 1, error_message = $5,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = null,
               finished_at = $6, updated_at = $6
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running'
           returning id`,
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
        return true
      })
    },
    retryFailedAttempt: async (id, attemptNo, workerId, lockToken, failureKind, errorMessage, maxFailures) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const updated = await client.query<{ status: OptimizeJobStatus }>(
          `update optimize_jobs
           set failure_count = failure_count + 1,
               status = case when failure_count + 1 >= $6 then 'failed' else 'queued' end,
               error_message = case when failure_count + 1 >= $6 then $5 else null end,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = case when failure_count + 1 >= $6 then null else $8::timestamptz end,
               finished_at = case when failure_count + 1 >= $6 then $7::timestamptz else null end,
               updated_at = $7
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running'
           returning status`,
          [id, attemptNo, workerId, lockToken, errorMessage, maxFailures, now, retryAt(attemptNo)],
        )
        const status = updated.rows[0]?.status ?? null
        if (!status) return null
        const attemptStatus: OptimizeJobAttemptStatus = failureKind === 'timed_out'
          ? 'timed_out'
          : failureKind === 'lease_lost' ? 'lease_lost' : 'failed'
        await client.query(
          `update optimize_job_attempts
           set status = $5, failure_kind = $6, error_message = $7, finished_at = $8, heartbeat_at = $8
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, attemptStatus, failureKind, errorMessage, now],
        )
        if (status === 'failed') await refundPriorityCouponInTransaction(client, id, now)
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
    recoverExpiredAttempts: async (nowIso, maxFailures) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const recovered = await client.query<{ id: string; status: OptimizeJobStatus; attempt_count: number }>(
          `update optimize_jobs
           set failure_count = failure_count + 1,
               status = case when failure_count + 1 >= $2 then 'failed' else 'queued' end,
               error_message = case when failure_count + 1 >= $2 then coalesce(error_message, '任务执行租约已过期，请重试。') else null end,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = case when failure_count + 1 >= $2 then null else $3::timestamptz end,
               finished_at = case when failure_count + 1 >= $2 then $1::timestamptz else null end,
               updated_at = $1
           where status = 'running' and lock_expires_at is not null and lock_expires_at < $1
           returning id, status, attempt_count`,
          [nowIso, maxFailures, retryAtForNow(nowIso, 1)],
        )
        for (const job of recovered.rows) {
          await client.query(
            `update optimize_job_attempts
             set status = 'lease_lost', failure_kind = 'lease_lost', error_message = '任务执行租约已过期。',
                 finished_at = $3, heartbeat_at = $3
             where job_id = $1 and attempt_no = $2 and status = 'running'`,
            [job.id, job.attempt_count, nowIso],
          )
          if (job.status === 'failed') await refundPriorityCouponInTransaction(client, job.id, nowIso)
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
        await client.query('delete from optimize_jobs where status = any($2) and updated_at < $1', [beforeIso, ['succeeded', 'failed']])
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
        permission: input.permission,
        source: input.source,
        payload_json: clone(input.payload_json),
        result_json: null,
        error_message: null,
        attempt_count: 0,
        failure_count: 0,
        worker_id: null,
        heartbeat_at: null,
        lock_token: null,
        lock_expires_at: null,
        next_attempt_at: now,
        expires_at: queueExpiresAt(now),
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
      if (globallyQueued.length >= globalQueueLimit()
        || (input.source === 'scenario_comparison' && globallyQueued.filter((job) => job.source === 'scenario_comparison').length >= analysisQueueLimit())) {
        throw new OptimizeJobAdmissionError('global_queue_capacity_exceeded', 429, '优化服务全局队列已满，请稍后重试。')
      }
      if (free && active.length) throw new OptimizeJobAdmissionError('active_job_exists', 429, '当前已有一个免费优化任务正在排队或执行。')
      if (!free && (active.filter((job) => job.status === 'running').length >= 1 || active.filter((job) => job.status === 'queued').length >= 3)) {
        throw new OptimizeJobAdmissionError('queue_capacity_exceeded', 429, '当前账号的优化队列已满，请稍后重试。')
      }
      const now = Date.now()
      const recent = (submissions.get(input.owner_key) ?? []).filter((time) => time >= now - 60 * 60_000)
      if (recent.length >= (free ? 2 : 12)) throw new OptimizeJobAdmissionError('submission_rate_exceeded', 429, '当前账号的优化提交次数已达小时上限。')
      recent.push(now)
      submissions.set(input.owner_key, recent)
      const job = await (async () => {
        const value = await Promise.resolve({ ...input, created_at: input.created_at ?? new Date(now).toISOString() })
        const record: OptimizeJobRecord = { id: value.id, status: 'queued', priority: value.priority, owner_key: value.owner_key, permission: value.permission, source: value.source, payload_json: clone(value.payload_json), result_json: null, error_message: null, attempt_count: 0, failure_count: 0, worker_id: null, heartbeat_at: null, lock_token: null, lock_expires_at: null, next_attempt_at: value.created_at!, expires_at: queueExpiresAt(value.created_at!), created_at: value.created_at!, started_at: null, finished_at: null, updated_at: value.created_at! }
        records.set(record.id, record)
        return record
      })()
      idempotency.set(key, { requestHash: input.request_hash, jobId: job.id })
      return { job: clone(job), replayed: false }
    },
    getJob: async (id) => records.has(id) ? clone(records.get(id)!) : null,
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
        .filter((job) => job.status === 'queued' && job.failure_count < maxFailures
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
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken)) return false
      const now = new Date().toISOString()
      job.heartbeat_at = now
      job.lock_expires_at = lockExpiresAt
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) attempt.heartbeat_at = now
      return true
    },
    ownsAttempt: async (id, attemptNo, workerId, lockToken) => ownsMemoryAttempt(records.get(id), attemptNo, workerId, lockToken),
    completeAttempt: async (id, attemptNo, workerId, lockToken, resultJson) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken)) return false
      const now = new Date().toISOString()
      job.status = 'succeeded'
      job.result_json = clone(resultJson)
      job.error_message = null
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
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken)) return false
      const now = new Date().toISOString()
      job.status = 'failed'
      job.failure_count += 1
      job.error_message = errorMessage
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
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken)) return null
      const now = new Date().toISOString()
      job.failure_count += 1
      job.status = job.failure_count >= maxFailures ? 'failed' : 'queued'
      job.error_message = job.status === 'failed' ? errorMessage : null
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.next_attempt_at = job.status === 'failed' ? null : retryAt(attemptNo)
      job.finished_at = job.status === 'failed' ? now : null
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
          job.status = 'failed'
          job.error_message ||= '任务执行租约已过期，请重试。'
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
        if ((job.status === 'succeeded' || job.status === 'failed') && Date.parse(job.updated_at) < before) records.delete(id)
      }
    },
  }
}

type OptimizeJobRow = Omit<OptimizeJobRecord, 'heartbeat_at' | 'lock_expires_at' | 'next_attempt_at' | 'expires_at' | 'created_at' | 'started_at' | 'finished_at' | 'updated_at'> & {
  heartbeat_at: string | Date | null
  lock_expires_at: string | Date | null
  next_attempt_at: string | Date | null
  expires_at: string | Date | null
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

function globalQueueLimit(): number {
  return positiveInteger(process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT, 200, 1)
}

function analysisQueueLimit(): number {
  return positiveInteger(process.env.OPTIMIZE_ANALYSIS_QUEUE_LIMIT, 40, 1)
}

function queueExpiresAt(nowIso: string): string {
  return new Date(Date.parse(nowIso) + positiveInteger(process.env.OPTIMIZE_QUEUE_MAX_AGE_MS, 30 * 60_000, 60_000)).toISOString()
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
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
