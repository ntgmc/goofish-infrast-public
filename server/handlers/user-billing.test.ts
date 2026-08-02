import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  issueMeteredScheduleQuote: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../storage/metered-billing-store', () => ({
  issueMeteredScheduleQuote: mocks.issueMeteredScheduleQuote,
  MeteredBillingQuoteError: class MeteredBillingQuoteError extends Error {},
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
  })

  it('reports sufficient balance when the free balance covers the personal charge', async () => {
    mocks.issueMeteredScheduleQuote.mockResolvedValue(quote({ available: '600.00', sufficient: true }))

    const response = await userBillingHandler(quoteRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ charge: '600.00', sufficient: true })
  })

  it('reports an outstanding debt as insufficient even when the points balance covers the charge', async () => {
    mocks.issueMeteredScheduleQuote.mockResolvedValue(quote({ available: '600.00', sufficient: false }))

    const response = await userBillingHandler(quoteRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ charge: '600.00', available: '600.00', sufficient: false })
  })
})

function quoteRequest(): Request {
  return new Request('http://localhost/api/user/billing/quote?profile_id=profile-1&operation=main_schedule')
}

function quote(patch: { available: string; sufficient: boolean }) {
  return {
    quote_id: 'quote-1',
    expires_at: '2026-07-31T00:05:00.000Z',
    pricing_version: '2026-07-31-v1',
    billing_kind: 'metered_personal',
    list_price: '600.00',
    tier: null,
    discount_bps: 0,
    charge: '600.00',
    ...patch,
  }
}
