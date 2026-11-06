import { describe, expect, it } from 'vitest'
import { calculateProductionSanity } from './production-sanity'
import { SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY } from './orundum-economy'
import { supportRoomProduction } from './support-room-economy'

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

  it('values collected clues and incremental recruitment rewards without adding them to LMD', () => {
    const result = calculateProductionSanity({ support: { Clue: 2, 'Recruitment Refresh': 3 }, trading: { LMD: 10000 } })
    expect(result.value).toBeCloseTo(36 + 2 * 1.296 + 3 * 2.384317143511598, 10)
    expect(result.note).toContain('会客室与办公室')
    expect(calculateProductionSanity({ support: { Clue: NaN, unknown: 10000 } }).value).toBe(0)
    expect(calculateProductionSanity({ support: { Clue: -1 } }).value).toBeCloseTo(-1.296, 10)
  })

  it('integrates room speed and limits unattended production to storage capacity', () => {
    expect(supportRoomProduction('meeting', 20, 50, 2)).toBe(1.5)
    expect(supportRoomProduction('hire', 12, 40, 1)).toBe(1.45)
    expect(supportRoomProduction('meeting', 240, 50, 2)).toBe(10)
    expect(supportRoomProduction('hire', 48, 40, 1)).toBe(3)
    expect(supportRoomProduction('hire', 8, -200, 1)).toBe(0)
    expect(supportRoomProduction('meeting', 8, 0, 0)).toBe(0.4)
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
