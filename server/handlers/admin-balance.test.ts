import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn(), requireRootAdminPassword: vi.fn() }))
const store = vi.hoisted(() => {
  class BalanceError extends Error {}
  return {
    BalanceError,
    adjustBalance: vi.fn(),
    createBalanceRequestHash: vi.fn(() => 'request-hash'),
    getAdminBalancePage: vi.fn(),
    reverseQualificationCredit: vi.fn(),
  }
})

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/balance-store', () => store)
vi.mock('../storage/user-store', () => ({ getUserById: vi.fn() }))

import adminBalanceHandler from './admin-balance'

describe('admin balance step-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'operator' })
    auth.requireRootAdminPassword.mockResolvedValue({ ok: true, username: 'root' })
    store.adjustBalance.mockResolvedValue({ balance: {}, transaction: {}, replayed: false })
  })

  it('requires Root approval and records the approval chain', async () => {
    const response = await adminBalanceHandler(request({
      user_id: 'user-1',
      operation: 'credit',
      amount: '12.30',
      reason: 'manual correction',
      idempotency_key: 'adjust-1',
      root_password: 'root-secret',
    }))

    expect(response.status).toBe(200)
    expect(auth.requireRootAdminPassword).toHaveBeenCalledWith(expect.any(Request), 'root-secret')
    expect(store.adjustBalance).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      amount: '12.30',
      adminUsername: 'operator',
      approvedBy: 'root',
      idempotencyKey: 'adjust-1',
      requestHash: 'request-hash',
    }))
  })

  it('does not mutate balances when Root approval fails', async () => {
    auth.requireRootAdminPassword.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Root 口令错误。' }), { status: 401 }),
    })

    const response = await adminBalanceHandler(request({
      user_id: 'user-1',
      operation: 'debit',
      amount: '1.00',
      reason: 'manual correction',
      idempotency_key: 'adjust-2',
      root_password: 'wrong',
    }))

    expect(response.status).toBe(401)
    expect(store.adjustBalance).not.toHaveBeenCalled()
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/admin/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
