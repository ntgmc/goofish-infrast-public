import {
  SANITY_PER_BATTLE_RECORD,
  SANITY_PER_LMD,
  SANITY_PER_ORIGINIUM_SHARD,
  SANITY_PER_ORUNDUM,
  SANITY_PER_PURE_GOLD,
} from './orundum-economy'
import type { DailyProduction } from './types'
import { copy, CURRENT_LOCALE } from '../copy/index'


export type ProductionSanitySummary = {
  value: number;
  note: string;
}

export function calculateProductionSanity(daily: Partial<DailyProduction> | null | undefined): ProductionSanitySummary {
  const manufacturing = daily?.manufacturing ?? {}
  const trading = daily?.trading ?? {}
  const consumption = daily?.consumption ?? {}

  const manufacturingSanity =
    getResourceAmount(manufacturing, 'Pure Gold') * SANITY_PER_PURE_GOLD +
    getResourceAmount(manufacturing, 'Battle Record') * SANITY_PER_BATTLE_RECORD +
    getResourceAmount(manufacturing, 'Originium Shard') * SANITY_PER_ORIGINIUM_SHARD
  const tradingSanity =
    getResourceAmount(trading, 'LMD') * SANITY_PER_LMD +
    getResourceAmount(trading, 'Orundum') * SANITY_PER_ORUNDUM
  const consumptionSanity =
    getResourceAmount(consumption, 'Pure Gold') * SANITY_PER_PURE_GOLD +
    getResourceAmount(consumption, 'Originium Shard') * SANITY_PER_ORIGINIUM_SHARD
  const value = manufacturingSanity + tradingSanity - consumptionSanity

  return {
    value,
    note: `${copy.domain.lib_production_sanity_001}${formatSanityAmount(manufacturingSanity)}${copy.domain.lib_production_sanity_002}${formatSanityAmount(tradingSanity)}${copy.domain.lib_production_sanity_003}${formatSanityAmount(consumptionSanity)}`,
  }
}

function getResourceAmount(values: Record<string, number>, key: string): number {
  const value = values[key] ?? 0
  return Number.isFinite(value) ? value : 0
}

function formatSanityAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString(CURRENT_LOCALE)
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}
