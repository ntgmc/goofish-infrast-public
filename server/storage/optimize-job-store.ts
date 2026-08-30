import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { OptimizeCalculationStage, OptimizeResult, ReorderCheckResult, WorkspaceResultHistoryItem } from '../../src/lib/types'
import { formatOptimizeJobHardTimeout, getOptimizeGlobalWorkerConcurrency, getOptimizeJobHardTimeoutMs } from '../optimize-job-config'
import { query, withTransaction } from './postgres'
import { recordAdminOperationAuditInTransaction } from './admin-operation-audit-store'
import { ensureDatabaseSchema } from './schema'
import { getShanghaiMonthKey, getShanghaiNextMonthStart, REORDER_CHECK_MONTHLY_LIMIT } from '../reorder-check-policy'
import {
  commitReservedItemsInTransaction,
  ItemUnavailableError,
  refundReservedItemsInTransaction,
  reserveItemsInTransaction,
  getProfileCapacityLimitsInTransaction,
} from './inventory-store'
import type { MeteredBillingKind, MeteredBillingOperation, MeteredQuoteConfirmation, MeteredScheduleQuote } from '../../src/lib/metered-billing'
import type { OptimizationBillingSnapshot } from '../../src/lib/optimization-contracts'
import { getMeteredBillingPolicy, getMeteredScheduleQuote } from '../../src/lib/metered-billing'
import { BalanceError, releaseScheduleBalanceInTransaction, reserveScheduleBalanceInTransaction, settleScheduleBalanceInTransaction } from './balance-store'
import { emptyWorkspace, updateProfileWorkspaceInTransaction } from './user-store'
import { limitPreviewOptimizeResult } from '../optimization/jobs/entitlements'
import { normalizePersistedOptimizationJobPayload, type OptimizationJobPayload, type OptimizeJobPayload } from '../optimization/jobs/shared'
import { parseOptimizationJobResult } from '../optimization/jobs/runtime-contracts'
import { countReorderCheckQuotaInTransaction } from './reorder-quota-store'
import { confirmMeteredQuoteInTransaction, MeteredBillingQuoteError } from './metered-billing-store'
import { insertProfileOptimizationResultInTransaction } from './optimization-result-store'
import { CdkScenarioQuotaExceededError, CdkScheduleQuotaExceededError, releaseCdkScenarioQuotaInTransaction, releaseCdkScheduleQuotaInTransaction, reserveCdkScenarioQuotaInTransaction, reserveCdkScheduleQuotaInTransaction, settleCdkScenarioQuotaInTransaction } from './cdk-store'
import { productPolicies } from '../../src/lib/product-catalog'

export type OptimizeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead_lettered'
export type OptimizeJobPriority = 'priority_coupon' | 'paid' | 'analysis' | 'standard'
type OptimizeJobAttemptStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'interrupted' | 'lease_lost' | 'cancelled'
export type OptimizeJobFailureKind = 'application_error' | 'validation_error' | 'transient_error' | 'worker_crash' | 'timed_out' | 'lease_lost'

interface OptimizeJobTerminalFailure {
  code: string
  publicMessage: string
  internalMessage: string
  failureKind: Extract<OptimizeJobFailureKind, 'application_error' | 'validation_error'>
}

interface OptimizeJobCursor {
  createdAt: string
  id: string
}

interface OptimizeJobListRecord {
  job: OptimizeJobRecord
  queuePosition: number | null
  queueWaitMs?: number | null
}

export interface OptimizeJobQueueEstimate {
  queuePosition: number | null
  estimatedWaitMs: number | null
}

export interface OptimizeJobRecord<TPayload = unknown, TResult = unknown> {
  id: string
  status: OptimizeJobStatus
  priority: number
  owner_key: string
  profile_id: string | null
  billing_user_id: string | null
  billing_json: OptimizationBillingSnapshot | null
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
  execution_stage: OptimizeCalculationStage | null
  stage_updated_at: string | null
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
  legacy_request_hash?: string
  reward_user_id?: string | null
  use_priority_coupon?: boolean
  reward_item_codes?: string[]
  reorderCheckQuota?: {
    profileId: string
    windowKey: string
    limit: number
    useCoupon?: boolean
  } | null
  billing?: { userId: string; operation: MeteredBillingOperation; billingKind: MeteredBillingKind; confirmation: MeteredQuoteConfirmation } | null
}

interface PreemptFreeJobForPaidInput {
  workerId: string
  candidateJobIds: string[]
  lockToken: string
  lockExpiresAt: string
  maxFailures: number
  maxGlobalRunning: number
  claimPriority: number
  graceMs: number
}

interface OptimizeJobPreemption {
  interruptedJobId: string
  job: OptimizeJobRecord
}

export class OptimizeJobAdmissionError extends Error {
  constructor(
    readonly code: 'idempotency_conflict' | 'idempotency_in_progress' | 'active_job_exists' | 'queue_capacity_exceeded' | 'commercial_queue_capacity_exceeded' | 'global_queue_capacity_exceeded' | 'queue_wait_capacity_exceeded' | 'submission_rate_exceeded' | 'commercial_submission_rate_exceeded' | 'priority_coupon_unavailable' | 'item_unavailable' | 'item_not_applicable' | 'reorder_check_quota_exceeded' | 'insufficient_balance' | 'pricing_changed' | 'quote_already_used' | 'profile_not_found' | 'not_metered_profile' | 'profile_archived' | 'commercial_not_eligible' | 'commercial_suspended' | 'debt_outstanding' | 'subscription_quota_exceeded' | 'subscription_scenario_quota_exceeded',
    readonly status: 404 | 409 | 429,
    message: string,
  ) {
    super(message)
    this.name = 'OptimizeJobAdmissionError'
  }
}

export interface OptimizeJobStore {
  createJob: (input: CreateOptimizeJobInput) => Promise<OptimizeJobRecord>
  admitJob: (input: AdmitOptimizeJobInput) => Promise<{ job: OptimizeJobRecord; replayed: boolean }>
  findIdempotentJob: (ownerKey: string, idempotencyKey: string, requestHash: string, legacyRequestHash?: string) => Promise<OptimizeJobRecord | null>
  getJob: (id: string) => Promise<OptimizeJobRecord | null>
  listJobsByProfile: (profileId: string, limit?: number, before?: OptimizeJobCursor | null) => Promise<OptimizeJobListRecord[]>
  findActiveByOwnerKey: (ownerKey: string) => Promise<OptimizeJobRecord | null>
  getQueuePosition: (id: string) => Promise<number | null>
  getQueueEstimate?: (id: string) => Promise<OptimizeJobQueueEstimate>
  claimNextJob: (workerId: string, lockToken: string, lockExpiresAt: string, maxFailures: number, maxGlobalRunning?: number, claimPriority?: number) => Promise<OptimizeJobRecord | null>
  preemptFreeJobForPaid: (input: PreemptFreeJobForPaidInput) => Promise<OptimizeJobPreemption | null>
  heartbeatAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, lockExpiresAt: string) => Promise<boolean>
  ownsAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  updateAttemptStage: (id: string, attemptNo: number, workerId: string, lockToken: string, stage: OptimizeCalculationStage) => Promise<boolean>
  completeAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, result: unknown) => Promise<boolean>
  failAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, failure: string | OptimizeJobTerminalFailure) => Promise<boolean>
  retryFailedAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string, failureKind: OptimizeJobFailureKind, errorMessage: string, maxFailures: number) => Promise<OptimizeJobStatus | null>
  releaseInterruptedAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  requestCancel: (id: string) => Promise<OptimizeJobRecord | null>
  cancelAttempt: (id: string, attemptNo: number, workerId: string, lockToken: string) => Promise<boolean>
  recoverExpiredAttempts: (nowIso: string, maxFailures: number) => Promise<number>
  expireQueuedJobs: (nowIso: string) => Promise<number>
  cleanupOldJobs: (beforeIso: string) => Promise<void>
  reconcileBilling?: () => Promise<{
    settled: number
    released: number
    repaired: number
    quarantined: number
    anomalies: number
  }>
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
  resolution_reason: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface OptimizationDeadLetterResolution {
  actorUsername: string
  reason: string
  requestId: string
  clientIp?: string | null
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
    worker_instances: number
    billable_worker_instances: number
    source: 'runtime_registry' | 'configured_fallback'
    heartbeat_interval_ms: number
    stale_after_ms: number
  }
  counts: {
    queued: number
    ready_queued: number
    oldest_ready_wait_ms: number | null
    running: number
    retry_waiting: number
    recent_failed: number
  }
  queued_jobs: AdminOptimizationQueueJob[]
  running_jobs: AdminOptimizationQueueJob[]
  recent_jobs: AdminOptimizationQueueJob[]
}

export type OptimizeQueueLoad = {
  queued: number
  running: number
  workerInstances: number
}

declare global {
  var __maaOptimizeJobStoreForTesting: OptimizeJobStore | undefined
}

let schemaReady: Promise<void> | null = null

export function getOptimizeJobStore(): OptimizeJobStore {
  return globalThis.__maaOptimizeJobStoreForTesting ?? createPostgresOptimizeJobStore()
}

/**
 * Read only the counters required by the worker autoscaler. Keeping this
 * separate from the admin snapshot avoids loading queue rows and account
 * metadata on every autoscaling tick.
 */
export async function getOptimizeQueueLoad(): Promise<OptimizeQueueLoad> {
  await ensureSchema()
  const result = await query<{
    queued: string
    running: string
    worker_instances: string
  }>(`
    select
      (select count(*) from optimize_jobs where status = 'queued')::text as queued,
      (select count(*) from optimize_jobs where status = 'running')::text as running,
      (select count(*) from optimize_worker_registry
        where draining = false
          and heartbeat_at + stale_after_ms * interval '1 millisecond' > transaction_timestamp())::text
        as worker_instances
  `)
  const row = result.rows[0]
  return {
    queued: Math.max(0, Number(row?.queued ?? 0)),
    running: Math.max(0, Number(row?.running ?? 0)),
    workerInstances: Math.max(0, Number(row?.worker_instances ?? 0)),
  }
}

