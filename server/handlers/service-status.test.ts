import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getQueueSnapshot, isServiceReady } = vi.hoisted(() => ({
  getQueueSnapshot: vi.fn(),
  isServiceReady: vi.fn(),
}))

vi.mock('../storage/optimize-job-store', () => ({ getAdminOptimizationQueueSnapshot: getQueueSnapshot }))
vi.mock('../lifecycle', () => ({ isServiceReady }))

import serviceStatusHandler from './service-status'

describe('service status handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isServiceReady.mockReturnValue(true)
    getQueueSnapshot.mockResolvedValue(snapshot({ queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1 }))
  })

  it('returns a safe no-store aggregate for the public status page', async () => {
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getQueueSnapshot).toHaveBeenCalledWith(undefined, 1)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      status: 'available',
      queue: expect.objectContaining({ queued: 0, running: 1, worker_concurrency: 3 }),
      components: [{ id: 'optimization', status: 'available' }],
    }))
  })

  it('reports congestion at the yellow threshold', async () => {
    getQueueSnapshot.mockResolvedValue(snapshot({ queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1 }))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'congested' })
  })

  it('reports red when readiness or the worker registry is unavailable', async () => {
    isServiceReady.mockReturnValue(false)
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ status: 'unavailable' })
  })

  it('does not expose storage errors', async () => {
    getQueueSnapshot.mockRejectedValue(new Error('secret database details'))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))
    expect(response.status).toBe(503)
    await expect(response.text()).resolves.not.toContain('secret database details')
  })

  it('rejects non-GET requests', async () => {
    const response = await serviceStatusHandler(new Request('http://localhost/api/status', { method: 'POST' }))
    expect(response.status).toBe(405)
  })
})

function snapshot(input: { queued: number; running: number; workerConcurrency: number; workerInstances: number }) {
  return {
    snapshot_at: '2026-08-08T09:00:00.000Z',
    capacity: {
      queue_limit: 200,
      worker_concurrency: input.workerConcurrency,
      worker_instances: input.workerInstances,
      source: 'runtime_registry' as const,
      heartbeat_interval_ms: 10_000,
      stale_after_ms: 30_000,
    },
    counts: { queued: input.queued, running: input.running, retry_waiting: 0, recent_failed: 0 },
    queued_jobs: [],
    running_jobs: [],
    recent_jobs: [],
  }
}
