import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  requireRootAdminPassword: vi.fn(),
  listBehaviorRiskCases: vi.fn(),
  reviewBehaviorRiskCase: vi.fn(),
}))

vi.mock('./admin-auth', () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
  requireRootAdminPassword: mocks.requireRootAdminPassword,
}))
vi.mock('../storage/behavior-risk-store', () => ({
  BehaviorRiskReviewError: class BehaviorRiskReviewError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
  },
  listBehaviorRiskCases: mocks.listBehaviorRiskCases,
  reviewBehaviorRiskCase: mocks.reviewBehaviorRiskCase,
}))

import adminBehaviorRiskHandler from './admin-behavior-risk'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAdminRequest.mockResolvedValue({
    ok: true,
    username: 'reviewer',
    role: 'risk_reviewer',
    capabilities: ['risk_view', 'risk_review'],
  })
  mocks.requireRootAdminPassword.mockResolvedValue({ ok: true, username: 'root' })
  mocks.listBehaviorRiskCases.mockResolvedValue({
    cases: [],
    pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 },
    health: {
      status: 'unknown', last_collection_at: null, last_collection_status: null,
      last_evaluation_at: null, last_evaluation_status: null,
      last_failure_at: null, last_failure_stage: null, backlog_count: 0,
      events_processed: 0, duration_ms: 0, purged_events: 0,
    },
  })
  mocks.reviewBehaviorRiskCase.mockResolvedValue({ ok: true })
})

describe('admin behavior risk HTTP boundary', () => {
  it('rejects malformed or oversized pagination instead of silently falling back', async () => {
    const response = await adminBehaviorRiskHandler(new Request(
      'https://example.test/api/admin/behavior-risk?page=oops&page_size=101',
    ))

    expect(response.status).toBe(400)
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'risk_view')
    expect(mocks.listBehaviorRiskCases).not.toHaveBeenCalled()
  })

  it('requires risk_review and Root step-up for restriction actions', async () => {
    const response = await adminBehaviorRiskHandler(new Request('https://example.test/api/admin/behavior-risk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        case_id: 'case-1',
        outcome: 'restrict',
        note: '确认账号异常并冻结',
        root_password: 'root-secret',
        members: [{ user_id: 'user-1', action: 'freeze_account' }],
      }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'risk_review')
    expect(mocks.requireRootAdminPassword).toHaveBeenCalledWith(expect.any(Request), 'root-secret')
    expect(mocks.reviewBehaviorRiskCase).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-1',
      adminUsername: 'reviewer',
    }))
  })
})
