import { describe, expect, it } from 'vitest'
import { calculateProductionSanity, getProductionSanityLedger } from './production-sanity'
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

  it('caps empty-stock shard trades at factory output without changing the resource ledger', () => {
    const daily = {
      originium_shard_inventory: 0,
      manufacturing: { 'Originium Shard': 60 }, trading: { Orundum: 1000, LMD: 50000 },
      consumption: { 'Originium Shard': 100, LMD: 96000 },
    }
    const original = structuredClone(daily)
    const ledger = getProductionSanityLedger(daily)
    expect(ledger.trading).toEqual({ Orundum: 600, LMD: 50000 })
    expect(ledger.consumption).toEqual({ 'Originium Shard': 60, LMD: 96000 })
    expect(calculateProductionSanity(daily).value).toBeCloseTo(284.4, 10)
    expect(calculateProductionSanity({ ...daily, trading: { Orundum: 2000, LMD: 50000 },
      consumption: { 'Originium Shard': 200, LMD: 96000 } })).toEqual(calculateProductionSanity(daily))
    expect(daily).toEqual(original)
  })

  it('values no shard trades without stock or factory output and preserves stocked trades', () => {
    const daily = { originium_shard_inventory: 0, trading: { Orundum: 20 }, consumption: { 'Originium Shard': 2 } }
    expect(calculateProductionSanity(daily).value).toBe(0)
    expect(calculateProductionSanity({ ...daily, originium_shard_inventory: 1 }).value)
      .toBeCloseTo(15 - 2 * SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY, 10)
    const balanced = { ...daily, manufacturing: { 'Originium Shard': 3 } }
    expect(getProductionSanityLedger(balanced).trading).toBe(balanced.trading)
    expect(calculateProductionSanity(balanced).value).toBeCloseTo(15 + SANITY_PER_ORIGINIUM_SHARD_OPPORTUNITY, 10)
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
