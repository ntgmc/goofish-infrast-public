import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn(), requireRootAdminPassword: vi.fn() }))
const database = vi.hoisted(() => ({ query: vi.fn() }))
const store = vi.hoisted(() => {
  class MeteredProfileError extends Error {}
  return {
    MeteredProfileError,
    getCommercialLimits: vi.fn(),
    updateCommercialAccount: vi.fn(),
  }
})

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/metered-profile-store', () => store)
vi.mock('../storage/balance-store', () => ({ getBalanceSummary: vi.fn() }))
vi.mock('../storage/user-store', () => ({ getUserById: vi.fn() }))
vi.mock('../storage/postgres', () => database)

import adminCommercialHandler from './admin-commercial'

describe('admin commercial account revisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'operator' })
    auth.requireRootAdminPassword.mockResolvedValue({ ok: true, username: 'root' })
    store.updateCommercialAccount.mockResolvedValue({ revision: 5 })
    database.query.mockResolvedValue({ rows: [] })
  })

  it('passes the loaded revision, audit actor, and Root approver to the store', async () => {
    const response = await adminCommercialHandler(request({
      user_id: 'user-1',
      active_profile_limit: 120,
      total_profile_limit: 1200,
      suspended: true,
      reason: 'risk review',
      expected_revision: 4,
      idempotency_key: 'commercial-1',
      root_password: 'root-secret',
    }))

    expect(response.status).toBe(200)
    expect(auth.requireRootAdminPassword).toHaveBeenCalledWith(expect.any(Request), 'root-secret')
    expect(store.updateCommercialAccount).toHaveBeenCalledWith({
      userId: 'user-1',
      activeLimit: 120,
      totalLimit: 1200,
      suspended: true,
      reason: 'risk review',
      expectedRevision: 4,
      actorUsername: 'operator',
      approvedBy: 'root',
      requestId: 'commercial-1',
    })
  })

  it('does not update the account when Root approval fails', async () => {
    auth.requireRootAdminPassword.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Root 口令错误。' }), { status: 401 }),
    })

    const response = await adminCommercialHandler(request({
      user_id: 'user-1',
      suspended: true,
      reason: 'risk review',
      expected_revision: 4,
      idempotency_key: 'commercial-2',
      root_password: 'wrong',
    }))

    expect(response.status).toBe(401)
    expect(store.updateCommercialAccount).not.toHaveBeenCalled()
  })

  it('returns pending reconciliation case details instead of only an aggregate count', async () => {
    database.query.mockImplementation(async (sql: string) => sql.includes('billing_reconciliation_cases')
      ? { rows: [{
          id: 'case-1',
          kind: 'reservation_job_mismatch',
          user_id: 'user-1',
          job_id: 'job-1',
          reservation_id: 'reservation-1',
          detail_json: { reservation_status: 'released', job_status: 'succeeded' },
          first_seen_at: '2026-08-01T00:00:00.000Z',
          last_seen_at: '2026-08-02T00:00:00.000Z',
          total: '3',
        }] }
      : { rows: [] })

    const response = await adminCommercialHandler(new Request('http://localhost/api/admin/commercial?summary=1'))
    const body = await response.json() as {
      reconciliation_anomalies: number
      reconciliation_cases: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(body.reconciliation_anomalies).toBe(3)
    expect(body.reconciliation_cases).toEqual([expect.objectContaining({
      id: 'case-1',
      kind: 'reservation_job_mismatch',
      detail_json: { reservation_status: 'released', job_status: 'succeeded' },
    })])
    expect(body.reconciliation_cases[0]).not.toHaveProperty('total')
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/admin/commercial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
