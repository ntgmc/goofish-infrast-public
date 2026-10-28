import { describe, expect, it } from 'vitest'
import { readSklandFacilityConfig, readSklandFacilityRooms } from './skland-facilities'
import { normalizeConfig, validateScheduleConfig } from '../../src/lib/config'

function playerInfo() {
  return { data: { building: {
    tradings: [{ slotId: 'slot_25', level: 1, strategy: 'O_GOLD' }, { slotId: 'slot_24', level: 3, strategy: 'O_DIAMOND' }],
    manufactures: [
      { slotId: 'slot_5', level: 2, formulaId: '4' }, { slotId: 'slot_16', level: 3, formulaId: '3' },
      { slotId: 'slot_26', level: 2, formulaId: '4' }, { slotId: 'slot_14', level: 2, formulaId: '13' }, { slotId: 'slot_15', level: 3, formulaId: '14' },
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
  it('imports counts, canonical levels, map positions and actual production together', () => {
    const config = readSklandFacilityConfig(playerInfo())
    expect(config).toMatchObject({ layout: '2-5-2', trading_stations_count: 2, manufacturing_stations_count: 5,
      trading_station_levels: [3, 1], manufacturing_station_levels: [2, 2, 3, 3, 2],
      product_requirements: { trading_stations: { LMD: 1, Orundum: 1 }, manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 1, 'Originium Shard': 2 } } })
    expect(config.facility_layout).toEqual(['trading_1', 'trading_2', 'manufacture_1', 'manufacture_2', 'manufacture_3', 'manufacture_4', 'manufacture_5', 'power_1', 'power_2'])
    expect(validateScheduleConfig(normalizeConfig(config))).toEqual({ ok: true })
  })
  it('rejects unsupported layouts and products instead of guessing a usable configuration', () => {
    const unsupported = playerInfo()
    unsupported.data.building.tradings[0].level = 2
    unsupported.data.building.manufactures[0].level = 1
    expect(() => readSklandFacilityConfig(unsupported)).toThrow('暂不支持')
    for (const id of ['5', '0', '999', '']) {
      const unknown = playerInfo()
      unknown.data.building.manufactures[0].formulaId = id
      expect(() => readSklandFacilityConfig(unknown)).toThrow('生产类型')
      expect(readSklandFacilityRooms(unknown)).toHaveLength(9)
    }
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
