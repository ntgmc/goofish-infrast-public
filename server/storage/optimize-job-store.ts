import { randomUUID } from 'node:crypto'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

export type OptimizeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type OptimizeJobPriority = 'paid' | 'analysis' | 'standard'

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
  lock_token: string | null
  lock_expires_at: string | null
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
}

export class OptimizeJobAdmissionError extends Error {
  constructor(
    readonly code: 'idempotency_conflict' | 'idempotency_in_progress' | 'active_job_exists' | 'queue_capacity_exceeded' | 'submission_rate_exceeded' | 'free_revision_limit_exceeded',
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
  claimNextJob: (lockToken: string, lockExpiresAt: string, maxAttempts: number) => Promise<OptimizeJobRecord | null>
  markSucceeded: (id: string, lockToken: string, result: unknown) => Promise<void>
  markFailed: (id: string, lockToken: string, errorMessage: string) => Promise<void>
  heartbeat: (id: string, lockToken: string, lockExpiresAt: string) => Promise<void>
  resetExpiredRunningJobs: (nowIso: string, maxAttempts: number) => Promise<void>
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
        '  (id, status, priority, owner_key, profile_id, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, created_at, started_at, finished_at, updated_at)',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, 0, null, null, $9, null, null, $9)',
        'returning *',
      ].join(' '), [input.id, 'queued', input.priority, input.owner_key, input.profile_id ?? null, input.permission, input.source, input.payload_json, now])
      return fromRow(result.rows[0])
    },
    admitJob: async (input) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const now = input.created_at ?? new Date().toISOString()
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [input.owner_key])
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

        const inserted = await client.query<OptimizeJobRow>([
          'insert into optimize_jobs',
          '  (id, status, priority, owner_key, profile_id, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, created_at, started_at, finished_at, updated_at)',
          'values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, 0, null, null, $9, null, null, $9)',
          'returning *',
        ].join(' '), [input.id, 'queued', input.priority, input.owner_key, input.profile_id ?? null, input.permission, input.source, input.payload_json, now])
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
    claimNextJob: async (lockToken, lockExpiresAt, maxAttempts) => {
      await ensureSchema()
      const now = new Date().toISOString()
      return withTransaction(async (client) => {
      const state = await client.query<{ prioritized_streak: number }>('select prioritized_streak from optimize_dispatch_state where id = true for update')
      const waitingStandard = await client.query<{ count: string }>("select count(*)::text as count from optimize_jobs where status = 'queued' and priority < 10 and attempt_count < $1", [maxAttempts])
      const forceStandard = Number(state.rows[0]?.prioritized_streak ?? 0) >= 3 && Number(waitingStandard.rows[0]?.count ?? 0) > 0
      const result = await client.query<OptimizeJobRow>([
        'with next_job as (',
        '  select id from optimize_jobs',
        '  where status = $5 and attempt_count < $3',
        forceStandard ? '  and priority < 10' : '',
        '  order by priority desc, created_at asc',
        '  limit 1',
        '  for update skip locked',
        ')',
        'update optimize_jobs job',
        'set status = $6,',
        '    attempt_count = job.attempt_count + 1,',
        '    lock_token = $1,',
        '    lock_expires_at = $2,',
        '    started_at = coalesce(job.started_at, $4),',
        '    updated_at = $4',
        'from next_job',
        'where job.id = next_job.id',
        'returning job.*',
      ].join(' '), [lockToken, lockExpiresAt, maxAttempts, now, 'queued', 'running'])
      const claimed = result.rows[0] ? fromRow(result.rows[0]) : null
      if (claimed) {
        const nextStreak = claimed.priority >= 10 ? Number(state.rows[0]?.prioritized_streak ?? 0) + 1 : 0
        await client.query('update optimize_dispatch_state set prioritized_streak = $1, updated_at = $2 where id = true', [nextStreak, now])
      }
      return claimed
      })
    },
    markSucceeded: async (id, lockToken, resultJson) => {
      await ensureSchema()
      const now = new Date().toISOString()
      await query([
        'update optimize_jobs',
        'set status = $5, result_json = $3, error_message = null, lock_token = null, lock_expires_at = null,',
        '    finished_at = $4, updated_at = $4',
        'where id = $1 and lock_token = $2',
      ].join(' '), [id, lockToken, resultJson, now, 'succeeded'])
    },
    markFailed: async (id, lockToken, errorMessage) => {
      await ensureSchema()
      const now = new Date().toISOString()
      await query([
        'update optimize_jobs',
        'set status = $5, error_message = $3, lock_token = null, lock_expires_at = null,',
        '    finished_at = $4, updated_at = $4',
        'where id = $1 and lock_token = $2',
      ].join(' '), [id, lockToken, errorMessage, now, 'failed'])
    },
    heartbeat: async (id, lockToken, lockExpiresAt) => {
      await ensureSchema()
      await query('update optimize_jobs set lock_expires_at = $3, updated_at = $4 where id = $1 and lock_token = $2 and status = $5', [id, lockToken, lockExpiresAt, new Date().toISOString(), 'running'])
    },
    resetExpiredRunningJobs: async (nowIso, maxAttempts) => {
      await ensureSchema()
      await query([
        'update optimize_jobs',
        'set status = case when attempt_count >= $2 then $3 else $4 end,',
        '    error_message = case when attempt_count >= $2 then coalesce(error_message, $5) else error_message end,',
        '    lock_token = null, lock_expires_at = null,',
        '    finished_at = case when attempt_count >= $2 then $1 else finished_at end,',
        '    updated_at = $1',
        'where status = $6 and lock_expires_at is not null and lock_expires_at < $1',
      ].join(' '), [nowIso, maxAttempts, 'failed', 'queued', '任务执行超时，请重试。', 'running'])
    },
    cleanupOldJobs: async (beforeIso) => {
      await ensureSchema()
      await query('delete from optimize_jobs where status = any($2) and updated_at < $1', [beforeIso, ['succeeded', 'failed']])
    },
  }
}

