import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getQueueSnapshot, isServiceReady, getHistory, listIncidents, autoscalingConfig, ensureSklandConfiguration } = vi.hoisted(() => ({
  getQueueSnapshot: vi.fn(),
  isServiceReady: vi.fn(),
  getHistory: vi.fn(),
  listIncidents: vi.fn(),
  autoscalingConfig: vi.fn(),
  ensureSklandConfiguration: vi.fn(),
}))

vi.mock('../storage/optimize-job-store', () => ({ getAdminOptimizationQueueSnapshot: getQueueSnapshot }))
vi.mock('../storage/service-status-store', () => ({ getServiceStatusHistory: getHistory, listPublicServiceStatusIncidents: listIncidents }))
vi.mock('../lifecycle', () => ({ isServiceReady }))
vi.mock('../skland-config', () => ({ ensureSklandServiceConfiguration: ensureSklandConfiguration }))
vi.mock('../optimize-job-config', () => ({
  getOptimizeStatusQueuePickupGraceMs: () => 5_000,
  getOptimizeWorkerAutoscalingConfiguration: autoscalingConfig,
}))

import serviceStatusHandler from './service-status'

describe('service status handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isServiceReady.mockReturnValue(true)
    ensureSklandConfiguration.mockReturnValue(undefined)
    autoscalingConfig.mockReturnValue({ enabled: false, scaleUpQueueThreshold: 4, scaleDownQueueThreshold: 1, scaleDownIdleMs: 600000, intervalMs: 30000 })
    getQueueSnapshot.mockResolvedValue(snapshot({ queued: 0, running: 1, workerConcurrency: 3, workerInstances: 1 }))
    getHistory.mockResolvedValue({ from: '2026-07-09T09:00:00.000Z', to: '2026-08-08T09:00:00.000Z', buckets: [{ component_id: 'optimization', bucket_start: '2026-08-08T08:00:00.000Z', status: 'available', sample_count: 12, availability_percent: 100 }] })
    listIncidents.mockResolvedValue([{ id: 'incident-1', component_id: 'optimization', title: '短暂延迟', impact: 'minor', status: 'resolved', started_at: '2026-08-01T01:00:00.000Z', resolved_at: '2026-08-01T02:00:00.000Z', created_at: '2026-08-01T01:00:00.000Z', updated_at: '2026-08-01T02:00:00.000Z', updates: [] }])
  })

  it('returns a safe no-store aggregate for the public status page', async () => {
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getQueueSnapshot).toHaveBeenCalledWith(undefined, 1)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      status: 'available',
      queue: expect.objectContaining({ queued: 0, running: 1, worker_concurrency: 3 }),
      components: [
        { id: 'optimization', status: 'available' },
        { id: 'skland_import', status: 'available' },
      ],
      history: expect.objectContaining({ interval: 'hour', complete: true, buckets: expect.any(Array) }),
      incidents: expect.arrayContaining([expect.objectContaining({ id: 'incident-1', status: 'resolved' })]),
    }))
  })

  it('keeps the realtime response when history storage is unavailable', async () => {
    getHistory.mockRejectedValue(new Error('secret history storage'))
    listIncidents.mockRejectedValue(new Error('secret incident storage'))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('available')
    expect(body.history.complete).toBe(false)
    expect(body.history.buckets).toEqual([])
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('reports congestion at the yellow threshold', async () => {
    getQueueSnapshot.mockResolvedValue(snapshot({ queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1 }))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'congested' })
  })

  it('keeps a newly queued job available while a free worker is picking it up', async () => {
    getQueueSnapshot.mockResolvedValue(snapshot({
      queued: 1,
      readyQueued: 1,
      oldestReadyWaitMs: 1_000,
      running: 0,
      workerConcurrency: 3,
      workerInstances: 1,
    }))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'available' })
  })

  it('reports elastic processing when autoscaling is consuming the queue', async () => {
    autoscalingConfig.mockReturnValue({ enabled: true, scaleUpQueueThreshold: 4, scaleDownQueueThreshold: 1, scaleDownIdleMs: 600000, intervalMs: 30000 })
    getQueueSnapshot.mockResolvedValue(snapshot({ queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1 }))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'scaling', components: [
      { id: 'optimization', status: 'scaling' },
      { id: 'skland_import', status: 'available' },
    ] })
  })

  it('reports orange overload above twenty queued jobs', async () => {
    getQueueSnapshot.mockResolvedValue(snapshot({ queued: 21, running: 3, workerConcurrency: 3, workerInstances: 1 }))
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'overloaded',
      thresholds: { queue_congested_at: 5, queue_overloaded_at: 20 },
    })
  })

  it('reports red when readiness or the worker registry is unavailable', async () => {
    isServiceReady.mockReturnValue(false)
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ status: 'unavailable', components: [
      { id: 'optimization', status: 'unavailable' },
      { id: 'skland_import', status: 'unavailable' },
    ] })
  })

  it('reports the Skland import component unavailable when its service configuration is invalid', async () => {
    ensureSklandConfiguration.mockImplementation(() => { throw new Error('invalid configuration') })
    const response = await serviceStatusHandler(new Request('http://localhost/api/status'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'available', components: [
      { id: 'optimization', status: 'available' },
      { id: 'skland_import', status: 'unavailable' },
    ] })
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

  it('rejects unknown query parameters', async () => {
    const response = await serviceStatusHandler(new Request('http://localhost/api/status?debug=true'))
    expect(response.status).toBe(400)
  })
})

function snapshot(input: {
  queued: number
  readyQueued?: number
  oldestReadyWaitMs?: number | null
  running: number
  workerConcurrency: number
  workerInstances: number
}) {
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
    counts: {
      queued: input.queued,
      ready_queued: input.readyQueued ?? input.queued,
      oldest_ready_wait_ms: input.oldestReadyWaitMs ?? (input.queued > 0 ? 10_000 : null),
      running: input.running,
      retry_waiting: 0,
      recent_failed: 0,
    },
    queued_jobs: [],
    running_jobs: [],
    recent_jobs: [],
  }
}