export function createPostgresOptimizeJobStore(): OptimizeJobStore {
  return {
    createJob: async (input) => {
      await ensureSchema()
      const now = input.created_at ?? new Date().toISOString()
      const result = await query<OptimizeJobRow>([
        'insert into optimize_jobs',
        '  (id, status, priority, owner_key, profile_id, billing_user_id, billing_json, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, next_attempt_at, expires_at, created_at, started_at, finished_at, updated_at)',
        'values ($1, $2, $3, $4, $5, null, null, $6, $7, $8, null, null, 0, null, null, $9, $10, $9, null, null, $9)',
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
          if (existing.request_hash !== input.request_hash && existing.request_hash !== input.legacy_request_hash) {
            throw new OptimizeJobAdmissionError('idempotency_conflict', 409, '提交内容已发生变化，请刷新页面后重新操作。')
          }
          if (!existing.job_id || existing.status !== 'accepted') {
            throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
          }
          const job = await client.query<OptimizeJobRow>('select * from optimize_jobs where id = $1', [existing.job_id])
          if (!job.rows[0]) throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
          return { job: fromRow(job.rows[0]), replayed: true }
        }

        let confirmedBillingQuote: MeteredScheduleQuote | null = null
        if (input.billing) {
          try {
            confirmedBillingQuote = await confirmMeteredQuoteInTransaction(client, {
              jobId: input.id,
              userId: input.billing.userId,
              profileId: input.profile_id!,
              operation: input.billing.operation,
              confirmation: input.billing.confirmation,
              now,
            })
          } catch (error) {
            if (error instanceof MeteredBillingQuoteError) {
              throw new OptimizeJobAdmissionError(error.code, error.status, error.message)
            }
            throw error
          }
        }

        const limits = input.source === 'free_preview'
          ? {
              running: 1,
              queued: 0,
              submissions: productPolicies.free_preview.max_submissions_per_window,
              submissionWindowHours: productPolicies.free_preview.submission_window_hours,
            }
          : { running: 1, queued: 3, submissions: 12, submissionWindowHours: 1 }
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
          `select id, status, priority, owner_key, payload_json, created_at, started_at
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
           where owner_key = $1 and created_at >= now() - make_interval(hours => $2::int)`,
          [input.owner_key, limits.submissionWindowHours],
        )
        if (Number(submitted.rows[0]?.count ?? 0) >= limits.submissions) {
          const message = input.source === 'free_preview'
            ? `免费预览每 ${limits.submissionWindowHours} 小时最多提交 ${limits.submissions} 次排班，请稍后再试。`
            : '当前账号的优化提交次数已达小时上限。请1小时后再试。'
          throw new OptimizeJobAdmissionError('submission_rate_exceeded', 429, message)
        }
        if (confirmedBillingQuote?.billing_kind === 'metered_commercial') {
          const commercialPolicy = getMeteredBillingPolicy().commercial
          const commercial = await client.query<{ running: string; queued: string; submitted: string }>(
            `select
              (select count(*) from optimize_jobs where billing_user_id = $1 and status = 'running')::text as running,
              (select count(*) from optimize_jobs where billing_user_id = $1 and status = 'queued')::text as queued,
              (select count(*) from optimization_submissions where billing_user_id = $1
                and created_at >= now() - interval '1 hour')::text as submitted`,
            [input.billing.userId],
          )
          const usage = commercial.rows[0]
          if (Number(usage?.running ?? 0) >= commercialPolicy.max_running_jobs
            || Number(usage?.queued ?? 0) >= commercialPolicy.max_queued_jobs) {
            throw new OptimizeJobAdmissionError('commercial_queue_capacity_exceeded', 429, '商用账户的优化队列已满，请稍后重试。')
          }
          if (Number(usage?.submitted ?? 0) >= commercialPolicy.max_submissions_per_hour) {
            throw new OptimizeJobAdmissionError('commercial_submission_rate_exceeded', 429, '商用账户每小时最多接纳 30 个新任务。')
          }
        }

        if (input.reorderCheckQuota) {
          const used = await countReorderCheckQuotaInTransaction(
            client,
            input.reorderCheckQuota.profileId,
            input.reorderCheckQuota.windowKey,
          )
          if (input.reorderCheckQuota.useCoupon && used < input.reorderCheckQuota.limit) {
            throw new OptimizeJobAdmissionError('item_not_applicable', 409, '本月免费变化影响预判次数尚未用完，不能使用变化预判券。')
          }
          if (!input.reorderCheckQuota.useCoupon && used >= input.reorderCheckQuota.limit) {
            throw new OptimizeJobAdmissionError('reorder_check_quota_exceeded', 429, '本月变化影响预判次数已用完。')
          }
        }

        const rewardItemCodes = [...new Set([
          ...(input.reward_item_codes ?? []),
          ...(input.use_priority_coupon ? ['priority_compute_coupon'] : []),
        ])]
        if (rewardItemCodes.length > 0) {
          if (!input.reward_user_id) throw new OptimizeJobAdmissionError('item_unavailable', 409, '没有可用的任务道具。')
          try {
            await reserveItemsInTransaction(client, input.reward_user_id, rewardItemCodes, 'optimization_job', input.id, input.profile_id ?? null, now)
          } catch (error) {
            if (error instanceof ItemUnavailableError) {
              const isPriority = error.itemCode === 'priority_compute_coupon'
              throw new OptimizeJobAdmissionError(isPriority ? 'priority_coupon_unavailable' : 'item_unavailable', 409, error.message)
            }
            throw error
          }
        }

        const payloadRecord = input.payload_json && typeof input.payload_json === 'object' && !Array.isArray(input.payload_json)
          ? input.payload_json as Record<string, unknown>
          : null
        const cdkUsageRef = payloadRecord
          && payloadRecord.cdkUsageRef && typeof payloadRecord.cdkUsageRef === 'object'
          && typeof (payloadRecord.cdkUsageRef as Record<string, unknown>).code_hash === 'string'
          ? (payloadRecord.cdkUsageRef as { code_hash: string })
          : null
        const payloadRequest = payloadRecord?.request && typeof payloadRecord.request === 'object'
          ? payloadRecord.request as Record<string, unknown>
          : null
        const isIncrementalRecompute = payloadRequest?.billing_operation === 'incremental_recompute'
        if (input.source === 'account_profile' && cdkUsageRef && !isIncrementalRecompute) {
          try {
            await reserveCdkScheduleQuotaInTransaction(client, {
              jobId: input.id,
              codeHash: cdkUsageRef.code_hash,
              now,
            })
          } catch (error) {
            if (error instanceof CdkScheduleQuotaExceededError) {
              throw new OptimizeJobAdmissionError(error.code, 409, error.message)
            }
            throw error
          }
        }
        if (input.source === 'scenario_comparison' && cdkUsageRef) {
          try {
            await reserveCdkScenarioQuotaInTransaction(client, {
              jobId: input.id,
              codeHash: cdkUsageRef.code_hash,
              now,
            })
          } catch (error) {
            if (error instanceof CdkScenarioQuotaExceededError) {
              throw new OptimizeJobAdmissionError(error.code, 409, error.message)
            }
            throw error
          }
        }

        const billingSnapshot: OptimizationBillingSnapshot | null = confirmedBillingQuote ? {
          status: 'reserved', ...confirmedBillingQuote,
        } : null
        const inserted = await client.query<OptimizeJobRow>([
          'insert into optimize_jobs',
          '  (id, status, priority, owner_key, profile_id, billing_user_id, billing_json, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, next_attempt_at, expires_at, created_at, started_at, finished_at, updated_at)',
          'values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, null, null, 0, null, null, $11, $12, $11, null, null, $11)',
          'returning *',
        ].join(' '), [input.id, 'queued', input.priority, input.owner_key, input.profile_id ?? null,
          input.billing?.userId ?? null, billingSnapshot ? JSON.stringify(billingSnapshot) : null,
          input.permission, input.source, input.payload_json, now, queueExpiresAt(now)])
        if (input.billing && confirmedBillingQuote) {
          try {
            await reserveScheduleBalanceInTransaction(client, {
              jobId: input.id, userId: input.billing.userId,
              profileId: input.profile_id!, quote: confirmedBillingQuote, now,
            })
          } catch (error) {
            if (error instanceof BalanceError && error.code === 'insufficient_balance') {
              throw new OptimizeJobAdmissionError('insufficient_balance', 409, error.message)
            }
            throw error
          }
        }
        if (input.reorderCheckQuota && !input.reorderCheckQuota.useCoupon) {
          await client.query(
            `insert into entitlement_ledger
              (id, profile_id, entitlement_type, status, reference_type, reference_id, window_key, created_at)
             values ($1, $2, 'reorder_check', 'reserved', 'optimization_job', $3, $4, $5)`,
            [randomUUID(), input.reorderCheckQuota.profileId, input.id, input.reorderCheckQuota.windowKey, now],
          )
        }
        await client.query('insert into optimization_submissions (id, owner_key, billing_user_id, created_at) values ($1, $2, $3, $4)', [randomUUID(), input.owner_key, input.billing?.userId ?? null, now])
        await client.query(
          `insert into optimization_idempotency (owner_key, idempotency_key, request_hash, status, job_id, created_at, updated_at)
           values ($1, $2, $3, 'accepted', $4, $5, $5)`,
          [input.owner_key, input.idempotency_key, input.request_hash, input.id, now],
        )
        return { job: fromRow(inserted.rows[0]), replayed: false }
      })
    },
    findIdempotentJob: async (ownerKey, idempotencyKey, requestHash, legacyRequestHash) => {
      await ensureSchema()
      const result = await query<{ request_hash: string; status: string; job_id: string | null; job: OptimizeJobRow | null }>(
        `select idem.request_hash, idem.status, idem.job_id, to_jsonb(job) as job
         from optimization_idempotency idem
         left join optimize_jobs job on job.id = idem.job_id
         where idem.owner_key = $1 and idem.idempotency_key = $2`,
        [ownerKey, idempotencyKey],
      )
      const existing = result.rows[0]
      if (!existing) return null
      if (existing.request_hash !== requestHash && existing.request_hash !== legacyRequestHash) {
        throw new OptimizeJobAdmissionError('idempotency_conflict', 409, '提交内容已发生变化，请刷新页面后重新操作。')
      }
      if (existing.status !== 'accepted' || !existing.job_id || !existing.job) {
        throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
      }
      return fromRow(existing.job)
    },
    getJob: async (id) => {
      await ensureSchema()
      const result = await query<OptimizeJobRow>('select * from optimize_jobs where id = $1', [id])
      return result.rows[0] ? fromRow(result.rows[0]) : null
    },
    listJobsByProfile: async (profileId, limit = 50, before = null) => {
      await ensureSchema()
      const result = await query<OptimizeJobRow & { queue_position: string | null }>(
        `with queued_rank as (
           select id, row_number() over (
             order by (priority <= 0) asc, priority desc, created_at asc, id asc
           ) as queue_position
           from optimize_jobs where status = 'queued'
         )
         select job.*, queued_rank.queue_position::text
         from optimize_jobs job
         left join queued_rank on queued_rank.id = job.id
         where job.profile_id = $1
           and ($2::timestamptz is null or (job.created_at, job.id) < ($2::timestamptz, $3::text))
         order by job.created_at desc, job.id desc limit $4`,
        [profileId, before?.createdAt ?? null, before?.id ?? null, Math.max(1, Math.min(101, Math.floor(limit)))],
      )
      const activeQueue = await query<OptimizeQueueCapacityRow>(
        `select id, status, priority, owner_key, payload_json, created_at, started_at
           from optimize_jobs where status in ('queued', 'running')`,
      )
      const queueEstimates = buildOptimizeQueueEstimates(activeQueue.rows.map(fromQueueCapacityRow), Date.now())
      return result.rows.map((row) => ({
        job: fromRow(row),
        queuePosition: row.queue_position === null ? null : Number(row.queue_position),
        queueWaitMs: queueEstimates.get(row.id)?.estimatedWaitMs ?? null,
      }))
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
      const job = await query<{ id: string; priority: number; created_at: string; status: OptimizeJobStatus }>('select id, priority, created_at, status from optimize_jobs where id = $1', [id])
      const row = job.rows[0]
      if (!row || row.status !== 'queued') return null
      const result = await query<{ position: string }>([
        'select (count(*) + 1)::text position from optimize_jobs',
        'where status = $3',
        'and (($5::boolean and priority > 0)',
        '  or ((priority <= 0) = $5::boolean',
        '    and (priority > $1 or (priority = $1 and (created_at < $2 or (created_at = $2 and id < $4))))))',
      ].join(' '), [row.priority, row.created_at, 'queued', row.id, row.priority <= 0])
      return Number(result.rows[0]?.position ?? 1)
    },
    getQueueEstimate: async (id) => {
      await ensureSchema()
      const result = await query<OptimizeQueueCapacityRow>(
        `select id, status, priority, owner_key, payload_json, created_at, started_at
           from optimize_jobs where status in ('queued', 'running')`,
      )
      return buildOptimizeQueueEstimates(result.rows.map(fromQueueCapacityRow), Date.now()).get(id)
        ?? { queuePosition: null, estimatedWaitMs: null }
    },
    claimNextJob: async (workerId, lockToken, lockExpiresAt, maxFailures, maxGlobalRunning = Number.MAX_SAFE_INTEGER, claimPriority = 0) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const state = await client.query<{ prioritized_streak: number }>('select prioritized_streak from optimize_dispatch_state where id = true for update')
        const higherPriorityWorker = await client.query<{ has_higher_priority: boolean }>(
          `select exists (
             select 1
             from optimize_worker_registry peer
             where peer.worker_id <> $1
               and peer.draining = false
               and peer.heartbeat_at is not null
               and peer.heartbeat_at + peer.stale_after_ms * interval '1 millisecond' > transaction_timestamp()
               and exists (
                 select 1
                 from unnest(peer.capabilities) as capability
                 where capability like 'worker-claim-priority:%'
                   and split_part(capability, ':', 2)::int > $2
               )
           ) as has_higher_priority`,
          [workerId, claimPriority],
        )
        if (higherPriorityWorker.rows[0]?.has_higher_priority) return null
      const runningTotal = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'running'")
      if (Number(runningTotal.rows[0]?.count ?? 0) >= maxGlobalRunning) return null
      const waitingStandard = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued' and priority > 0 and priority < 10 and failure_count < $1", [maxFailures])
      const forceStandard = Number(state.rows[0]?.prioritized_streak ?? 0) >= 3 && Number(waitingStandard.rows[0]?.count ?? 0) > 0
      const result = await client.query<OptimizeJobRow>([
        'with next_job as (',
        '  select id from optimize_jobs',
        '  where status = $6 and cancel_requested_at is null and failure_count < $4 and (next_attempt_at is null or next_attempt_at <= $5)',
        "  and not exists (select 1 from optimize_jobs running where running.owner_key = optimize_jobs.owner_key and running.status = 'running')",
        "  and (coalesce(billing_json->>'billing_kind', '') <> 'metered_commercial'",
        "       or (select count(*) from optimize_jobs account_running where account_running.billing_user_id = optimize_jobs.billing_user_id and account_running.status = 'running') < 2)",
        forceStandard ? '  and priority > 0 and priority < 10' : '',
        '  order by (priority <= 0) asc, priority desc, created_at asc, id asc',
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
        "    execution_stage = 'starting',",
        '    stage_updated_at = $5,',
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
    preemptFreeJobForPaid: async (input) => {
      if (input.candidateJobIds.length === 0) return null
      await ensureSchema()
      const now = new Date().toISOString()
      const paidReadyBefore = new Date(Date.parse(now) - input.graceMs).toISOString()
      return withTransaction(async (client) => {
        const state = await client.query<{ prioritized_streak: number }>('select prioritized_streak from optimize_dispatch_state where id = true for update')
        const higherPriorityWorker = await client.query<{ has_higher_priority: boolean }>(
          `select exists (
             select 1
             from optimize_worker_registry peer
             where peer.worker_id <> $1
               and peer.draining = false
               and peer.heartbeat_at is not null
               and peer.heartbeat_at + peer.stale_after_ms * interval '1 millisecond' > transaction_timestamp()
               and exists (
                 select 1
                 from unnest(peer.capabilities) as capability
                 where capability like 'worker-claim-priority:%'
                   and split_part(capability, ':', 2)::int > $2
               )
           ) as has_higher_priority`,
          [input.workerId, input.claimPriority],
        )
        if (higherPriorityWorker.rows[0]?.has_higher_priority) return null

        const capacity = (await client.query<{ running: string; registered_concurrency: string }>(
          `select
             (select count(*) from optimize_jobs where status = 'running')::text as running,
             (select coalesce(sum(concurrency), 0) from optimize_worker_registry
               where draining = false
                 and heartbeat_at + stale_after_ms * interval '1 millisecond' > transaction_timestamp())::text
               as registered_concurrency`,
        )).rows[0]
        const running = Number(capacity?.running ?? 0)
        const registeredConcurrency = Number(capacity?.registered_concurrency ?? 0)
        const effectiveCapacity = Math.min(
          input.maxGlobalRunning,
          registeredConcurrency > 0 ? registeredConcurrency : Math.max(1, running),
        )
        if (running < effectiveCapacity) return null

        const paid = await client.query<OptimizeJobRow>(
          `select candidate.* from optimize_jobs candidate
           where candidate.status = 'queued'
             and candidate.priority > 0
             and candidate.cancel_requested_at is null
             and candidate.failure_count < $1
             and greatest(candidate.created_at, coalesce(candidate.next_attempt_at, candidate.created_at)) <= $2
             and (candidate.next_attempt_at is null or candidate.next_attempt_at <= $3)
             and not exists (
               select 1 from optimize_jobs running
               where running.owner_key = candidate.owner_key and running.status = 'running'
             )
             and (coalesce(candidate.billing_json->>'billing_kind', '') <> 'metered_commercial'
               or (select count(*) from optimize_jobs account_running
                   where account_running.billing_user_id = candidate.billing_user_id
                     and account_running.status = 'running') < 2)
           order by candidate.priority desc, candidate.created_at asc, candidate.id asc
           limit 1 for update skip locked`,
          [input.maxFailures, paidReadyBefore, now],
        )
        const paidRow = paid.rows[0]
        if (!paidRow) return null

        const victim = await client.query<OptimizeJobRow>(
          `select * from optimize_jobs
           where id = any($1::text[])
             and worker_id = $2
             and status = 'running'
             and priority <= 0
             and cancel_requested_at is null
           order by started_at desc nulls last, created_at desc, id desc
           limit 1 for update skip locked`,
          [input.candidateJobIds, input.workerId],
        )
        const victimRow = victim.rows[0]
        if (!victimRow) return null

        await client.query(
          `update optimize_jobs
           set status = 'queued', error_message = null, worker_id = null, heartbeat_at = null,
               lock_token = null, lock_expires_at = null, next_attempt_at = $2,
               expires_at = null, execution_stage = null, stage_updated_at = null,
               started_at = null, finished_at = null, updated_at = $2
           where id = $1`,
          [victimRow.id, now],
        )
        await client.query(
          `update optimize_job_attempts
           set status = 'interrupted', failure_kind = null, error_message = null,
               finished_at = $2, heartbeat_at = $2
           where job_id = $1 and attempt_no = $3 and status = 'running'`,
          [victimRow.id, now, victimRow.attempt_count],
        )

        const claimed = await client.query<OptimizeJobRow>(
          `update optimize_jobs
           set status = 'running', attempt_count = attempt_count + 1,
               worker_id = $2, lock_token = $3, heartbeat_at = $4, lock_expires_at = $5,
               next_attempt_at = null, expires_at = null, execution_stage = 'starting',
               stage_updated_at = $4, started_at = coalesce(started_at, $4),
               finished_at = null, updated_at = $4
           where id = $1 and status = 'queued'
           returning *`,
          [paidRow.id, input.workerId, input.lockToken, now, input.lockExpiresAt],
        )
        const claimedRow = claimed.rows[0]
        if (!claimedRow) throw new Error('Paid optimization job could not claim the preempted slot.')
        const claimedJob = fromRow(claimedRow)
        await client.query(
          `insert into optimize_job_attempts
            (job_id, attempt_no, worker_id, lock_token, status, started_at, heartbeat_at)
           values ($1, $2, $3, $4, 'running', $5, $5)`,
          [claimedJob.id, claimedJob.attempt_count, input.workerId, input.lockToken, now],
        )
        const nextStreak = claimedJob.priority >= 10 ? Number(state.rows[0]?.prioritized_streak ?? 0) + 1 : 0
        await client.query('update optimize_dispatch_state set prioritized_streak = $1, updated_at = $2 where id = true', [nextStreak, now])
        return { interruptedJobId: victimRow.id, job: claimedJob }
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
    updateAttemptStage: async (id, attemptNo, workerId, lockToken, stage) => {
      await ensureSchema()
      const now = new Date().toISOString()
      const updated = await query(
        `update optimize_jobs set execution_stage = $5, stage_updated_at = $6, updated_at = $6
         where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4
           and status = 'running' and cancel_requested_at is null`,
        [id, attemptNo, workerId, lockToken, stage, now],
      )
      return Boolean(updated.rowCount)
    },
    completeAttempt: async (id, attemptNo, workerId, lockToken, resultJson) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
        const selected = await client.query<OptimizeJobRow>(
          `select * from optimize_jobs
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4
             and status = 'running' and cancel_requested_at is null
           for update`,
          [id, attemptNo, workerId, lockToken],
        )
        const selectedRow = selected.rows[0]
        if (!selectedRow) return false
        const selectedJob = fromRow(selectedRow)
        let formalPayload: OptimizationJobPayload | null = null
        try {
          formalPayload = normalizeFormalOptimizationJobPayload(selectedJob.payload_json)
          if (formalPayload) resultJson = parseOptimizationJobResult(formalPayload, resultJson)
        } catch (error) {
          await failInvalidCompletionInTransaction(client, selectedJob, attemptNo, workerId, lockToken, error, now)
          return false
        }

        if (formalPayload && !('kind' in formalPayload) && selectedJob.profile_id) {
          resultJson = await persistScheduleCompletionInTransaction(
            client,
            selectedJob,
            formalPayload,
            resultJson as OptimizeResult,
            now,
          )
        }

        const completed = await client.query([
          'update optimize_jobs',
          'set status = $7, result_json = $5, error_message = null, failure_kind = null, public_error_code = null, worker_id = null, heartbeat_at = null,',
          "    lock_token = null, lock_expires_at = null, execution_stage = 'completed', stage_updated_at = $6, finished_at = $6, updated_at = $6",
          'where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = $8 and cancel_requested_at is null',
        ].join(' '), [id, attemptNo, workerId, lockToken, resultJson, now, 'succeeded', 'running'])
        if (!completed.rowCount) return false
        if (selectedJob.source === 'scenario_comparison') {
          await settleCdkScenarioQuotaInTransaction(client, id, now)
        }
        await client.query(
          `update entitlement_ledger set status = 'consumed', settled_at = $2
           where reference_type = 'optimization_job' and reference_id = $1
             and entitlement_type = 'reorder_check' and status = 'reserved'`,
          [id, now],
        )
        if (formalPayload && 'kind' in formalPayload && formalPayload.kind === 'reorder_check' && selectedJob.profile_id) {
          resultJson = await persistReorderCompletionInTransaction(
            client,
            selectedJob,
            formalPayload,
            resultJson as ReorderCheckResult,
            now,
          )
          await client.query('update optimize_jobs set result_json = $2 where id = $1', [id, resultJson])
        }
        await commitReservedItemsInTransaction(client, 'optimization_job', id, now)
        const billing = await settleScheduleBalanceInTransaction(client, id, now)
        if (billing) {
          await client.query("update optimize_jobs set billing_json = jsonb_set(billing_json, '{status}', '\"settled\"'::jsonb) where id = $1", [id])
        }
        await client.query(
          `update optimize_job_attempts set status = 'succeeded', finished_at = $5, heartbeat_at = $5
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, now],
        )
        return true
      })
    },
    failAttempt: async (id, attemptNo, workerId, lockToken, failureInput) => {
      await ensureSchema()
      const now = new Date().toISOString()
      const failure = normalizeTerminalFailure(failureInput)
      return withTransaction(async (client) => {
        const failed = await client.query<{ payload_json: unknown }>(
          `update optimize_jobs
           set status = 'failed', failure_count = failure_count + 1, error_message = $5,
               failure_kind = $7, public_error_code = $8,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               next_attempt_at = null,
               finished_at = $6, updated_at = $6
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running' and cancel_requested_at is null
           returning payload_json`,
          [id, attemptNo, workerId, lockToken, failure.publicMessage, now, failure.failureKind, failure.code],
        )
        if (!failed.rowCount) return false
        await client.query(
          `update optimize_job_attempts
           set status = 'failed', failure_kind = $7, error_message = $5, finished_at = $6, heartbeat_at = $6
           where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
          [id, attemptNo, workerId, lockToken, failure.internalMessage, now, failure.failureKind],
        )
        await refundReservedItemsInTransaction(client, 'optimization_job', id, now)
        await releaseQueuedEntitlementInTransaction(client, id, failed.rows[0]?.payload_json, now)
        await releaseMeteredBillingInTransaction(client, id, now)
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
               status = case when failure_count + 1 >= $5 then 'dead_lettered' else 'queued' end,
               error_message = case when failure_count + 1 >= $5 then $9 else null end,
               failure_kind = case when failure_count + 1 >= $5 then $8 else null end,
               public_error_code = case when failure_count + 1 >= $5 then 'execution_retries_exhausted' else null end,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               execution_stage = case when failure_count + 1 >= $5 then execution_stage else null end,
               stage_updated_at = case when failure_count + 1 >= $5 then stage_updated_at else null end,
               next_attempt_at = case when failure_count + 1 >= $5 then null else $7::timestamptz end,
               finished_at = case when failure_count + 1 >= $5 then $6::timestamptz else null end,
               updated_at = $6
           where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running' and cancel_requested_at is null
           returning *`,
          [id, attemptNo, workerId, lockToken, maxFailures, now, retryAt(attemptNo), failureKind,
            '优化任务在多次自动重试后仍未完成，请稍后重新生成。'],
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
          await refundReservedItemsInTransaction(client, 'optimization_job', id, now)
          await releaseQueuedEntitlementInTransaction(client, id, updatedJob.payload_json, now)
          await createDeadLetterInTransaction(client, updatedJob, failureKind, errorMessage, now)
          await releaseMeteredBillingInTransaction(client, id, now)
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
               expires_at = null, execution_stage = null, stage_updated_at = null,
               finished_at = null, updated_at = $5
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
          await refundReservedItemsInTransaction(client, 'optimization_job', id, now)
          await releaseQueuedEntitlementInTransaction(client, id, current.payload_json, now)
          await releaseMeteredBillingInTransaction(client, id, now)
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
        await refundReservedItemsInTransaction(client, 'optimization_job', id, now)
        await releaseQueuedEntitlementInTransaction(client, id, cancelled.rows[0]?.payload_json, now)
        await releaseMeteredBillingInTransaction(client, id, now)
        return true
      })
    },
    recoverExpiredAttempts: async (nowIso, maxFailures) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const hardTimeoutMs = getOptimizeJobHardTimeoutMs()
        const timedOutMessage = `任务计算超过${formatOptimizeJobHardTimeout()}上限，请重试。`
        const recovered = await client.query<OptimizeJobRow>(
          `update optimize_jobs
           set failure_count = failure_count + 1,
               status = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then 'dead_lettered'
                 when failure_count + 1 >= $2 then 'dead_lettered'
                 else 'queued'
               end,
               error_message = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then $5
                 when failure_count + 1 >= $2 then coalesce(error_message, '任务执行租约已过期，请重试。')
                 else null
               end,
               failure_kind = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then 'timed_out'
                 when failure_count + 1 >= $2 then 'lease_lost'
                 else null
               end,
               public_error_code = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then 'execution_retries_exhausted'
                 when failure_count + 1 >= $2 then 'execution_retries_exhausted'
                 else null
               end,
               worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
               execution_stage = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then execution_stage
                 when failure_count + 1 >= $2 then execution_stage
                 else null
               end,
               stage_updated_at = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then stage_updated_at
                 when failure_count + 1 >= $2 then stage_updated_at
                 else null
               end,
               next_attempt_at = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then null
                 when failure_count + 1 >= $2 then null
                 else $3::timestamptz
               end,
               finished_at = case
                 when started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')) then $1::timestamptz
                 when failure_count + 1 >= $2 then $1::timestamptz
                 else null
               end,
               updated_at = $1
           where status = 'running' and (
             (lock_expires_at is not null and lock_expires_at < $1)
             or (started_at is not null and started_at <= ($1::timestamptz - ($4::integer * interval '1 millisecond')))
           )
           returning *`,
          [nowIso, maxFailures, retryAtForNow(nowIso, 1), hardTimeoutMs, timedOutMessage],
        )
        for (const row of recovered.rows) {
          const job = fromRow(row)
          const timedOut = isOptimizeJobExecutionTimedOut(job, Date.parse(nowIso))
          const failureKind: OptimizeJobFailureKind = timedOut ? 'timed_out' : 'lease_lost'
          const errorMessage = timedOut ? timedOutMessage : '任务执行租约已过期。'
          await client.query(
            `update optimize_job_attempts
             set status = $3, failure_kind = $3, error_message = $4,
                 finished_at = $5, heartbeat_at = $5
             where job_id = $1 and attempt_no = $2 and status = 'running'`,
            [job.id, job.attempt_count, failureKind, errorMessage, nowIso],
          )
          if (job.status === 'dead_lettered') {
            await refundReservedItemsInTransaction(client, 'optimization_job', job.id, nowIso)
            await releaseQueuedEntitlementInTransaction(client, job.id, job.payload_json, nowIso)
            await createDeadLetterInTransaction(client, job, failureKind, job.error_message || errorMessage, nowIso)
            await releaseMeteredBillingInTransaction(client, job.id, nowIso)
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
           set status = 'failed', error_message = '任务排队超时，暂扣的积分和道具已退回，请重新提交。',
               failure_kind = 'queue_expired', public_error_code = 'queue_expired',
               next_attempt_at = null, expires_at = null, finished_at = $1, updated_at = $1
           where status = 'queued' and attempt_count = 0 and expires_at is not null and expires_at < $1
           returning id, payload_json`,
          [nowIso],
        )
        for (const job of expired.rows) {
          await refundReservedItemsInTransaction(client, 'optimization_job', job.id, nowIso)
          await releaseQueuedEntitlementInTransaction(client, job.id, job.payload_json, nowIso)
          await releaseMeteredBillingInTransaction(client, job.id, nowIso)
        }
        return expired.rowCount ?? expired.rows.length
      })
    },
    cleanupOldJobs: async (beforeIso) => {
      await ensureSchema()
      await withTransaction(async (client) => {
        await client.query('delete from optimization_submissions where created_at < $1', [beforeIso])
        await client.query(
          `delete from optimization_idempotency idem where idem.updated_at < $1
             and not exists (
               select 1 from optimization_job_effects effect
               where effect.job_id = idem.job_id
                 and coalesce(effect.metadata_json->>'status', 'pending') = 'pending'
             )`,
          [beforeIso],
        )
        await client.query(
          `delete from user_balance_reservations reservation using optimize_jobs job
            where reservation.job_id = job.id and reservation.status <> 'reserved'
              and job.status = any($2) and job.updated_at < $1`,
          [beforeIso, ['succeeded', 'failed', 'cancelled']],
        )
        await client.query(
          `delete from optimize_jobs job where status = any($2) and updated_at < $1
             and not exists (select 1 from user_balance_reservations reservation
               where reservation.job_id = job.id and reservation.status = 'reserved')
             and not exists (select 1 from optimization_job_effects effect
               where effect.job_id = job.id
                 and coalesce(effect.metadata_json->>'status', 'pending') = 'pending')`,
          [beforeIso, ['succeeded', 'failed', 'cancelled']],
        )
      })
    },
    reconcileBilling: async () => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const now = new Date().toISOString()
        const pending = await client.query<{ job_id: string; status: OptimizeJobStatus }>(
          `select reservation.job_id, job.status
             from user_balance_reservations reservation
             inner join optimize_jobs job on job.id = reservation.job_id
            where reservation.status = 'reserved'
              and job.status in ('succeeded', 'failed', 'cancelled', 'dead_lettered')
            order by reservation.created_at asc limit 100 for update of reservation skip locked`,
        )
        let settled = 0
        let released = 0
        for (const row of pending.rows) {
          if (row.status === 'succeeded') {
            await settleScheduleBalanceInTransaction(client, row.job_id, now)
            await client.query("update optimize_jobs set billing_json = jsonb_set(billing_json, '{status}', '\"settled\"'::jsonb) where id = $1", [row.job_id])
            settled += 1
          } else {
            await releaseMeteredBillingInTransaction(client, row.job_id, now)
            released += 1
          }
        }
        let repaired = 0
        const orphans = await client.query<{
          id: string; job_id: string; user_id: string; amount: string; status: string;
        }>(
          `select reservation.id, reservation.job_id, reservation.user_id,
                  reservation.amount::text, reservation.status
             from user_balance_reservations reservation
             left join optimize_jobs job on job.id = reservation.job_id
            where job.id is null and reservation.status = 'reserved'
            order by reservation.created_at asc limit 100
            for update of reservation skip locked`,
        )
        for (const orphan of orphans.rows) {
          await client.query(
            `update user_balance_accounts
                set reserved = greatest(reserved - $2::numeric, 0), updated_at = $3
              where user_id = $1`,
            [orphan.user_id, orphan.amount, now],
          )
          await client.query(
            `update user_balance_reservations
                set status = 'released', settled_at = $2 where id = $1`,
            [orphan.id, now],
          )
          await upsertBillingReconciliationCase(client, {
            anomalyKey: `orphan:${orphan.id}`,
            kind: 'orphan_reservation',
            status: 'resolved',
            userId: orphan.user_id,
            jobId: orphan.job_id,
            reservationId: orphan.id,
            detail: orphan,
            resolution: { action: 'released_orphan_reservation', at: now },
            now,
          })
          repaired += 1
        }
        const projections = await client.query<{
          user_id: string; actual: string; expected: string;
        }>(
          `select account.user_id, account.reserved::text as actual,
                  coalesce(projection.expected, 0)::text as expected
             from user_balance_accounts account
             left join (
               select user_id, sum(amount) as expected from user_balance_reservations
                where status = 'reserved' group by user_id
             ) projection on projection.user_id = account.user_id
            where account.reserved <> coalesce(projection.expected, 0)
            order by account.user_id limit 100 for update of account skip locked`,
        )
        for (const projection of projections.rows) {
          await client.query(
            'update user_balance_accounts set reserved = $2::numeric, updated_at = $3 where user_id = $1',
            [projection.user_id, projection.expected, now],
          )
          await upsertBillingReconciliationCase(client, {
            anomalyKey: `projection:${projection.user_id}:${projection.actual}:${projection.expected}`,
            kind: 'account_projection_mismatch',
            status: 'resolved',
            userId: projection.user_id,
            detail: projection,
            resolution: { action: 'rebuilt_from_reserved_rows', at: now },
            now,
          })
          repaired += 1
        }
        const mismatches = await client.query<{
          id: string; job_id: string; user_id: string; reservation_status: string; job_status: string;
        }>(
          `select reservation.id, reservation.job_id, reservation.user_id,
                  reservation.status as reservation_status, job.status as job_status
             from user_balance_reservations reservation
             inner join optimize_jobs job on job.id = reservation.job_id
            where (reservation.status = 'consumed' and job.status <> 'succeeded')
               or (reservation.status = 'released' and job.status = 'succeeded')
            order by reservation.created_at asc limit 100`,
        )
        for (const mismatch of mismatches.rows) {
          await upsertBillingReconciliationCase(client, {
            anomalyKey: `reservation-job:${mismatch.id}:${mismatch.reservation_status}:${mismatch.job_status}`,
            kind: 'reservation_job_mismatch',
            status: 'pending_review',
            userId: mismatch.user_id,
            jobId: mismatch.job_id,
            reservationId: mismatch.id,
            detail: mismatch,
            now,
          })
        }
        const pendingCases = await client.query<{ count: string }>(
          "select count(*)::text as count from billing_reconciliation_cases where status = 'pending_review'",
        )
        return {
          settled,
          released,
          repaired,
          quarantined: mismatches.rows.length,
          anomalies: Number(pendingCases.rows[0]?.count ?? 0),
        }
      })
    },
  }
}