export function createMemoryOptimizeJobStore(): OptimizeJobStore & { records: Map<string, OptimizeJobRecord> } {
  const records = new Map<string, OptimizeJobRecord>()
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
        lock_token: null,
        lock_expires_at: null,
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
        const record: OptimizeJobRecord = { id: value.id, status: 'queued', priority: value.priority, owner_key: value.owner_key, permission: value.permission, source: value.source, payload_json: clone(value.payload_json), result_json: null, error_message: null, attempt_count: 0, lock_token: null, lock_expires_at: null, created_at: value.created_at!, started_at: null, finished_at: null, updated_at: value.created_at! }
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
    claimNextJob: async (lockToken, lockExpiresAt, maxAttempts) => {
      const next = [...records.values()]
        .filter((job) => job.status === 'queued' && job.attempt_count < maxAttempts)
        .sort((a, b) => b.priority - a.priority || Date.parse(a.created_at) - Date.parse(b.created_at))[0]
      if (!next) return null
      const now = new Date().toISOString()
      next.status = 'running'
      next.attempt_count += 1
      next.lock_token = lockToken
      next.lock_expires_at = lockExpiresAt
      next.started_at ??= now
      next.updated_at = now
      return clone(next)
    },
    markSucceeded: async (id, lockToken, resultJson) => {
      const job = records.get(id)
      if (!job || job.lock_token !== lockToken) return
      const now = new Date().toISOString()
      job.status = 'succeeded'
      job.result_json = clone(resultJson)
      job.error_message = null
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
    },
    markFailed: async (id, lockToken, errorMessage) => {
      const job = records.get(id)
      if (!job || job.lock_token !== lockToken) return
      const now = new Date().toISOString()
      job.status = 'failed'
      job.error_message = errorMessage
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
    },
    heartbeat: async (id, lockToken, lockExpiresAt) => {
      const job = records.get(id)
      if (!job || job.lock_token !== lockToken || job.status !== 'running') return
      job.lock_expires_at = lockExpiresAt
      job.updated_at = new Date().toISOString()
    },
    resetExpiredRunningJobs: async (nowIso, maxAttempts) => {
      for (const job of records.values()) {
        if (job.status !== 'running' || !job.lock_expires_at || Date.parse(job.lock_expires_at) >= Date.parse(nowIso)) continue
        job.lock_token = null
        job.lock_expires_at = null
        job.updated_at = nowIso
        if (job.attempt_count >= maxAttempts) {
          job.status = 'failed'
          job.error_message ||= '任务执行超时，请重试。'
          job.finished_at = nowIso
        } else {
          job.status = 'queued'
        }
      }
    },
    cleanupOldJobs: async (beforeIso) => {
      const before = Date.parse(beforeIso)
      for (const [id, job] of records.entries()) {
        if ((job.status === 'succeeded' || job.status === 'failed') && Date.parse(job.updated_at) < before) records.delete(id)
      }
    },
  }
}

type OptimizeJobRow = Omit<OptimizeJobRecord, 'lock_expires_at' | 'created_at' | 'started_at' | 'finished_at' | 'updated_at'> & {
  lock_expires_at: string | Date | null
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
    lock_expires_at: normalizeTimestamp(row.lock_expires_at),
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

function shanghaiMonthKey(value: Date): string {
  const shanghai = new Date(value.getTime() + 8 * 60 * 60_000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
