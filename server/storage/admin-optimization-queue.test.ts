import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clientQuery } = vi.hoisted(() => ({ clientQuery: vi.fn() }))

vi.mock('./schema', () => ({ ensureDatabaseSchema: vi.fn(async () => undefined) }))
vi.mock('./postgres', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => work({ query: clientQuery })),
}))

import { getAdminOptimizationQueueSnapshot } from './optimize-job-store'

describe('admin optimization queue snapshot', () => {
  beforeEach(() => {
    clientQuery.mockReset()
    process.env.OPTIMIZE_GLOBAL_QUEUE_LIMIT = '240'
  })

  it('returns ordered safe operational fields and derives retry and failure counts', async () => {
    const now = '2026-07-19T10:00:00.000Z'
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('set transaction')) return { rows: [] }
      if (sql.includes('transaction_timestamp')) return { rows: [{ snapshot_at: now }] }
      if (sql.includes("job.status in ('queued', 'running')")) {
        return { rows: [
          queueRow({ id: 'priority-job', priority: 20, profile_id: 'profile-1', profile_display_name: '主账号', user_id: 'user-1', user_email: 'admin@example.test' }),
          queueRow({ id: 'retry-job', priority: 0, attempt_count: 1, failure_count: 1, next_attempt_at: '2026-07-19T10:01:00.000Z' }),
          queueRow({ id: 'running-job', status: 'running', priority: 10, worker_id: 'worker-1', started_at: '2026-07-19T09:59:00.000Z', heartbeat_at: now }),
        ] }
      }
      return { rows: [
        queueRow({ id: 'failed-job', status: 'failed', failure_kind: 'timed_out', public_error_code: 'execution_retries_exhausted', finished_at: now }),
        queueRow({ id: 'success-job', status: 'succeeded', finished_at: now }),
      ] }
    })

    const snapshot = await getAdminOptimizationQueueSnapshot(3)

    expect(snapshot).toMatchObject({
      snapshot_at: now,
      capacity: { queue_limit: 240, worker_concurrency: 3 },
      counts: { queued: 2, running: 1, retry_waiting: 1, recent_failed: 1 },
    })
    expect(snapshot.queued_jobs.map((job) => [job.id, job.queue_position])).toEqual([
      ['priority-job', 1],
      ['retry-job', 2],
    ])
    expect(snapshot.queued_jobs[0]).toMatchObject({
      user: { id: 'user-1', email: 'admin@example.test' },
      profile: { id: 'profile-1', display_name: '主账号' },
      priority: { value: 20, label: '优先券' },
    })
    expect(snapshot.recent_jobs[0]).toMatchObject({
      error_summary: '任务执行重试次数已用尽。',
      failure_kind: 'timed_out',
      public_error_code: 'execution_retries_exhausted',
    })
    expect(JSON.stringify(snapshot)).not.toContain('payload_json')
    expect(JSON.stringify(snapshot)).not.toContain('result_json')
    expect(JSON.stringify(snapshot)).not.toContain('owner_key')
    expect(JSON.stringify(snapshot)).not.toContain('lock_token')
    expect(JSON.stringify(snapshot)).not.toContain('internal exception detail')
  })
})

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queued-job',
    status: 'queued',
    priority: 0,
    permission: 'free_preview',
    source: 'account_profile',
    attempt_count: 0,
    failure_count: 0,
    worker_id: null,
    heartbeat_at: null,
    next_attempt_at: null,
    expires_at: '2026-07-19T10:30:00.000Z',
    cancel_requested_at: null,
    created_at: '2026-07-19T09:58:00.000Z',
    started_at: null,
    finished_at: null,
    updated_at: '2026-07-19T09:58:00.000Z',
    failure_kind: null,
    public_error_code: null,
    profile_id: null,
    profile_display_name: null,
    user_id: null,
    user_email: null,
    ...overrides,
  }
}
