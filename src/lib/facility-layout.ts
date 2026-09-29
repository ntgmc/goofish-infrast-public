import { z } from 'zod'
import { copy } from '../copy'

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
