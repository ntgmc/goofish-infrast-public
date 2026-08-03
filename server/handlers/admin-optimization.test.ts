import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticateAdminRequest, discardDeadLetter, getDeadLetterDetail, getQueueSnapshot, listDeadLetters, recordAudit, replayDeadLetter, requestProcessing } = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  discardDeadLetter: vi.fn(),
  getDeadLetterDetail: vi.fn(),
  getQueueSnapshot: vi.fn(),
  listDeadLetters: vi.fn(),
  recordAudit: vi.fn(),
  replayDeadLetter: vi.fn(),
  requestProcessing: vi.fn(),
}))

vi.mock('./admin-auth', () => ({ authenticateAdminRequest }))
vi.mock('../storage/optimize-job-store', () => ({
  discardOptimizationDeadLetter: discardDeadLetter,
  getAdminOptimizationQueueSnapshot: getQueueSnapshot,
  getOptimizationDeadLetterDetail: getDeadLetterDetail,
  listOptimizationDeadLetters: listDeadLetters,
  replayOptimizationDeadLetter: replayDeadLetter,
  isOptimizeJobAdmissionError: () => false,
}))
vi.mock('../storage/admin-operation-audit-store', () => ({ recordAdminOperationAudit: recordAudit }))
vi.mock('../optimize-job-signals', () => ({ requestOptimizeJobProcessing: requestProcessing }))

import adminOptimizationHandler from './admin-optimization'

describe('admin optimization handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'ops' })
    recordAudit.mockResolvedValue(undefined)
    getQueueSnapshot.mockResolvedValue({ snapshot_at: '2026-07-19T10:00:00.000Z', queued_jobs: [], running_jobs: [], recent_jobs: [] })
    getDeadLetterDetail.mockResolvedValue(null)
    listDeadLetters.mockResolvedValue([])
    replayDeadLetter.mockResolvedValue(null)
  })

  it('requires an authenticated admin session', async () => {
    authenticateAdminRequest.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=queue'))
    expect(response.status).toBe(401)
    expect(getQueueSnapshot).not.toHaveBeenCalled()
  })

  it('returns a no-store queue snapshot using registered worker capacity', async () => {
    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=queue'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getQueueSnapshot).toHaveBeenCalledWith(undefined, 20)
    expect(authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'optimization_view')
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
    expect(authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), {
      capability: 'sensitive_data_view',
      requireRecentLogin: false,
    })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUsername: 'ops',
      action: 'optimization_dead_letter.payload_view',
      targetId: 'letter-1',
    }))
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

  it('downloads the complete dead-letter payload as a no-store JSON attachment', async () => {
    const payload = {
      effectiveConfig: { controlCenterLevel: 5 },
      operators: [{ name: '能天使', elite: 2 }],
    }
    getDeadLetterDetail.mockResolvedValue({
      id: 'letter-1',
      job_id: 'job-1',
      payload_json: payload,
    })

    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=dead_letter_download&id=letter-1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="optimization-dead-letter-letter-1.json"')
    expect(authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), {
      capability: 'sensitive_data_view',
      requireRecentLogin: true,
    })
    await expect(response.text()).resolves.toBe(JSON.stringify(payload, null, 2))
  })

  it('validates dead-letter detail IDs and reports missing records', async () => {
    const missingId = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=dead_letter'))
    expect(missingId.status).toBe(400)

    const missingRecord = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization?view=dead_letter&id=missing'))
    expect(missingRecord.status).toBe(404)
  })

  it('requests worker processing after replaying a dead-letter job', async () => {
    replayDeadLetter.mockResolvedValue({ id: 'job-replayed' })

    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'replay', id: 'letter-1', reason: 'verified' }),
    }))

    expect(response.status).toBe(202)
    expect(replayDeadLetter).toHaveBeenCalledWith('letter-1', expect.objectContaining({
      actorUsername: 'ops',
      reason: 'verified',
      requestId: expect.any(String),
    }))
    expect(authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), {
      capability: 'optimization_manage',
      requireRecentLogin: true,
    })
    expect(requestProcessing).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toEqual({ ok: true, replayed_job_id: 'job-replayed' })
  })

  it('persists the actor and reason when discarding a dead-letter job', async () => {
    discardDeadLetter.mockResolvedValue(true)

    const response = await adminOptimizationHandler(new Request('http://localhost/api/admin/optimization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'request-1' },
      body: JSON.stringify({ action: 'discard', id: 'letter-1', reason: 'invalid legacy payload' }),
    }))

    expect(response.status).toBe(200)
    expect(discardDeadLetter).toHaveBeenCalledWith('letter-1', expect.objectContaining({
      actorUsername: 'ops',
      reason: 'invalid legacy payload',
      requestId: 'request-1',
    }))
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
