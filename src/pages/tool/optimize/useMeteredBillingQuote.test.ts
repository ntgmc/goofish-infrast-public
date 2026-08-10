import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api-client'
import type { BillingQuote } from './useMeteredBillingQuote'
import { submitWithMeteredBillingQuote } from './useMeteredBillingQuote'

const quote: BillingQuote = {
  operation: 'main_schedule',
  quote_id: 'quote-1',
  expires_at: '2026-08-02T00:05:00.000Z',
  pricing_version: '2026-08-09-v4',
  billing_kind: 'metered_commercial',
  list_price: '1500.00',
  tier: 2,
  discount_bps: 1667,
  charge: '1250.00',
  available: '1500.00',
  sufficient: true,
}

describe('submitWithMeteredBillingQuote', () => {
  it('submits the currently displayed quote and refreshes after completion', async () => {
    const submit = vi.fn().mockResolvedValue('accepted')
    const refreshQuote = vi.fn().mockResolvedValue(quote)

    await expect(submitWithMeteredBillingQuote({
      profileKind: 'metered_commercial',
      quote,
      quoteError: null,
      refreshQuote,
      submit,
    })).resolves.toBe('accepted')

    expect(submit).toHaveBeenCalledWith(quote)
    expect(refreshQuote).toHaveBeenCalledTimes(1)
  })

  it('refreshes once and requires another click when the accepted price changed', async () => {
    const latest = { ...quote, quote_id: 'quote-2', charge: '1350.00' }
    const refreshQuote = vi.fn().mockResolvedValue(latest)

    await expect(submitWithMeteredBillingQuote({
      profileKind: 'metered_commercial',
      quote,
      quoteError: null,
      refreshQuote,
      submit: vi.fn().mockRejectedValue(new ApiError(
        'price changed',
        409,
        { code: 'pricing_changed' },
        '/api/optimization/jobs',
      )),
    })).rejects.toThrow('报价已从 1250.00 积分更新为 1350.00 积分')

    expect(refreshQuote).toHaveBeenCalledTimes(1)
  })

  it('blocks metered submission when no displayed quote is available or balance is insufficient', async () => {
    const submit = vi.fn()
    const refreshQuote = vi.fn()
    await expect(submitWithMeteredBillingQuote({
      profileKind: 'metered_personal',
      quote: null,
      quoteError: '报价加载失败',
      refreshQuote,
      submit,
    })).rejects.toThrow('报价加载失败')
    await expect(submitWithMeteredBillingQuote({
      profileKind: 'metered_commercial',
      quote: { ...quote, sufficient: false },
      quoteError: null,
      refreshQuote,
      submit,
    })).rejects.toThrow('积分余额不足')

    expect(submit).not.toHaveBeenCalled()
    expect(refreshQuote).not.toHaveBeenCalled()
  })
})
