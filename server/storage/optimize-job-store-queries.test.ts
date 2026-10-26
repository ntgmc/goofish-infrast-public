import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('./schema', () => ({ ensureDatabaseSchema: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./postgres', () => ({ query: queryMock, withTransaction: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-27T00:00:00.000Z')
  vi.stubEnv('OPTIMIZE_GLOBAL_WORKER_CONCURRENCY', '1')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const queued = {
  id: 'queued', status: 'queued', priority: 0, owner_key: 'owner', estimated_duration_ms: 5_000,
  created_at: '2026-10-27T00:00:00.000Z', started_at: null,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('PostgreSQL queue display estimates', () => {
  it('shares an in-flight query and one-second snapshot across store instances and job IDs', async () => {
    const { createPostgresOptimizeJobStore } = await import('./optimize-job-store')
    const first = createPostgresOptimizeJobStore()
    const second = createPostgresOptimizeJobStore()
    const pending = deferred<{ rows: typeof queued[] }>()
    queryMock.mockReturnValueOnce(pending.promise)
    const estimates = Promise.all([first.getQueueEstimate!('queued'), second.getQueueEstimate!('missing')])
    await vi.waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1))
    vi.advanceTimersByTime(2_000)
    const lateRequest = first.getQueueEstimate!('queued')
    pending.resolve({ rows: [queued] })
    expect(await estimates).toEqual([
      { queuePosition: 1, estimatedWaitMs: 0 }, { queuePosition: null, estimatedWaitMs: null },
    ])
    expect(await lateRequest).toEqual({ queuePosition: 1, estimatedWaitMs: 0 })
    vi.advanceTimersByTime(999)
    await second.getQueueEstimate!('queued')
    expect(queryMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    queryMock.mockResolvedValueOnce({ rows: [] })
    await expect(first.getQueueEstimate!('queued')).resolves.toEqual({ queuePosition: null, estimatedWaitMs: null })
    expect(queryMock).toHaveBeenCalledTimes(2)
    const sql = queryMock.mock.calls[0][0] as string
    expect(sql).toContain("payload_json #> '{estimate,estimated_duration_ms}' as estimated_duration_ms")
    expect(sql).not.toMatch(/select\s+\*|owner_key,\s*payload_json\s*,/)
  })

  it('clears a rejected refresh so concurrent callers can retry', async () => {
    const { createPostgresOptimizeJobStore } = await import('./optimize-job-store')
    const store = createPostgresOptimizeJobStore()
    queryMock.mockRejectedValueOnce(new Error('database unavailable'))
    const failed = await Promise.allSettled([store.getQueueEstimate!('queued'), store.getQueueEstimate!('queued')])
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(queryMock).toHaveBeenCalledTimes(1)
    queryMock.mockResolvedValueOnce({ rows: [queued] })
    await expect(store.getQueueEstimate!('queued')).resolves.toEqual({ queuePosition: 1, estimatedWaitMs: 0 })
    expect(queryMock).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1_000)
    queryMock.mockRejectedValueOnce(new Error('refresh failed'))
    await expect(store.getQueueEstimate!('queued')).rejects.toThrow('refresh failed')
    queryMock.mockResolvedValueOnce({ rows: [] })
    await expect(store.getQueueEstimate!('queued')).resolves.toEqual({ queuePosition: null, estimatedWaitMs: null })
  })

  it('shares the snapshot with lists while keeping current list status authoritative', async () => {
    const { createPostgresOptimizeJobStore } = await import('./optimize-job-store')
    const store = createPostgresOptimizeJobStore()
    queryMock.mockResolvedValueOnce({ rows: [queued] })
    await store.getQueueEstimate!('queued')
    queryMock.mockResolvedValueOnce({ rows: [{ ...queued, result_available: false }] })
    expect((await createPostgresOptimizeJobStore().listJobsByProfile('profile'))[0]).toMatchObject({
      queuePosition: 1, queueWaitMs: 0,
    })
    queryMock.mockResolvedValueOnce({ rows: [{ ...queued, status: 'running', result_available: false }] })
    expect((await store.listJobsByProfile('profile'))[0]).toMatchObject({ queuePosition: null, queueWaitMs: null })
    expect(queryMock).toHaveBeenCalledTimes(3)
    const sql = queryMock.mock.calls[1][0] as string
    expect(sql).not.toContain('job.*')
    expect(sql).not.toMatch(/job\.payload_json\s*,|job\.result_json\s*,/)
  })
})
