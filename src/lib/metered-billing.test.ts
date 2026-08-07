import { describe, expect, it } from 'vitest'
import { getCommercialTierSummary, getMeteredScheduleQuote } from './metered-billing'

describe('metered billing policy', () => {
  it.each([
    ['9999.99', null, false, 0, '1500.00'],
    ['10000.00', 1, true, 1000, '1350.00'],
    ['30000.00', 2, true, 2000, '1200.00'],
    ['50000.00', 3, true, 3000, '1050.00'],
    ['100000.00', 4, true, 4000, '900.00'],
  ] as const)('prices commercial schedules at %s credited points', (credited, level, eligible, discount, charge) => {
    expect(getCommercialTierSummary(credited)).toMatchObject({ level, eligible, discount_bps: discount, charge_points: charge })
  })

  it('suspends commercial eligibility while debt remains without changing the earned tier', () => {
    expect(getCommercialTierSummary('50000.00', '0.01')).toMatchObject({ eligible: false, level: 3, charge_points: '1050.00' })
  })

  it('keeps personal metered schedules at 1200 points', () => {
    expect(getMeteredScheduleQuote('metered_personal', '100000.00')).toEqual({
      pricing_version: '2026-08-06-v3',
      billing_kind: 'metered_personal',
      list_price: '1200.00',
      tier: null,
      discount_bps: 0,
      charge: '1200.00',
    })
  })
})
