import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticateAdminRequest, getQueueSnapshot, listDeadLetters } = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  getQueueSnapshot: vi.fn(),
  listDeadLetters: vi.fn(),
}))

vi.mock('./admin-auth', () => ({ authenticateAdminRequest }))
vi.mock('../storage/optimize-job-store', () => ({
  discardOptimizationDeadLetter: vi.fn(),
  getAdminOptimizationQueueSnapshot: getQueueSnapshot,
  listOptimizationDeadLetters: listDeadLetters,
  replayOptimizationDeadLetter: vi.fn(),
}))
vi.mock('../optimize-job-runner', () => ({
  getOptimizeGlobalWorkerConcurrency: () => 2,
  kickOptimizeJobProcessing: vi.fn(),
}))

import adminOptimizationHandler from './admin-optimization'

describe('admin optimization handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'ops' })
    getQueueSnapshot.mockResolvedValue({ snapshot_at: '2026-07-19T10:00:00.000Z', queued_jobs: [], running_jobs: [], recent_jobs: [] })
    listDeadLetters.mockResolvedValue([])
  })

  it('requires an authenticated admin session', async () => {
    authenticateAdminRequest.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=queue'))
    expect(response.status).toBe(401)
    expect(getQueueSnapshot).not.toHaveBeenCalled()
  })

  it('returns a no-store queue snapshot with configured concurrency', async () => {
    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=queue'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getQueueSnapshot).toHaveBeenCalledWith(2, 20)
    await expect(response.json()).resolves.toMatchObject({ queued_jobs: [], running_jobs: [], recent_jobs: [] })
  })

  it('rejects unknown views and preserves the default dead-letter response', async () => {
    const invalid = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=unknown'))
    expect(invalid.status).toBe(400)

    const legacy = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?limit=25'))
    expect(legacy.status).toBe(200)
    expect(listDeadLetters).toHaveBeenCalledWith(25, null)
    await expect(legacy.json()).resolves.toEqual({ dead_letters: [] })
  })
})
