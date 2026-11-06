import { SANITY_PER_LMD } from './orundum-economy'

// Sources, snapshot and assumptions: docs/production-income.md.
export const SANITY_PER_CLUE = 20 * (3600 / 200) * SANITY_PER_LMD
const commonRecruitTags = 583_432_963
const rareRecruitTags = 106_211_609
const allRecruitTags = commonRecruitTags + rareRecruitTags + 3_814_694 + 1_486_990
export const SANITY_PER_RECRUITMENT_REFRESH = ((commonRecruitTags * 10 + rareRecruitTags * 30) / allRecruitTags - 10) * 0.8

export const SUPPORT_ROOM_PRODUCTS = {
  meeting: { product: 'Clue', baseHours: 20, capacity: 10, sanity: SANITY_PER_CLUE },
  hire: { product: 'Recruitment Refresh', baseHours: 12, capacity: 3, sanity: SANITY_PER_RECRUITMENT_REFRESH },
} as const

export function supportRoomProduction(roomType: keyof typeof SUPPORT_ROOM_PRODUCTS, hours: number, efficiency: number, operatorCount: number): number {
  const data = SUPPORT_ROOM_PRODUCTS[roomType]
  // Meeting efficiency already includes the operators' 5% basic bonus.
  const speed = 100 + efficiency + (roomType === 'hire' ? operatorCount * 5 : 0)
  return Math.min(data.capacity, Math.max(0, hours / data.baseHours * speed / 100))
}

export function supportRoomSanity(production: Record<string, number> = {}): number {
  return Object.values(SUPPORT_ROOM_PRODUCTS).reduce((sum, { product, sanity }) => {
    const count = production[product] ?? 0
    return sum + (Number.isFinite(count) ? count : 0) * sanity
  }, 0)
}
