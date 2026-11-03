import { z } from 'zod'
import { copy } from '../copy'
import type { LicenseConfig } from './types'

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

export function getFacilityIds(config: Pick<LicenseConfig, 'trading_stations_count' | 'manufacturing_stations_count'>): string[] {
  return [
    ...Array.from({ length: config.trading_stations_count }, (_, index) => `trading_${index + 1}`),
    ...Array.from({ length: config.manufacturing_stations_count }, (_, index) => `manufacture_${index + 1}`),
    ...Array.from({ length: Math.max(0, 9 - config.trading_stations_count - config.manufacturing_stations_count) }, (_, index) => `power_${index + 1}`),
  ]
}

export const facilityLayoutSchema = z.array(z.string().regex(/^(?:(?:trading|manufacture)_[1-5]|power_[1-3])$/)).length(9).refine(
  (layout) => new Set(layout).size === 9 && ['trading', 'manufacture', 'power'].every((type) => {
    const count = layout.filter((id) => id.startsWith(`${type}_`)).length
    return count > 0 && Array.from({ length: count }, (_, index) => `${type}_${index + 1}`).every((id) => layout.includes(id))
  }),
  copy.common.facilityLayoutUnique,
)

export function hasConfirmedFacilityLayout(config: Pick<LicenseConfig, 'trading_stations_count' | 'manufacturing_stations_count' | 'facility_layout'>): boolean {
  const parsed = facilityLayoutSchema.safeParse(config.facility_layout)
  return parsed.success && getFacilityIds(config).every((id) => parsed.data.includes(id))
}

export const sklandFacilityConfigSchema = z.object({
  layout: z.string(), desc: z.string(), trading_stations_count: z.number().int().min(1).max(5),
  manufacturing_stations_count: z.number().int().min(1).max(5),
  trading_station_levels: z.array(z.number().int().min(1).max(3)).optional(),
  manufacturing_station_levels: z.array(z.number().int().min(1).max(3)).optional(),
  facility_layout: facilityLayoutSchema.optional(),
  intermediate_inventory: z.object({
    'Originium Shard': z.number().int().min(0).max(1e12), 'Pure Gold': z.number().int().min(0).max(1e12),
    'Orirock Cube': z.number().int().min(0).max(1e12), LMD: z.number().int().min(0).max(1e12),
  }).optional(),
  product_requirements: z.object({ trading_stations: z.record(z.string(), z.number().int().nonnegative()),
    manufacturing_stations: z.record(z.string(), z.number().int().nonnegative()) }),
})