export type MemoryWorkerRegistryEntry = {
  priority: number
  draining?: boolean
  stale?: boolean
}

export function createMemoryOptimizeJobStore(
  workerRegistry: Map<string, MemoryWorkerRegistryEntry> = new Map(),
): OptimizeJobStore & { records: Map<string, OptimizeJobRecord> } {
  const records = new Map<string, OptimizeJobRecord>()
  const attempts = new Map<string, { status: OptimizeJobAttemptStatus; heartbeat_at: string; failure_kind: OptimizeJobFailureKind | null }>()
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const activeStatuses = new Set<OptimizeJobStatus>(['queued', 'running'])
  const idempotency = new Map<string, { requestHash: string; jobId: string }>()
  const submissions = new Map<string, number[]>()
  const reorderReservations = new Map<string, { profileId: string; windowKey: string; status: 'reserved' | 'consumed' | 'released' }>()
  const releaseReorderReservation = (jobId: string): void => {
    const reservation = reorderReservations.get(jobId)
    if (reservation?.status === 'reserved') reservation.status = 'released'
  }
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
        billing_user_id: null,
        billing_json: null,
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
        execution_stage: null,
        stage_updated_at: null,
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
        if (duplicate.requestHash !== input.request_hash && duplicate.requestHash !== input.legacy_request_hash) {
          throw new OptimizeJobAdmissionError('idempotency_conflict', 409, '提交内容已发生变化，请刷新页面后重新操作。')
        }
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
      let commercialSubmission: { key: string; recent: number[] } | null = null
      if (input.billing?.billingKind === 'metered_commercial') {
        const accountJobs = [...records.values()].filter((job) => job.billing_user_id === input.billing?.userId)
        const accountKey = `commercial:${input.billing.userId}`
        const accountRecent = (submissions.get(accountKey) ?? []).filter((time) => time >= now - 60 * 60_000)
        if (accountJobs.filter((job) => job.status === 'running').length >= 2
          || accountJobs.filter((job) => job.status === 'queued').length >= 8) {
          throw new OptimizeJobAdmissionError('commercial_queue_capacity_exceeded', 429, '商用账户的优化队列已满，请稍后重试。')
        }
        if (accountRecent.length >= 30) throw new OptimizeJobAdmissionError('commercial_submission_rate_exceeded', 429, '商用账户每小时最多接纳 30 个新任务。')
        commercialSubmission = { key: accountKey, recent: accountRecent }
      }
      const submissionWindowHours = free ? productPolicies.free_preview.submission_window_hours : 1
      const submissionLimit = free ? productPolicies.free_preview.max_submissions_per_window : 12
      const recent = (submissions.get(input.owner_key) ?? []).filter((time) => time >= now - submissionWindowHours * 60 * 60_000)
      if (recent.length >= submissionLimit) {
        const message = free
          ? `免费预览每 ${submissionWindowHours} 小时最多提交 ${submissionLimit} 次排班，请稍后再试。`
          : '当前账号的优化提交次数已达小时上限。请1小时后再试。'
        throw new OptimizeJobAdmissionError('submission_rate_exceeded', 429, message)
      }
      if (input.reorderCheckQuota) {
        const used = [...reorderReservations.values()].filter((reservation) =>
          reservation.profileId === input.reorderCheckQuota?.profileId
          && reservation.windowKey === input.reorderCheckQuota.windowKey
          && (reservation.status === 'reserved' || reservation.status === 'consumed')).length
        if (input.reorderCheckQuota.useCoupon && used < input.reorderCheckQuota.limit) {
          throw new OptimizeJobAdmissionError('item_not_applicable', 409, '本月免费变化影响预判次数尚未用完，不能使用变化预判券。')
        }
        if (!input.reorderCheckQuota.useCoupon && used >= input.reorderCheckQuota.limit) {
          throw new OptimizeJobAdmissionError('reorder_check_quota_exceeded', 429, '本月变化影响预判次数已用完。')
        }
      }
      recent.push(now)
      submissions.set(input.owner_key, recent)
      if (commercialSubmission) {
        commercialSubmission.recent.push(now)
        submissions.set(commercialSubmission.key, commercialSubmission.recent)
      }
      const job = await (async () => {
        const value = await Promise.resolve({ ...input, created_at: input.created_at ?? new Date(now).toISOString() })
        const memoryBillingQuote = value.billing ? {
          ...getMeteredScheduleQuote(value.billing.billingKind, '0.00', '0.00', value.billing.operation),
          pricing_version: value.billing.confirmation.pricingVersion,
          charge: value.billing.confirmation.acceptedMaxPoints,
        } : null
        const record: OptimizeJobRecord = {
          id: value.id, status: 'queued', priority: value.priority, owner_key: value.owner_key,
          profile_id: value.profile_id ?? null, billing_user_id: value.billing?.userId ?? null,
          billing_json: memoryBillingQuote ? { status: 'reserved', ...memoryBillingQuote } : null,
          permission: value.permission, source: value.source, payload_json: clone(value.payload_json),
          result_json: null, error_message: null, failure_kind: null, public_error_code: null,
          attempt_count: 0, failure_count: 0, worker_id: null, heartbeat_at: null, lock_token: null,
          lock_expires_at: null, next_attempt_at: value.created_at!, expires_at: queueExpiresAt(value.created_at!),
          cancel_requested_at: null, execution_stage: null, stage_updated_at: null, created_at: value.created_at!,
          started_at: null, finished_at: null, updated_at: value.created_at!,
        }
        records.set(record.id, record)
        return record
      })()
      if (input.reorderCheckQuota && !input.reorderCheckQuota.useCoupon) {
        reorderReservations.set(job.id, {
          profileId: input.reorderCheckQuota.profileId,
          windowKey: input.reorderCheckQuota.windowKey,
          status: 'reserved',
        })
      }
      idempotency.set(key, { requestHash: input.request_hash, jobId: job.id })
      return { job: clone(job), replayed: false }
    },
    findIdempotentJob: async (ownerKey, idempotencyKey, requestHash, legacyRequestHash) => {
      const duplicate = idempotency.get(`${ownerKey}:${idempotencyKey}`)
      if (!duplicate) return null
      if (duplicate.requestHash !== requestHash && duplicate.requestHash !== legacyRequestHash) {
        throw new OptimizeJobAdmissionError('idempotency_conflict', 409, '提交内容已发生变化，请刷新页面后重新操作。')
      }
      const job = records.get(duplicate.jobId)
      if (!job) throw new OptimizeJobAdmissionError('idempotency_in_progress', 409, '优化请求正在处理中。')
      return clone(job)
    },
    getJob: async (id) => records.has(id) ? clone(records.get(id)!) : null,
    listJobsByProfile: async (profileId, limit = 50, before = null) => {
      const queueEstimates = buildOptimizeQueueEstimates(
        [...records.values()].filter((job) => activeStatuses.has(job.status)),
        Date.now(),
      )
      return [...records.values()]
        .filter((job) => job.profile_id === profileId && (!before
          || Date.parse(job.created_at) < Date.parse(before.createdAt)
          || (job.created_at === before.createdAt && job.id < before.id)))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
        .slice(0, Math.max(1, Math.min(101, Math.floor(limit))))
        .map((job) => ({
          job: clone(job),
          queuePosition: memoryQueuePosition(records, job),
          queueWaitMs: queueEstimates.get(job.id)?.estimatedWaitMs ?? null,
        }))
    },
    findActiveByOwnerKey: async (ownerKey) => [...records.values()]
      .filter((job) => job.owner_key === ownerKey && activeStatuses.has(job.status))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null,
    getQueuePosition: async (id) => {
      const job = records.get(id)
      return job ? memoryQueuePosition(records, job) : null
    },
    getQueueEstimate: async (id) => buildOptimizeQueueEstimates(
      [...records.values()].filter((job) => activeStatuses.has(job.status)),
      Date.now(),
    ).get(id) ?? { queuePosition: null, estimatedWaitMs: null },
    claimNextJob: async (workerId, lockToken, lockExpiresAt, maxFailures, maxGlobalRunning = Number.MAX_SAFE_INTEGER, claimPriority = 0) => {
      const nowMs = Date.now()
      const hasHigherPriorityWorker = [...workerRegistry.entries()].some(
        ([candidateId, entry]) =>
          candidateId !== workerId && (entry.priority ?? 0) > claimPriority && !entry.draining && !entry.stale,
      )
      if (hasHigherPriorityWorker) return null
      const runningOwners = new Set([...records.values()].filter((job) => job.status === 'running').map((job) => job.owner_key))
      const commercialRunning = new Map<string, number>()
      for (const job of records.values()) {
        if (job.status === 'running' && job.billing_json?.billing_kind === 'metered_commercial' && job.billing_user_id) {
          commercialRunning.set(job.billing_user_id, (commercialRunning.get(job.billing_user_id) ?? 0) + 1)
        }
      }
      if (runningOwners.size >= maxGlobalRunning) return null
      const next = [...records.values()]
        .filter((job) => job.status === 'queued' && !job.cancel_requested_at && job.failure_count < maxFailures
          && !runningOwners.has(job.owner_key)
          && (job.billing_json?.billing_kind !== 'metered_commercial' || !job.billing_user_id || (commercialRunning.get(job.billing_user_id) ?? 0) < 2)
          && (!job.next_attempt_at || Date.parse(job.next_attempt_at) <= nowMs))
        .sort(compareQueuedJobs)[0]
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
      next.execution_stage = 'starting'
      next.stage_updated_at = now
      next.started_at ??= now
      next.finished_at = null
      next.updated_at = now
      attempts.set(`${next.id}:${next.attempt_count}`, { status: 'running', heartbeat_at: now, failure_kind: null })
      return clone(next)
    },
    preemptFreeJobForPaid: async (input) => {
      if (input.candidateJobIds.length === 0) return null
      const hasHigherPriorityWorker = [...workerRegistry.entries()].some(
        ([candidateId, entry]) =>
          candidateId !== input.workerId && (entry.priority ?? 0) > input.claimPriority && !entry.draining && !entry.stale,
      )
      if (hasHigherPriorityWorker) return null
      const nowMs = Date.now()
      const running = [...records.values()].filter((job) => job.status === 'running')
      if (running.length < input.maxGlobalRunning) return null
      const runningOwners = new Set(running.map((job) => job.owner_key))
      const commercialRunning = new Map<string, number>()
      for (const job of running) {
        if (job.billing_json?.billing_kind === 'metered_commercial' && job.billing_user_id) {
          commercialRunning.set(job.billing_user_id, (commercialRunning.get(job.billing_user_id) ?? 0) + 1)
        }
      }
      const paid = [...records.values()]
        .filter((job) => job.status === 'queued' && job.priority > 0 && !job.cancel_requested_at
          && job.failure_count < input.maxFailures
          && Math.max(Date.parse(job.created_at), Date.parse(job.next_attempt_at ?? job.created_at)) <= nowMs - input.graceMs
          && !runningOwners.has(job.owner_key)
          && (job.billing_json?.billing_kind !== 'metered_commercial' || !job.billing_user_id || (commercialRunning.get(job.billing_user_id) ?? 0) < 2)
          && (!job.next_attempt_at || Date.parse(job.next_attempt_at) <= nowMs))
        .sort(compareQueuedJobs)[0]
      if (!paid) return null
      const candidateIds = new Set(input.candidateJobIds)
      const victim = running
        .filter((job) => candidateIds.has(job.id) && job.worker_id === input.workerId
          && job.priority <= 0 && !job.cancel_requested_at)
        .sort((left, right) => Date.parse(right.started_at ?? right.created_at) - Date.parse(left.started_at ?? left.created_at)
          || Date.parse(right.created_at) - Date.parse(left.created_at)
          || right.id.localeCompare(left.id))[0]
      if (!victim) return null

      const now = new Date(nowMs).toISOString()
      victim.status = 'queued'
      victim.error_message = null
      victim.worker_id = null
      victim.heartbeat_at = null
      victim.lock_token = null
      victim.lock_expires_at = null
      victim.next_attempt_at = now
      victim.expires_at = null
      victim.execution_stage = null
      victim.stage_updated_at = null
      victim.started_at = null
      victim.finished_at = null
      victim.updated_at = now
      const victimAttempt = attempts.get(`${victim.id}:${victim.attempt_count}`)
      if (victimAttempt) {
        victimAttempt.status = 'interrupted'
        victimAttempt.heartbeat_at = now
      }

      paid.status = 'running'
      paid.attempt_count += 1
      paid.worker_id = input.workerId
      paid.heartbeat_at = now
      paid.lock_token = input.lockToken
      paid.lock_expires_at = input.lockExpiresAt
      paid.next_attempt_at = null
      paid.expires_at = null
      paid.execution_stage = 'starting'
      paid.stage_updated_at = now
      paid.started_at ??= now
      paid.finished_at = null
      paid.updated_at = now
      attempts.set(`${paid.id}:${paid.attempt_count}`, { status: 'running', heartbeat_at: now, failure_kind: null })
      return { interruptedJobId: victim.id, job: clone(paid) }
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
    updateAttemptStage: async (id, attemptNo, workerId, lockToken, stage) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return false
      const now = new Date().toISOString()
      job.execution_stage = stage
      job.stage_updated_at = now
      job.updated_at = now
      return true
    },
    completeAttempt: async (id, attemptNo, workerId, lockToken, resultJson) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return false
      const now = new Date().toISOString()
      let formalPayload: OptimizationJobPayload | null = null
      try {
        formalPayload = normalizeFormalOptimizationJobPayload(job.payload_json)
        if (formalPayload) resultJson = parseOptimizationJobResult(formalPayload, resultJson)
      } catch {
        job.status = 'failed'
        job.failure_count += 1
        job.error_message = '优化器返回了无效结果，请联系支持并提供任务编号。'
        job.failure_kind = 'validation_error'
        job.public_error_code = 'invalid_optimizer_result'
        job.worker_id = null
        job.heartbeat_at = null
        job.lock_token = null
        job.lock_expires_at = null
        job.finished_at = now
        job.updated_at = now
        if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
        releaseReorderReservation(id)
        return false
      }
      job.status = 'succeeded'
      if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'settled' }
      const reservation = reorderReservations.get(id)
      if (reservation?.status === 'reserved') reservation.status = 'consumed'
      if (formalPayload && 'kind' in formalPayload && formalPayload.kind === 'reorder_check') {
        const month = getShanghaiMonthKey(new Date(now))
        const used = [...reorderReservations.values()].filter((candidate) => (
          candidate.profileId === formalPayload!.activeProfileId
          && candidate.windowKey === month
          && (candidate.status === 'reserved' || candidate.status === 'consumed')
        )).length
        resultJson = {
          ...resultJson as ReorderCheckResult,
          quota: buildSettledReorderQuota(used, now),
        }
      }
      job.result_json = clone(resultJson)
      job.error_message = null
      job.failure_kind = null
      job.public_error_code = null
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.execution_stage = 'completed'
      job.stage_updated_at = now
      job.finished_at = now
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = 'succeeded'
        attempt.heartbeat_at = now
      }
      releaseReorderReservation(id)
      return true
    },
    failAttempt: async (id, attemptNo, workerId, lockToken, failureInput) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return false
      const now = new Date().toISOString()
      const failure = normalizeTerminalFailure(failureInput)
      job.status = 'failed'
      if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
      job.failure_count += 1
      job.error_message = failure.publicMessage
      job.failure_kind = failure.failureKind
      job.public_error_code = failure.code
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = 'failed'
        attempt.failure_kind = failure.failureKind
        attempt.heartbeat_at = now
      }
      releaseReorderReservation(id)
      return true
    },
    retryFailedAttempt: async (id, attemptNo, workerId, lockToken, failureKind, _errorMessage, maxFailures) => {
      const job = records.get(id)
      if (!ownsMemoryAttempt(job, attemptNo, workerId, lockToken) || job.cancel_requested_at) return null
      const now = new Date().toISOString()
      job.failure_count += 1
      job.status = job.failure_count >= maxFailures ? 'dead_lettered' : 'queued'
      job.error_message = job.status === 'dead_lettered'
        ? '优化任务在多次自动重试后仍未完成，请稍后重新生成。'
        : null
      job.failure_kind = job.status === 'dead_lettered' ? failureKind : null
      job.public_error_code = job.status === 'dead_lettered' ? 'execution_retries_exhausted' : null
      job.worker_id = null
      job.heartbeat_at = null
      job.lock_token = null
      job.lock_expires_at = null
      job.next_attempt_at = job.status === 'dead_lettered' ? null : retryAt(attemptNo)
      if (job.status === 'queued') {
        job.execution_stage = null
        job.stage_updated_at = null
      }
      job.finished_at = job.status === 'dead_lettered' ? now : null
      job.updated_at = now
      const attempt = attempts.get(`${id}:${attemptNo}`)
      if (attempt) {
        attempt.status = failureKind === 'timed_out' ? 'timed_out' : failureKind === 'lease_lost' ? 'lease_lost' : 'failed'
        attempt.failure_kind = failureKind
        attempt.heartbeat_at = now
      }
      if (job.status === 'dead_lettered') {
        releaseReorderReservation(id)
        if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
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
      job.execution_stage = null
      job.stage_updated_at = null
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
        if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
        releaseReorderReservation(id)
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
      if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
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
      releaseReorderReservation(id)
      return true
    },
    recoverExpiredAttempts: async (nowIso, maxFailures) => {
      let recovered = 0
      const nowMs = Date.parse(nowIso)
      const timedOutMessage = `任务计算超过${formatOptimizeJobHardTimeout()}上限，请重试。`
      for (const job of records.values()) {
        const leaseExpired = Boolean(job.lock_expires_at) && Date.parse(job.lock_expires_at!) < nowMs
        const timedOut = isOptimizeJobExecutionTimedOut(job, nowMs)
        if (job.status !== 'running' || (!leaseExpired && !timedOut)) continue
        recovered += 1
        const failureKind: OptimizeJobFailureKind = timedOut ? 'timed_out' : 'lease_lost'
        const errorMessage = timedOut ? timedOutMessage : '任务执行租约已过期，请重试。'
        const attempt = attempts.get(`${job.id}:${job.attempt_count}`)
        if (attempt) {
          attempt.status = timedOut ? 'timed_out' : 'lease_lost'
          attempt.failure_kind = failureKind
          attempt.heartbeat_at = nowIso
        }
        job.failure_count += 1
        job.worker_id = null
        job.heartbeat_at = null
        job.lock_token = null
        job.lock_expires_at = null
        job.next_attempt_at = timedOut || job.failure_count >= maxFailures ? null : retryAtForNow(nowIso, 1)
        job.updated_at = nowIso
        if (timedOut || job.failure_count >= maxFailures) {
          job.status = 'dead_lettered'
          job.error_message = timedOut ? timedOutMessage : job.error_message || errorMessage
          job.failure_kind = failureKind
          job.public_error_code = 'execution_retries_exhausted'
          job.finished_at = nowIso
          if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
          releaseReorderReservation(job.id)
        } else {
          job.status = 'queued'
          job.error_message = null
          job.execution_stage = null
          job.stage_updated_at = null
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
        job.error_message = '任务排队超时，暂扣的积分和道具已退回，请重新提交。'
        job.failure_kind = 'queue_expired'
        job.public_error_code = 'queue_expired'
        job.next_attempt_at = null
        job.expires_at = null
        job.finished_at = nowIso
        job.updated_at = nowIso
        if (job.billing_json) job.billing_json = { ...job.billing_json, status: 'released' }
        releaseReorderReservation(job.id)
      }
      return expired
    },
    cleanupOldJobs: async (beforeIso) => {
      const before = Date.parse(beforeIso)
      for (const [id, job] of records.entries()) {
        if ((job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') && Date.parse(job.updated_at) < before) records.delete(id)
      }
    },
    reconcileBilling: async () => ({ settled: 0, released: 0, repaired: 0, quarantined: 0, anomalies: 0 }),
  }
}

async function upsertBillingReconciliationCase(
  client: PoolClient,
  input: {
    anomalyKey: string
    kind: 'orphan_reservation' | 'reservation_job_mismatch' | 'account_projection_mismatch'
    status: 'pending_review' | 'resolved'
    userId?: string | null
    jobId?: string | null
    reservationId?: string | null
    detail: unknown
    resolution?: unknown
    now: string
  },
): Promise<void> {
  await client.query(
    `insert into billing_reconciliation_cases
      (id, anomaly_key, kind, status, user_id, job_id, reservation_id, detail_json,
       resolution_json, first_seen_at, last_seen_at, resolved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $10,
             case when $4 = 'resolved' then $10::timestamptz else null end)
     on conflict (anomaly_key) do update
       set status = excluded.status,
           detail_json = excluded.detail_json,
           resolution_json = coalesce(excluded.resolution_json, billing_reconciliation_cases.resolution_json),
           last_seen_at = excluded.last_seen_at,
           resolved_at = case when excluded.status = 'resolved'
             then excluded.last_seen_at else billing_reconciliation_cases.resolved_at end`,
    [randomUUID(), input.anomalyKey, input.kind, input.status, input.userId ?? null,
      input.jobId ?? null, input.reservationId ?? null, JSON.stringify(input.detail),
      input.resolution === undefined ? null : JSON.stringify(input.resolution), input.now],
  )
}

type OptimizeQueueCapacityJob = Pick<OptimizeJobRecord,
  'id' | 'status' | 'priority' | 'owner_key' | 'payload_json' | 'created_at' | 'started_at'>

type OptimizeQueueCapacityRow = Omit<OptimizeQueueCapacityJob, 'priority' | 'created_at' | 'started_at'> & {
  priority: number | string
  created_at: string | Date
  started_at: string | Date | null
}

type OptimizeJobRow = Omit<OptimizeJobRecord, 'heartbeat_at' | 'lock_expires_at' | 'next_attempt_at' | 'expires_at' | 'cancel_requested_at' | 'stage_updated_at' | 'created_at' | 'started_at' | 'finished_at' | 'updated_at'> & {
  heartbeat_at: string | Date | null
  lock_expires_at: string | Date | null
  next_attempt_at: string | Date | null
  expires_at: string | Date | null
  cancel_requested_at: string | Date | null
  stage_updated_at: string | Date | null
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
    stage_updated_at: normalizeTimestamp(row.stage_updated_at),
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
  const schedule = createOptimizeQueueSchedule(activeJobs, nowMs)
  for (const job of schedule.queuedJobs) {
    scheduleQueueWork(schedule.workerAvailableAt, schedule.ownerAvailableAt, job.owner_key, getQueueJobDurationMs(job.payload_json))
  }
  return getEarliestQueueStart(schedule.workerAvailableAt, schedule.ownerAvailableAt.get(ownerKey) ?? 0)
}

function buildOptimizeQueueEstimates(
  activeJobs: OptimizeQueueCapacityJob[],
  nowMs: number,
): Map<string, OptimizeJobQueueEstimate> {
  const schedule = createOptimizeQueueSchedule(activeJobs, nowMs)
  const estimates = new Map<string, OptimizeJobQueueEstimate>()
  for (const [index, job] of schedule.queuedJobs.entries()) {
    const estimatedWaitMs = scheduleQueueWork(
      schedule.workerAvailableAt,
      schedule.ownerAvailableAt,
      job.owner_key,
      getQueueJobDurationMs(job.payload_json),
    )
    estimates.set(job.id, {
      queuePosition: index + 1,
      estimatedWaitMs,
    })
  }
  return estimates
}

function createOptimizeQueueSchedule(
  activeJobs: OptimizeQueueCapacityJob[],
  nowMs: number,
): {
  workerAvailableAt: number[]
  ownerAvailableAt: Map<string, number>
  queuedJobs: OptimizeQueueCapacityJob[]
} {
  const workerAvailableAt = Array.from({ length: getOptimizeGlobalWorkerConcurrency() }, () => 0)
  const ownerAvailableAt = new Map<string, number>()
  const runningJobs = activeJobs.filter((job) => job.status === 'running')
  // Count every existing queued job as potential work ahead. Future priority
  // submissions must not push an already admitted job past its expiry time.
  const queuedJobs = activeJobs
    .filter((job) => job.status === 'queued')
    .sort(compareQueuedJobs)

  for (const job of runningJobs) {
    const elapsedMs = Math.max(0, nowMs - parseQueueTimestamp(job.started_at, nowMs))
    const estimatedDurationMs = getQueueJobDurationMs(job.payload_json)
    const remainingMs = elapsedMs >= estimatedDurationMs
      ? Math.max(1_000, getOptimizeJobHardTimeoutMs() - elapsedMs)
      : Math.max(1_000, estimatedDurationMs - elapsedMs)
    scheduleQueueWork(workerAvailableAt, ownerAvailableAt, job.owner_key, remainingMs)
  }
  return { workerAvailableAt, ownerAvailableAt, queuedJobs }
}

function scheduleQueueWork(
  workerAvailableAt: number[],
  ownerAvailableAt: Map<string, number>,
  ownerKey: string,
  durationMs: number,
): number {
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
  return selectedStart
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

function isOptimizeJobExecutionTimedOut(job: Pick<OptimizeJobRecord, 'started_at'>, nowMs: number): boolean {
  const startedAtMs = Date.parse(job.started_at ?? '')
  return Number.isFinite(startedAtMs) && nowMs - startedAtMs >= getOptimizeJobHardTimeoutMs()
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
  configuredFallbackConcurrency?: number,
  recentLimit = 20,
): Promise<AdminOptimizationQueueSnapshot> {
  await ensureSchema()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const snapshotResult = await client.query<{ snapshot_at: string | Date }>('select transaction_timestamp() as snapshot_at')
    const workerCapacity = (await client.query<{
      worker_concurrency: string
      worker_instances: string
      billable_worker_instances: string
      heartbeat_interval_ms: string | null
      stale_after_ms: string | null
    }>(
      `select coalesce(sum(concurrency), 0)::text as worker_concurrency,
              count(*)::text as worker_instances,
              count(*) filter (
                where not capabilities @> array['runtime:local_fallback']::text[]
              )::text as billable_worker_instances,
              max(heartbeat_interval_ms)::text as heartbeat_interval_ms,
              max(stale_after_ms)::text as stale_after_ms
         from optimize_worker_registry
        where draining = false
          and heartbeat_at + stale_after_ms * interval '1 millisecond' > transaction_timestamp()`,
    )).rows[0]
    const active = await client.query<AdminOptimizationQueueRow>(
      `${adminOptimizationQueueSelect()}
       where job.status in ('queued', 'running')
       order by
         case when job.status = 'queued' then 0 else 1 end,
         case when job.status = 'queued' then (job.priority <= 0)::int end asc,
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
    const snapshotAt = normalizeTimestamp(snapshotResult.rows[0]?.snapshot_at ?? null) ?? new Date().toISOString()
    const readyQueue = summarizeReadyOptimizationQueue(queuedJobs, snapshotAt)
    const registeredConcurrency = Number(workerCapacity?.worker_concurrency ?? 0)
    const workerInstances = Number(workerCapacity?.worker_instances ?? 0)
    const billableWorkerInstances = Number(workerCapacity?.billable_worker_instances ?? workerInstances)
    const useFallback = workerInstances === 0 && configuredFallbackConcurrency !== undefined

    return {
      snapshot_at: snapshotAt,
      capacity: {
        queue_limit: getOptimizeGlobalQueueLimit(),
        worker_concurrency: useFallback
          ? Math.max(1, Math.floor(configuredFallbackConcurrency))
          : Math.max(0, registeredConcurrency),
        worker_instances: Math.max(0, workerInstances),
        billable_worker_instances: Math.max(0, billableWorkerInstances),
        source: useFallback ? 'configured_fallback' : 'runtime_registry',
        heartbeat_interval_ms: Number(workerCapacity?.heartbeat_interval_ms ?? 10_000),
        stale_after_ms: Number(workerCapacity?.stale_after_ms ?? 30_000),
      },
      counts: {
        queued: queuedJobs.length,
        ready_queued: readyQueue.count,
        oldest_ready_wait_ms: readyQueue.oldestWaitMs,
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

function summarizeReadyOptimizationQueue(
  queuedJobs: AdminOptimizationQueueJob[],
  snapshotAt: string,
): { count: number; oldestWaitMs: number | null } {
  const snapshotMs = Date.parse(snapshotAt)
  if (!Number.isFinite(snapshotMs)) return { count: 0, oldestWaitMs: null }

  let count = 0
  let oldestReadySinceMs = Number.POSITIVE_INFINITY
  for (const job of queuedJobs) {
    const createdMs = Date.parse(job.created_at)
    const nextAttemptMs = job.next_attempt_at ? Date.parse(job.next_attempt_at) : Number.NaN
    if (Number.isFinite(nextAttemptMs) && nextAttemptMs > snapshotMs) continue

    count += 1
    const readySinceMs = Number.isFinite(nextAttemptMs)
      ? Math.max(Number.isFinite(createdMs) ? createdMs : nextAttemptMs, nextAttemptMs)
      : Number.isFinite(createdMs) ? createdMs : snapshotMs
    oldestReadySinceMs = Math.min(oldestReadySinceMs, readySinceMs)
  }

  return {
    count,
    oldestWaitMs: count > 0 ? Math.max(0, snapshotMs - oldestReadySinceMs) : null,
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

export async function replayOptimizationDeadLetter(
  id: string,
  resolution: OptimizationDeadLetterResolution,
): Promise<OptimizeJobRecord | null> {
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
    if (original.billing_json) return null
    if (isLegacyStandaloneSuggestionJob(original.source, original.payload_json)) return null
    const now = new Date().toISOString()
    const replayedId = randomUUID()
    if (isReorderCheckPayload(original.payload_json)) {
      if (!original.profile_id) return null
      const month = getShanghaiMonthKey(new Date(now))
      const quota = await client.query<{ count: string }>(
        `select count(*)::text as count from entitlement_ledger
         where profile_id = $1 and entitlement_type = 'reorder_check' and window_key = $2
           and status in ('reserved', 'consumed')`,
        [original.profile_id, month],
      )
      if (Number(quota.rows[0]?.count ?? 0) >= REORDER_CHECK_MONTHLY_LIMIT) {
        throw new OptimizeJobAdmissionError('reorder_check_quota_exceeded', 429, '本月变化影响预判次数已用完。')
      }
    }
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
    if (isReorderCheckPayload(original.payload_json) && original.profile_id) {
      await client.query(
        `insert into entitlement_ledger
          (id, profile_id, entitlement_type, status, reference_type, reference_id, window_key, created_at)
         values ($1, $2, 'reorder_check', 'reserved', 'optimization_job', $3, $4, $5)`,
        [randomUUID(), original.profile_id, replayedId, getShanghaiMonthKey(new Date(now)), now],
      )
    }
    await client.query(
      `update optimization_dead_letters set status = 'replayed', replay_count = replay_count + 1,
         replayed_job_id = $2, replayed_by = $3, replayed_at = $4,
         resolution_reason = $5, resolved_by = $3, resolved_at = $4, updated_at = $4
       where id = $1`,
      [id, replayedId, resolution.actorUsername, now, resolution.reason],
    )
    await recordAdminOperationAuditInTransaction(client, {
      actorUsername: resolution.actorUsername,
      action: 'optimization_dead_letter.replay',
      targetType: 'optimization_dead_letter',
      targetId: id,
      reason: resolution.reason,
      requestId: resolution.requestId,
      clientIp: resolution.clientIp,
      before: { status: letter.status, replay_count: letter.replay_count, job_id: letter.job_id },
      after: { status: 'replayed', replay_count: letter.replay_count + 1, replayed_job_id: replayedId },
      createdAt: now,
    })
    return inserted.rows[0] ? fromRow(inserted.rows[0]) : null
  })
}

export function isOptimizeJobAdmissionError(error: unknown): error is OptimizeJobAdmissionError {
  if (error instanceof OptimizeJobAdmissionError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as Partial<OptimizeJobAdmissionError>
  return candidate.name === 'OptimizeJobAdmissionError'
    && typeof candidate.code === 'string'
    && (candidate.status === 409 || candidate.status === 429)
    && typeof candidate.message === 'string'
}

function isLegacyStandaloneSuggestionJob(source: string, payload: unknown): boolean {
  if (source === 'optimize_suggestions') return true
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const request = (payload as Record<string, unknown>).request
  return Boolean(request && typeof request === 'object' && !Array.isArray(request)
    && (request as Record<string, unknown>).suggestions_only === true)
}

export async function discardOptimizationDeadLetter(
  id: string,
  resolution: OptimizationDeadLetterResolution,
): Promise<boolean> {
  await ensureSchema()
  const now = new Date().toISOString()
  return withTransaction(async (client) => {
    const selected = await client.query<OptimizationDeadLetterRow>(
      'select * from optimization_dead_letters where id = $1 for update',
      [id],
    )
    const letter = selected.rows[0] ? fromDeadLetterRow(selected.rows[0]) : null
    if (!letter || letter.status !== 'pending_review') return false
    const result = await client.query(
      `update optimization_dead_letters
          set status = 'discarded', resolution_reason = $2, resolved_by = $3,
              resolved_at = $4, updated_at = $4
        where id = $1 and status = 'pending_review'`,
      [id, resolution.reason, resolution.actorUsername, now],
    )
    if (result.rowCount !== 1) return false
    await recordAdminOperationAuditInTransaction(client, {
      actorUsername: resolution.actorUsername,
      action: 'optimization_dead_letter.discard',
      targetType: 'optimization_dead_letter',
      targetId: id,
      reason: resolution.reason,
      requestId: resolution.requestId,
      clientIp: resolution.clientIp,
      before: { status: letter.status, replay_count: letter.replay_count, job_id: letter.job_id },
      after: { status: 'discarded', replay_count: letter.replay_count },
      createdAt: now,
    })
    return true
  })
}

export async function discardAllOptimizationDeadLetters(
  resolution: OptimizationDeadLetterResolution,
): Promise<number> {
  await ensureSchema()
  const now = new Date().toISOString()
  return withTransaction(async (client) => {
    const selected = await client.query<{ id: string }>(
      `select id from optimization_dead_letters
        where status = 'pending_review'
        order by created_at asc
        for update`,
    )
    if (selected.rows.length === 0) return 0
    const ids = selected.rows.map((row) => row.id)
    const result = await client.query(
      `update optimization_dead_letters
          set status = 'discarded', resolution_reason = $1, resolved_by = $2,
              resolved_at = $3, updated_at = $3
        where id = any($4::text[]) and status = 'pending_review'`,
      [resolution.reason, resolution.actorUsername, now, ids],
    )
    const discardedCount = result.rowCount ?? 0
    await recordAdminOperationAuditInTransaction(client, {
      actorUsername: resolution.actorUsername,
      action: 'optimization_dead_letter.discard_all',
      targetType: 'optimization_dead_letter_batch',
      targetId: resolution.requestId,
      reason: resolution.reason,
      requestId: resolution.requestId,
      clientIp: resolution.clientIp,
      before: { pending_review_count: selected.rows.length },
      after: { discarded_count: discardedCount },
      createdAt: now,
    })
    return discardedCount
  })
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
  await client.query(
    `update entitlement_ledger set status = 'released', settled_at = $2
     where reference_type = 'optimization_job' and reference_id = $1
       and entitlement_type = 'reorder_check' and status = 'reserved'`,
    [jobId, nowIso],
  )
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

async function releaseMeteredBillingInTransaction(client: PoolClient, jobId: string, nowIso: string): Promise<void> {
  await releaseCdkScheduleQuotaInTransaction(client, jobId, nowIso)
  await releaseCdkScenarioQuotaInTransaction(client, jobId, nowIso)
  if (await releaseScheduleBalanceInTransaction(client, jobId, nowIso)) {
    await client.query(
      "update optimize_jobs set billing_json = jsonb_set(billing_json, '{status}', '\"released\"'::jsonb) where id = $1",
      [jobId],
    )
  }
}

function normalizeFormalOptimizationJobPayload(value: unknown): OptimizationJobPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 3 || typeof record.submittedAt !== 'number') return null
  return normalizePersistedOptimizationJobPayload(value)
}

async function persistScheduleCompletionInTransaction(
  client: PoolClient,
  job: OptimizeJobRecord,
  payload: OptimizeJobPayload,
  result: OptimizeResult,
  nowIso: string,
): Promise<OptimizeResult> {
  const profileId = job.profile_id!
  const persistedResult = payload.isPreviewProfile && !payload.isPreviewTrial
    ? limitPreviewOptimizeResult(result)
    : result
  const workspaceEffect = await client.query(
    `insert into optimization_job_effects (job_id, effect_type, metadata_json, applied_at)
     values ($1, 'workspace_schedule_result', $2::jsonb, $3)
     on conflict (job_id, effect_type) do nothing
     returning job_id`,
    [job.id, JSON.stringify({ profile_id: profileId, result_id: job.id }), nowIso],
  )
  if (workspaceEffect.rowCount) {
    const limits = await getProfileCapacityLimitsInTransaction(client, profileId)
    const historyItem: WorkspaceResultHistoryItem = {
      id: job.id,
      job_id: job.id,
      name: `排班结果 ${formatShanghaiHistoryTime(nowIso)}`,
      created_at: nowIso,
      config: payload.effectiveConfig,
      result: persistedResult,
      operator_count: payload.operators.filter((operator) => operator.own !== false).length,
      source: payload.request.history_source ?? 'generated',
    }
    await insertProfileOptimizationResultInTransaction(
      client,
      profileId,
      historyItem,
      limits.history,
    )
    await updateProfileWorkspaceInTransaction(client, profileId, (current) => {
      const workspace = current ?? emptyWorkspace(profileId)
      return {
        ...workspace,
        operators: workspace.operators ?? payload.operators,
        config: workspace.config ?? payload.effectiveConfig,
        updated_at: nowIso,
      }
    })
  }
  await client.query(
    `insert into optimization_job_effects (job_id, effect_type, metadata_json, applied_at)
     values ($1, 'schedule_completion', $2::jsonb, $3)
     on conflict (job_id, effect_type) do nothing`,
    [job.id, JSON.stringify({ status: 'pending', attempts: 0 }), nowIso],
  )
  return persistedResult
}

async function persistReorderCompletionInTransaction(
  client: PoolClient,
  job: OptimizeJobRecord,
  payload: Extract<OptimizationJobPayload, { kind: 'reorder_check' }>,
  result: ReorderCheckResult,
  nowIso: string,
): Promise<ReorderCheckResult> {
  const used = await countReorderCheckQuotaInTransaction(
    client,
    payload.activeProfileId,
    getShanghaiMonthKey(new Date(nowIso)),
  )
  const persistedResult: ReorderCheckResult = {
    ...result,
    quota: buildSettledReorderQuota(used, nowIso),
  }
  await client.query(
    `insert into optimization_job_effects (job_id, effect_type, metadata_json, applied_at)
     values ($1, 'reorder_check_completion', $2::jsonb, $3)
     on conflict (job_id, effect_type) do nothing`,
    [job.id, JSON.stringify({ status: 'pending', attempts: 0 }), nowIso],
  )
  return persistedResult
}

function buildSettledReorderQuota(used: number, nowIso: string): ReorderCheckResult['quota'] {
  const normalizedUsed = Math.max(0, Math.floor(used))
  return {
    limit: REORDER_CHECK_MONTHLY_LIMIT,
    used: normalizedUsed,
    remaining: Math.max(0, REORDER_CHECK_MONTHLY_LIMIT - normalizedUsed),
    reset_at: getShanghaiNextMonthStart(new Date(nowIso)),
    timezone: 'Asia/Shanghai',
  }
}

async function failInvalidCompletionInTransaction(
  client: PoolClient,
  job: OptimizeJobRecord,
  attemptNo: number,
  workerId: string,
  lockToken: string,
  error: unknown,
  nowIso: string,
): Promise<void> {
  const internalMessage = truncateInternalError(error instanceof Error ? error.message : String(error))
  await client.query(
    `update optimize_jobs
     set status = 'failed', failure_count = failure_count + 1,
         error_message = '优化器返回了无效结果，请联系支持并提供任务编号。',
         failure_kind = 'validation_error', public_error_code = 'invalid_optimizer_result',
         worker_id = null, heartbeat_at = null, lock_token = null, lock_expires_at = null,
         next_attempt_at = null, finished_at = $5, updated_at = $5
     where id = $1 and attempt_count = $2 and worker_id = $3 and lock_token = $4 and status = 'running'`,
    [job.id, attemptNo, workerId, lockToken, nowIso],
  )
  await client.query(
    `update optimize_job_attempts
     set status = 'failed', failure_kind = 'validation_error', error_message = $5,
         finished_at = $6, heartbeat_at = $6
     where job_id = $1 and attempt_no = $2 and worker_id = $3 and lock_token = $4`,
    [job.id, attemptNo, workerId, lockToken, internalMessage, nowIso],
  )
  await refundReservedItemsInTransaction(client, 'optimization_job', job.id, nowIso)
  await releaseQueuedEntitlementInTransaction(client, job.id, job.payload_json, nowIso)
  await releaseMeteredBillingInTransaction(client, job.id, nowIso)
}

function normalizeTerminalFailure(input: string | OptimizeJobTerminalFailure): OptimizeJobTerminalFailure {
  if (typeof input === 'string') {
    return {
      code: 'application_error',
      publicMessage: '优化任务失败，请检查输入后重试。',
      internalMessage: truncateInternalError(input),
      failureKind: 'application_error',
    }
  }
  return {
    code: /^[a-z][a-z0-9_]{0,63}$/.test(input.code) ? input.code : 'application_error',
    publicMessage: input.publicMessage.slice(0, 300),
    internalMessage: truncateInternalError(input.internalMessage),
    failureKind: input.failureKind === 'validation_error' ? 'validation_error' : 'application_error',
  }
}

function truncateInternalError(value: string): string {
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim()
  return normalized.length <= 4_000 ? normalized : `${normalized.slice(0, 3_999)}…`
}

function formatShanghaiHistoryTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp + 8 * 60 * 60_000).toISOString().slice(0, 16).replace('T', ' ')
}

function memoryQueuePosition(records: Map<string, OptimizeJobRecord>, job: OptimizeJobRecord): number | null {
  if (job.status !== 'queued') return null
  return [...records.values()].filter((candidate) => candidate.status === 'queued'
    && compareQueuedJobs(candidate, job) < 0).length + 1
}

function compareQueuedJobs(
  left: Pick<OptimizeJobRecord, 'priority' | 'created_at' | 'id'>,
  right: Pick<OptimizeJobRecord, 'priority' | 'created_at' | 'id'>,
): number {
  const serviceClass = Number(left.priority <= 0) - Number(right.priority <= 0)
  return serviceClass
    || right.priority - left.priority
    || Date.parse(left.created_at) - Date.parse(right.created_at)
    || left.id.localeCompare(right.id)
}

function isReorderCheckPayload(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'reorder_check')
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


function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
