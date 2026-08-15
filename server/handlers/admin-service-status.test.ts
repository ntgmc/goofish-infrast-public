import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getHistory: vi.fn(),
  getCost: vi.fn(),
  listIncidents: vi.fn(),
  createIncident: vi.fn(),
  appendUpdate: vi.fn(),
  saveCost: vi.fn(),
  getSnapshot: vi.fn(),
  autoscalingConfig: vi.fn(),
}))

vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.authenticate }))
vi.mock('../storage/service-status-store', () => ({
  getAdminServiceStatusHistory: mocks.getHistory,
  getServiceStatusCostConfig: mocks.getCost,
  listAdminServiceStatusIncidents: mocks.listIncidents,
  createServiceStatusIncident: mocks.createIncident,
  appendServiceStatusIncidentUpdate: mocks.appendUpdate,
  saveServiceStatusCostConfig: mocks.saveCost,
}))
vi.mock('../storage/optimize-job-store', () => ({ getAdminOptimizationQueueSnapshot: mocks.getSnapshot }))
vi.mock('../lifecycle', () => ({ isServiceReady: () => true }))
vi.mock('../optimize-job-config', () => ({
  getOptimizeStatusQueuePickupGraceMs: () => 5_000,
  getOptimizeWorkerAutoscalingConfiguration: mocks.autoscalingConfig,
}))

import adminServiceStatusHandler from './admin-service-status'

describe('admin service status handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({ ok: true, username: 'ops', capabilities: ['optimization_view', 'optimization_manage'] })
    mocks.autoscalingConfig.mockReturnValue({ enabled: false, scaleUpQueueThreshold: 4, scaleDownQueueThreshold: 1, scaleDownIdleMs: 600000, intervalMs: 30000 })
    mocks.getHistory.mockResolvedValue({ from: '2026-07-09T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z', buckets: [] })
    mocks.getCost.mockResolvedValue({ component_id: 'optimization', billing_model: 'ecs_payg', currency: 'CNY', hourly_price_cny: null, timezone: 'Asia/Shanghai', schedule_enabled: false, valley_worker_instances: 0, peak_windows: [], updated_at: null })
    mocks.listIncidents.mockResolvedValue([])
    mocks.getSnapshot.mockResolvedValue({ snapshot_at: '2026-08-08T09:00:00.000Z', capacity: { queue_limit: 200, worker_concurrency: 3, worker_instances: 1 }, counts: { queued: 0, ready_queued: 0, oldest_ready_wait_ms: null, running: 0 } })
    mocks.createIncident.mockResolvedValue({ id: 'incident-1', status: 'investigating' })
    mocks.appendUpdate.mockResolvedValue({ id: 'incident-1', status: 'resolved' })
    mocks.saveCost.mockResolvedValue({ component_id: 'optimization', billing_model: 'ecs_payg', currency: 'CNY', hourly_price_cny: 0.8, timezone: 'Asia/Shanghai', schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }], updated_at: '2026-08-08T10:00:00.000Z' })
  })

  it('requires an authenticated viewer for history', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: '登录' }), { status: 401 }) })
    const response = await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status?view=history'))
    expect(response.status).toBe(401)
  })

  it('returns aggregate history without task or user payloads', async () => {
    const response = await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status?view=history'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ history: { interval: 'hour', buckets: [] }, incidents: [] })
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), 'optimization_view')
  })

  it('reports elastic processing in the management status view', async () => {
    mocks.autoscalingConfig.mockReturnValue({ enabled: true, scaleUpQueueThreshold: 4, scaleDownQueueThreshold: 1, scaleDownIdleMs: 600000, intervalMs: 30000 })
    mocks.getSnapshot.mockResolvedValue({ snapshot_at: '2026-08-08T09:00:00.000Z', capacity: { queue_limit: 200, worker_concurrency: 3, worker_instances: 1 }, counts: { queued: 5, ready_queued: 5, oldest_ready_wait_ms: 10_000, running: 3 } })
    const response = await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status?view=history'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'scaling', components: [{ id: 'optimization', status: 'scaling' }] })
  })

  it('keeps the management status available during normal worker pickup', async () => {
    mocks.getSnapshot.mockResolvedValue({
      snapshot_at: '2026-08-08T09:00:00.000Z',
      capacity: { queue_limit: 200, worker_concurrency: 3, worker_instances: 1 },
      counts: { queued: 1, ready_queued: 1, oldest_ready_wait_ms: 1_000, running: 0 },
    })
    const response = await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status?view=history'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'available', components: [{ id: 'optimization', status: 'available' }] })
  })

  it('requires manage capability and recent login for mutations', async () => {
    await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status', { method: 'POST', body: JSON.stringify({ action: 'create_incident', component_id: 'optimization', title: '队列延迟', impact: 'minor', status: 'investigating', started_at: '2026-08-08T09:00:00.000Z', body: '正在调查。', reason: '记录事件' }), headers: { 'Content-Type': 'application/json' } }))
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { capability: 'optimization_manage', requireRecentLogin: true })
    expect(mocks.createIncident).toHaveBeenCalledOnce()
  })

  it('maps optimistic concurrency conflicts to 409', async () => {
    mocks.appendUpdate.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'service_status_incident_conflict' }))
    const response = await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status', { method: 'PATCH', body: JSON.stringify({ action: 'append_update', incident_id: 'incident-1', status: 'resolved', body: '已恢复。', expected_updated_at: '2026-08-08T09:00:00.000Z', reason: '解决事件' }), headers: { 'Content-Type': 'application/json' } }))
    expect(response.status).toBe(409)
  })

  it('saves ECS cost planning with manage capability and recent login', async () => {
    const response = await adminServiceStatusHandler(new Request('http://localhost/api/admin/service-status', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_cost_config', component_id: 'optimization', billing_model: 'ecs_payg', currency: 'CNY', hourly_price_cny: 0.8, timezone: 'Asia/Shanghai', schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }], expected_updated_at: null, reason: '更新成本计划' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(response.status).toBe(200)
    expect(mocks.saveCost).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: null, config: expect.objectContaining({ hourly_price_cny: 0.8, schedule_enabled: true }) }))
  })
})
