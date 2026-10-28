import { z } from 'zod'
import { copy } from '../copy'

// Game slot IDs, B1 to B3, left to right; API arrays are not in map order.
export const SKLAND_PRODUCTION_SLOTS: string[] = ['slot_24', 'slot_25', 'slot_26', 'slot_14', 'slot_15', 'slot_16', 'slot_5', 'slot_6', 'slot_7']

export const facilityRoomsSchema = z.array(z.object({
  type: z.enum(['trading', 'manufacture', 'power']),
  level: z.number().int().min(1).max(3),
})).length(9)

// Positions follow the game's overview: left to right, then top to bottom.
export const FACILITY_IDS = [
  'trading_1', 'trading_2', 'manufacture_1',
  'manufacture_2', 'manufacture_3', 'manufacture_4',
  'manufacture_5', 'power_1', 'power_2',
] as const

export const facilityLayoutSchema = z.array(z.enum(FACILITY_IDS)).length(9).refine(
  (layout) => new Set(layout).size === 9,
  copy.common.facilityLayoutUnique,
)

export const sklandFacilityConfigSchema = z.object({
  layout: z.string(), desc: z.string(), trading_stations_count: z.number().int().min(1).max(5),
  manufacturing_stations_count: z.number().int().min(1).max(5),
  trading_station_levels: z.array(z.number().int().min(1).max(3)).optional(),
  manufacturing_station_levels: z.array(z.number().int().min(1).max(3)).optional(),
  facility_layout: facilityLayoutSchema.optional(),
  product_requirements: z.object({ trading_stations: z.record(z.string(), z.number().int().nonnegative()),
    manufacturing_stations: z.record(z.string(), z.number().int().nonnegative()) }),
})
