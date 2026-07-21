import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticateAdminRequest, getDeadLetterDetail, getQueueSnapshot, listDeadLetters } = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  getDeadLetterDetail: vi.fn(),
  getQueueSnapshot: vi.fn(),
  listDeadLetters: vi.fn(),
}))

vi.mock('./admin-auth', () => ({ authenticateAdminRequest }))
vi.mock('../storage/optimize-job-store', () => ({
  discardOptimizationDeadLetter: vi.fn(),
  getAdminOptimizationQueueSnapshot: getQueueSnapshot,
  getOptimizationDeadLetterDetail: getDeadLetterDetail,
  listOptimizationDeadLetters: listDeadLetters,
  replayOptimizationDeadLetter: vi.fn(),
}))
vi.mock('../optimize-job-runner', () => ({
  getOptimizeGlobalWorkerConcurrency: () => 3,
  kickOptimizeJobProcessing: vi.fn(),
}))

import adminOptimizationHandler from './admin-optimization'

describe('admin optimization handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'ops' })
    getQueueSnapshot.mockResolvedValue({ snapshot_at: '2026-07-19T10:00:00.000Z', queued_jobs: [], running_jobs: [], recent_jobs: [] })
    getDeadLetterDetail.mockResolvedValue(null)
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
    expect(getQueueSnapshot).toHaveBeenCalledWith(3, 20)
    await expect(response.json()).resolves.toMatchObject({ queued_jobs: [], running_jobs: [], recent_jobs: [] })
  })

  it('returns the original persisted payload for one dead-letter detail', async () => {
    getDeadLetterDetail.mockResolvedValue({
      id: 'letter-1',
      job_id: 'job-1',
      payload_json: {
        effectiveConfig: { controlCenterLevel: 5 },
        operators: [{ name: '能天使', elite: 2 }],
      },
    })

    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=dead_letter&id=letter-1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getDeadLetterDetail).toHaveBeenCalledWith('letter-1')
    await expect(response.json()).resolves.toMatchObject({
      dead_letter: {
        id: 'letter-1',
        payload_json: {
          effectiveConfig: { controlCenterLevel: 5 },
          operators: [{ name: '能天使', elite: 2 }],
        },
      },
    })
  })

  it('validates dead-letter detail IDs and reports missing records', async () => {
    const missingId = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=dead_letter'))
    expect(missingId.status).toBe(400)

    const missingRecord = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=dead_letter&id=missing'))
    expect(missingRecord.status).toBe(404)
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
