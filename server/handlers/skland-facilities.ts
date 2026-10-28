import { z } from 'zod'
import { FACILITY_IDS, SKLAND_PRODUCTION_SLOTS as PRODUCTION_SLOTS, facilityRoomsSchema, sklandFacilityConfigSchema } from '../../src/lib/facility-layout'
import { CONFIG_PRESETS, normalizeConfig, validateConfig } from '../../src/lib/config'
import { copy } from '../../src/copy'

const stationSchema = z.object({ slotId: z.enum(PRODUCTION_SLOTS as [string, ...string[]]), level: z.number().int().min(1).max(3),
  strategy: z.string().optional(), formulaId: z.union([z.string(), z.number()]).optional() })
const buildingSchema = z.object({
  data: z.object({
    building: z.object({
      tradings: z.array(stationSchema),
      manufactures: z.array(stationSchema),
      powers: z.array(stationSchema),
    }),
  }),
})

export function readSklandFacilityRooms(value: unknown) {
  const { data: { building } } = buildingSchema.parse(value)
  const rooms = [
    ...building.tradings.map((room) => ({ ...room, type: 'trading' as const })),
    ...building.manufactures.map((room) => ({ ...room, type: 'manufacture' as const })),
    ...building.powers.map((room) => ({ ...room, type: 'power' as const })),
  ]
  if (rooms.length !== 9 || new Set(rooms.map((room) => room.slotId)).size !== 9) {
    throw new Error('Incomplete facility layout')
  }
  return facilityRoomsSchema.parse(PRODUCTION_SLOTS.map((slot) => rooms.find((room) => room.slotId === slot)))
}

export function readSklandFacilityConfig(value: unknown) {
  readSklandFacilityRooms(value)
  const { data: { building } } = buildingSchema.parse(value)
  const matchesLevels = (actual: z.infer<typeof stationSchema>[], expected: number[]) => actual.map((room) => room.level).sort().join() === [...expected].sort().join()
  const preset = Object.values(CONFIG_PRESETS).find((candidate) => candidate.trading_stations_count === building.tradings.length
    && candidate.manufacturing_stations_count === building.manufactures.length
    && building.powers.every((room) => room.level === 3)
    && matchesLevels(building.tradings, candidate.trading_station_levels ?? Array(candidate.trading_stations_count).fill(3))
    && matchesLevels(building.manufactures, candidate.manufacturing_station_levels ?? Array(candidate.manufacturing_stations_count).fill(3)))
  if (!preset) throw new Error(copy.skland.configUnsupported)
  const products = { trading_stations: {} as Record<string, number>, manufacturing_stations: {} as Record<string, number> }
  for (const station of building.tradings) {
    const product = station.strategy === 'O_GOLD' ? 'LMD' : station.strategy === 'O_DIAMOND' ? 'Orundum' : null
    if (!product) throw new Error(copy.skland.configUnknownProduct)
    products.trading_stations[product] = (products.trading_stations[product] ?? 0) + 1
  }
  for (const station of building.manufactures) {
    const id = String(station.formulaId ?? '')
    const product = ['1', '2', '3'].includes(id) ? 'Battle Record' : id === '4' ? 'Pure Gold' : ['13', '14'].includes(id) ? 'Originium Shard' : null
    if (!product) throw new Error(copy.skland.configUnknownProduct)
    products.manufacturing_stations[product] = (products.manufacturing_stations[product] ?? 0) + 1
  }
  let layout: string[] | undefined
  if (preset.layout === '2-5-2') {
    const available = [...FACILITY_IDS]
    const entries = [
      ...building.tradings.map((room) => ({ ...room, type: 'trading' })),
      ...building.manufactures.map((room) => ({ ...room, type: 'manufacture' })),
      ...building.powers.map((room) => ({ ...room, type: 'power' })),
    ]
    layout = PRODUCTION_SLOTS.map((slot) => {
      const room = entries.find((entry) => entry.slotId === slot)!
      const index = available.findIndex((id) => {
        const [type, number] = id.split('_')
        const levels = type === 'trading' ? preset.trading_station_levels : preset.manufacturing_station_levels
        return type === room.type && (type === 'power' ? 3 : levels![Number(number) - 1]) === room.level
      })
      return available.splice(index, 1)[0]
    })
  }
  const config = sklandFacilityConfigSchema.parse({ layout: preset.layout, desc: copy.skland.importedConfig,
    trading_stations_count: preset.trading_stations_count, manufacturing_stations_count: preset.manufacturing_stations_count,
    ...(preset.trading_station_levels && { trading_station_levels: [...preset.trading_station_levels] }),
    ...(preset.manufacturing_station_levels && { manufacturing_station_levels: [...preset.manufacturing_station_levels] }),
    ...(layout && { facility_layout: layout }), product_requirements: products })
  const validation = validateConfig(normalizeConfig(config))
  if (!validation.ok) throw new Error(validation.message)
  return config
}
