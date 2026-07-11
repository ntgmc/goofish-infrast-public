import { query } from './postgres'
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
  permission: string | null
  source: string
  payload_json: TPayload
  created_at?: string
}

export interface OptimizeJobStore {
  createJob: (input: CreateOptimizeJobInput) => Promise<OptimizeJobRecord>
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
        '  (id, status, priority, owner_key, permission, source, payload_json, result_json, error_message, attempt_count, lock_token, lock_expires_at, created_at, started_at, finished_at, updated_at)',
        'values ($1, $2, $3, $4, $5, $6, $7, null, null, 0, null, null, $8, null, null, $8)',
        'returning *',
      ].join(' '), [input.id, 'queued', input.priority, input.owner_key, input.permission, input.source, input.payload_json, now])
      return fromRow(result.rows[0])
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
      const result = await query<OptimizeJobRow>([
        'with next_job as (',
        '  select id from optimize_jobs',
        '  where status = $5 and attempt_count < $3',
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
      return result.rows[0] ? fromRow(result.rows[0]) : null
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

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
