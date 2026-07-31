import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBalanceSummary: vi.fn(),
  getCommercialLimits: vi.fn(),
  getProfileForUser: vi.fn(),
  normalizeProfileKind: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../storage/balance-store', () => ({ getBalanceSummary: mocks.getBalanceSummary }))
vi.mock('../storage/metered-profile-store', () => ({ getCommercialLimits: mocks.getCommercialLimits }))
vi.mock('../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  normalizeProfileKind: mocks.normalizeProfileKind,
}))
vi.mock('./user-auth', () => ({
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  requireUserSession: mocks.requireUserSession,
}))

import userBillingHandler from './user-billing'

describe('metered billing quote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getProfileForUser.mockResolvedValue({ id: 'profile-1', kind: 'metered_personal', archived_at: null })
    mocks.normalizeProfileKind.mockReturnValue('metered_personal')
    mocks.getCommercialLimits.mockResolvedValue({ suspended: false })
  })

  it('reports sufficient balance when the free balance covers the personal charge', async () => {
    mocks.getBalanceSummary.mockResolvedValue(balance({ available: '600.00' }))

    const response = await userBillingHandler(quoteRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ charge: '600.00', sufficient: true })
  })

  it('reports an outstanding debt as insufficient even when the points balance covers the charge', async () => {
    mocks.getBalanceSummary.mockResolvedValue(balance({ available: '600.00', debt: '1.00' }))

    const response = await userBillingHandler(quoteRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ charge: '600.00', available: '600.00', sufficient: false })
  })
})

function quoteRequest(): Request {
  return new Request('http://localhost/api/user/billing/quote?profile_id=profile-1&operation=main_schedule')
}

function balance(patch: { available?: string; debt?: string }) {
  return {
    currency: 'points',
    available: patch.available ?? '0.00',
    reserved: '0.00',
    lifetime_credited: '0.00',
    qualification_reversed: '0.00',
    debt: patch.debt ?? '0.00',
    commercial: {
      eligible: false,
      level: null,
      discount_bps: 0,
      charge_points: '1000.00',
      next_level: 1,
      next_threshold: '10000.00',
      points_to_next_level: '10000.00',
    },
  }
}
