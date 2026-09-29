import { describe, expect, it } from 'vitest'
import { readSklandFacilityRooms } from './skland-facilities'

function playerInfo() {
  return { data: { building: {
    tradings: [{ slotId: 'slot_25', level: 1 }, { slotId: 'slot_24', level: 3 }],
    manufactures: [
      { slotId: 'slot_5', level: 2 }, { slotId: 'slot_16', level: 3 },
      { slotId: 'slot_26', level: 2 }, { slotId: 'slot_14', level: 2 }, { slotId: 'slot_15', level: 3 },
    ],
    powers: [{ slotId: 'slot_7', level: 3 }, { slotId: 'slot_6', level: 3 }],
  } } }
}

describe('Skland facility positions', () => {
  it('orders all nine rooms by game position instead of API array order', () => {
    expect(readSklandFacilityRooms(playerInfo())).toEqual([
      { type: 'trading', level: 3 }, { type: 'trading', level: 1 }, { type: 'manufacture', level: 2 },
      { type: 'manufacture', level: 2 }, { type: 'manufacture', level: 3 }, { type: 'manufacture', level: 3 },
      { type: 'manufacture', level: 2 }, { type: 'power', level: 3 }, { type: 'power', level: 3 },
    ])
  })
  it('rejects incomplete, duplicate, unknown positions and invalid levels', () => {
    const missing = playerInfo()
    missing.data.building.powers.pop()
    const duplicate = playerInfo()
    duplicate.data.building.powers[0].slotId = 'slot_6'
    const unknown = playerInfo()
    unknown.data.building.powers[0].slotId = 'slot_99'
    const level = playerInfo()
    level.data.building.tradings[0].level = 0
    for (const value of [{}, missing, duplicate, unknown, level]) {
      expect(() => readSklandFacilityRooms(value)).toThrow()
    }
  })
})
