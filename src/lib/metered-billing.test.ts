import { describe, expect, it } from 'vitest'
import { getCommercialTierSummary, getMeteredScheduleQuote } from './metered-billing'

describe('metered billing policy', () => {
  it.each([
    ['9999.99', null, false, 0, '1500.00'],
    ['10000.00', 1, true, 1000, '1350.00'],
    ['30000.00', 2, true, 1667, '1250.00'],
    ['50000.00', 3, true, 2333, '1150.00'],
    ['100000.00', 4, true, 2667, '1100.00'],
  ] as const)('prices commercial schedules at %s credited points', (credited, level, eligible, discount, charge) => {
    expect(getCommercialTierSummary(credited)).toMatchObject({ level, eligible, discount_bps: discount, charge_points: charge })
  })

  it('suspends commercial eligibility while debt remains without changing the earned tier', () => {
    expect(getCommercialTierSummary('50000.00', '0.01')).toMatchObject({ eligible: false, level: 3, charge_points: '1150.00' })
  })

  it('keeps personal metered schedules at 1000 points', () => {
    expect(getMeteredScheduleQuote('metered_personal', '100000.00')).toEqual({
      operation: 'main_schedule',
      pricing_version: '2026-08-09-v4',
      billing_kind: 'metered_personal',
      list_price: '1000.00',
      tier: null,
      discount_bps: 0,
      charge: '1000.00',
    })
  })

  it('prices personal incremental recomputes and scenario comparisons independently', () => {
    expect(getMeteredScheduleQuote('metered_personal', '0.00', '0.00', 'incremental_recompute')).toMatchObject({
      operation: 'incremental_recompute', charge: '700.00', list_price: '700.00', discount_bps: 0,
    })
    expect(getMeteredScheduleQuote('metered_personal', '0.00', '0.00', 'scenario_comparison')).toMatchObject({
      operation: 'scenario_comparison', charge: '300.00', list_price: '300.00', discount_bps: 0,
    })
  })
})
