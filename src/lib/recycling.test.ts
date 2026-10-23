import { describe, expect, it } from 'vitest'
import { calculateProductionSanity } from './production-sanity'
import { recyclingEfficiency, recyclingProduction, recyclingSanity, RECYCLING_SANITY_PER_ITEM } from './recycling'

describe('recycling production valuation', () => {
  it('values the weighted material distribution, including fractional output across shifts', () => {
    const perItem = recyclingProduction(48, 100)
    expect(Object.values(perItem).reduce((sum, count) => sum + count, 0)).toBeCloseTo(1)
    expect(perItem['30024']).toBeCloseTo(0.0004)
    expect(perItem['30012']).toBeCloseTo(0.0717)
    expect(recyclingSanity(perItem)).toBeCloseTo(23.202634988820815)
    const shifts = [8, 8, 8].map((hours) => recyclingProduction(hours, 120))
    expect(shifts.reduce((sum, output) => sum + recyclingSanity(output), 0)).toBeCloseTo(RECYCLING_SANITY_PER_ITEM * 0.6)
  })

  it('includes automatic empty-room output and only the unlocked Homebound skill', () => {
    const baseline = recyclingSanity(recyclingProduction(24, recyclingEfficiency(3, [])))
    const elite0 = recyclingSanity(recyclingProduction(24, recyclingEfficiency(3, [{ id: 'char_4232_hbound', elite: 0 }])))
    const elite2 = recyclingSanity(recyclingProduction(24, recyclingEfficiency(3, [{ id: 'char_4232_hbound', elite: 2 }])))
    expect(baseline).toBeCloseTo(13.92158099329249)
    expect(elite0 - baseline).toBeCloseTo(RECYCLING_SANITY_PER_ITEM * 0.105)
    expect(elite2 - baseline).toBeCloseTo(RECYCLING_SANITY_PER_ITEM * 0.155)
    expect(calculateProductionSanity({ recycling: recyclingProduction(24, 120), trading: { LMD: 1000 } }).value)
      .toBeCloseTo(baseline + 3.6)
  })
})
