import pool from '../data/recycling.json'
import type { LicenseConfig } from './types'

const totalWeight = pool.items.reduce((sum, item) => sum + item.weight, 0)
// shortcut: value the published normal pool only; include the extra pool once its reset rules are confirmed.
export const RECYCLING_SANITY_PER_ITEM = pool.items.reduce((sum, item) => sum + item.weight * item.sanity, 0) / totalWeight

export function recyclingLevel(config: LicenseConfig): number {
  return config.recycling_station_level ?? 0
}

export function recyclingEfficiency(level: number, operators: { id: string; elite: number }[], ignoreElite = false): number {
  if (level === 0) return 0
  const homebound = operators.find((operator) => operator.id === 'char_4232_hbound')
  return (level === 3 ? 120 : 100) + operators.length + (homebound ? (ignoreElite || homebound.elite >= 2 ? 30 : 20) : 0)
}

export function recyclingProduction(hours: number, efficiency: number): Record<string, number> {
  const count = hours / pool.base_hours * efficiency / 100
  return Object.fromEntries(pool.items.map((item) => [item.id, count * item.weight / totalWeight]))
}

export function recyclingSanity(materials: Record<string, number> = {}): number {
  return pool.items.reduce((sum, item) => {
    const count = materials[item.id] ?? 0
    return sum + (Number.isFinite(count) ? count : 0) * item.sanity
  }, 0)
}
