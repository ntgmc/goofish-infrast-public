import { z } from 'zod'
import { facilityRoomsSchema } from '../../src/lib/facility-layout'

// Game slot IDs, B1 to B3, left to right; API arrays are not in map order.
const PRODUCTION_SLOTS = ['slot_24', 'slot_25', 'slot_26', 'slot_14', 'slot_15', 'slot_16', 'slot_5', 'slot_6', 'slot_7']
const stationSchema = z.object({ slotId: z.enum(PRODUCTION_SLOTS as [string, ...string[]]), level: z.number().int().min(1).max(3) })
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
