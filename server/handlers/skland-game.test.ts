import { describe, expect, it } from 'vitest'
import { readSklandGame, readSklandItemNames } from './skland-game'

const game = () => ({ data: {
  currentTs: 1_700_000_000, privateField: 'must not leave server',
  status: { name: '博士', level: 120, ap: { current: 130, max: 135 }, storeTs: 1_699_999_900 },
  charInfoMap: { char_test: { name: '阿米娅', secret: 'not public' } },
  recruit: [{ state: 2, finishTs: 1_700_000_100 }], routine: { daily: { current: 50, total: 100 } },
  building: { labor: { value: 100, maxValue: 200 }, tiredCharsCount: 1,
    tradings: [{ slotId: 'slot_24', level: 3, chars: [{ charId: 'char_test', ap: 43_200_000 }], strategy: 'O_GOLD', stock: [{}, {}], stockLimit: 10 }],
    manufactures: [{ slotId: 'slot_25', level: 3, formulaId: '4', complete: 5, capacity: 64 }],
  },
} })

describe('public Skland game projection', () => {
  it('returns supported overview and building fields without exposing the raw response', () => {
    const result = readSklandGame(game())!
    expect(result.player).toMatchObject({ name: '博士', level: 120, sanity: { current: 130, max: 135 }, skins: null })
    expect(result.routine).toEqual({ daily: { current: 50, total: 100 }, weekly: null })
    expect(result.building?.rooms).toMatchObject([
      { id: 'slot_24', product: '龙门币', stock: 2, capacity: 10, operators: [{ name: '阿米娅', morale: 12 }] },
      { id: 'slot_25', product: '赤金', stock: 5, capacity: 32 },
    ])
    expect(JSON.stringify(result)).not.toContain('privateField')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('keeps missing and unknown data unavailable, preserving valid zero counts', () => {
    const value = game()
    value.data.building.labor.value = 0
    value.data.building.manufactures[0].formulaId = '999'
    const result = readSklandGame(value)!
    expect(result.building?.drones?.current).toBe(0)
    expect(result.building?.rooms[1]).toMatchObject({ stock: 5, capacity: null, product: null })
    expect(result.building?.clues).toBeNull()
    expect(result.player.lastOnline).toBeNull()
    expect(readSklandGame({ data: { status: { name: '博士' } } })?.building).toBeNull()
    expect(readSklandGame({ data: {} })).toBeNull()
    expect(readSklandGame({ data: { building: { meeting: { slotId: 'meeting', level: 3, clue: {} } } } })?.building?.clues)
      .toMatchObject({ owned: null, received: null, board: null, sharing: null })
    expect(readSklandGame({ data: { building: { labor: { value: -1, maxValue: 200 } } } })).toBeNull()
  })
  it('reads public item definitions from keyed or array catalogs', () => {
    expect(readSklandItemNames({ items: { '4001': { name: '龙门币', credentials: 'ignored' }, bad: null } })).toEqual({ '4001': '龙门币' })
    expect(readSklandItemNames({ items: [{ itemId: '3003', itemName: '赤金' }] })).toEqual({ '3003': '赤金' })
    expect(readSklandItemNames(null)).toEqual({})
  })
})
