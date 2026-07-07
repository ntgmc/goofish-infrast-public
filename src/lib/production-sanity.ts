import type { DailyProduction } from './types'

const SANITY_PER_LMD = 36 / 10000
const SANITY_PER_EXP = 36 / 10000
const SANITY_PER_BATTLE_RECORD = SANITY_PER_EXP * 1000
const SANITY_PER_PURE_GOLD = SANITY_PER_EXP * (145 / 229) * (50 / 3) * 24
const SANITY_PER_ORUNDUM = 3 / 4
const SANITY_PER_PURCHASE_CERTIFICATE = 30 * (1 - SANITY_PER_LMD * 12) / 21
const SANITY_PER_ORIGINIUM_SHARD = SANITY_PER_PURCHASE_CERTIFICATE * 90

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
    note: `制造 ${formatSanityAmount(manufacturingSanity)} + 贸易 ${formatSanityAmount(tradingSanity)} - 消耗 ${formatSanityAmount(consumptionSanity)}`,
  }
}

function getResourceAmount(values: Record<string, number>, key: string): number {
  const value = values[key] ?? 0
  return Number.isFinite(value) ? value : 0
}

function formatSanityAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('zh-CN')
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}
