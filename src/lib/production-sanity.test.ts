import { describe, expect, it } from 'vitest'
import { calculateProductionSanity } from './production-sanity'
import { SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY } from './orundum-economy'

describe('production sanity resource accounting', () => {
  it('deducts the returned LMD consumption once while internal shards cancel out', () => {
    const result = calculateProductionSanity({
      manufacturing: { 'Originium Shard': 100 }, trading: { LMD: 50000, Orundum: 1000 },
      consumption: { 'Originium Shard': 100, LMD: 160000 }, net: { LMD: -110000 },
    })
    expect(result.value).toBeCloseTo(354, 10)
    expect(result.note).toContain('消耗')
  })

  it('uses the producer ledger rather than inferring LMD cost from shard quantity', () => {
    const daily = { manufacturing: { 'Originium Shard': 1 }, consumption: { LMD: 2000 } }
    expect(calculateProductionSanity(daily).value).toBeCloseTo(SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY - 7.2, 10)
  })

  it('does not charge shard acquisition again when trading existing inventory', () => {
    expect(calculateProductionSanity({ trading: { Orundum: 20 }, consumption: { 'Originium Shard': 2 } }).value)
      .toBeCloseTo(15 - 2 * SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY, 10)
  })

  it('supports signed consumption deltas for result comparisons', () => {
    expect(calculateProductionSanity({ consumption: { LMD: -1600 } }).value).toBeCloseTo(5.76, 10)
  })

  it('keeps ordinary production and missing consumption unchanged', () => {
    expect(calculateProductionSanity({ trading: { LMD: 10000 } }).value).toBe(36)
    expect(calculateProductionSanity(undefined).value).toBe(0)
    expect(calculateProductionSanity({ consumption: { LMD: Number.NaN } }).value).toBe(0)
  })
})
