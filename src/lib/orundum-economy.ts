import type { DailyProduction, LicenseConfig, OrundumEconomy, OrundumRoi } from './types'

export const BASE_DAILY_SANITY_BUDGET = 240
export const MONTHLY_CARD_DAILY_SANITY_BONUS = 80
export const SANITY_PER_LMD = 36 / 10000
export const SANITY_PER_EXP = 36 / 10000
export const SANITY_PER_BATTLE_RECORD = SANITY_PER_EXP * 1000
export const SANITY_PER_PURE_GOLD = SANITY_PER_EXP * (145 / 229) * (50 / 3) * 24
export const SANITY_PER_ORUNDUM = 3 / 4
export const ORIROCK_CUBE_SANITY = 4.8

export const SHARD_LMD_COST = 1600
export const ORIROCK_CUBES_PER_SHARD = 2
export const SHARD_CRAFT_SECONDS = 60 * 60
export const PURE_GOLD_CRAFT_SECONDS = 72 * 60
export const ORUNDUM_PER_ORDER = 20
export const SHARDS_PER_ORUNDUM_ORDER = 2
export const LMD_PER_ORUNDUM_ORDER = SHARDS_PER_ORUNDUM_ORDER * SHARD_LMD_COST
export const ORUNDUM_PER_ORIROCK_CUBE = ORUNDUM_PER_ORDER / (SHARDS_PER_ORUNDUM_ORDER * ORIROCK_CUBES_PER_SHARD)
export const ORUNDUM_PER_SHARD = ORUNDUM_PER_ORDER / SHARDS_PER_ORUNDUM_ORDER

export const SHARD_FACTORY_TIME_SANITY = SANITY_PER_PURE_GOLD * (SHARD_CRAFT_SECONDS / PURE_GOLD_CRAFT_SECONDS)
export const SANITY_PER_ORIGINIUM_SHARD =
  ORIROCK_CUBES_PER_SHARD * ORIROCK_CUBE_SANITY +
  SHARD_LMD_COST * SANITY_PER_LMD +
  SHARD_FACTORY_TIME_SANITY

const EPSILON = 0.0001

export function normalizeOrundumPlanning(config: Pick<LicenseConfig, 'orundum_planning'> | null | undefined): {
  daily_sanity_budget: number;
  monthly_card: boolean;
  total_daily_sanity_budget: number;
} {
  const rawBudget = Number(config?.orundum_planning?.daily_sanity_budget)
  const dailyBudget = Number.isFinite(rawBudget) && rawBudget >= 0 ? rawBudget : BASE_DAILY_SANITY_BUDGET
  const monthlyCard = config?.orundum_planning?.monthly_card === true
  return {
    daily_sanity_budget: round(dailyBudget, 2),
    monthly_card: monthlyCard,
    total_daily_sanity_budget: round(dailyBudget + (monthlyCard ? MONTHLY_CARD_DAILY_SANITY_BONUS : 0), 2),
  }
}

export function calculateOrundumEconomy(
  daily: Partial<DailyProduction> | null | undefined,
  config: Partial<LicenseConfig> | null | undefined,
): OrundumEconomy | null {
  const potentialShortTermOrundum = amount(daily?.trading, 'Orundum')
  if (potentialShortTermOrundum <= EPSILON) return null

  const planning = normalizeOrundumPlanning(config)
  const dailyOrirockSupply = planning.total_daily_sanity_budget / ORIROCK_CUBE_SANITY
  const rockLimitedOrundum = dailyOrirockSupply * ORUNDUM_PER_ORIROCK_CUBE
  const shardProduced = amount(daily?.manufacturing, 'Originium Shard')
  const shardConsumed = amount(daily?.consumption, 'Originium Shard')
  const shardNet = amount(daily?.net, 'Originium Shard') || shardProduced - shardConsumed
  const factoryOrundumCapacity = shardProduced * ORUNDUM_PER_SHARD
  const tradeOrundumCapacity = potentialShortTermOrundum
  const sustainableOrundum = Math.max(
    0,
    Math.min(rockLimitedOrundum, factoryOrundumCapacity, tradeOrundumCapacity),
  )
  const shardInventory = Math.max(0, Number(config?.intermediate_inventory?.['Originium Shard'] ?? 0))
  const orirockInventory = Math.max(0, Number(config?.intermediate_inventory?.['Orirock Cube'] ?? 0))
  const shardDeficit = Math.max(0, -shardNet)
  const orirockDeficit = Math.max(0, shardProduced * ORIROCK_CUBES_PER_SHARD - dailyOrirockSupply)
  const hasBurstInventory =
    (shardDeficit <= EPSILON || shardInventory > EPSILON) &&
    (orirockDeficit <= EPSILON || orirockInventory > EPSILON)
  const shortTermOrundum = hasBurstInventory ? potentialShortTermOrundum : sustainableOrundum
  const shardInventoryDepletionDays = shardDeficit > EPSILON ? shardInventory / shardDeficit : null
  const orirockInventoryDepletionDays = orirockDeficit > EPSILON ? orirockInventory / orirockDeficit : null
  const inventoryDepletionDays = earliestDepletionDays(
    shardInventoryDepletionDays,
    orirockInventoryDepletionDays,
  )
  const bottleneck = findBottleneck({
    orirock_budget: rockLimitedOrundum,
    manufacture: factoryOrundumCapacity,
    trading: tradeOrundumCapacity,
  })
  const scenario =
    inventoryDepletionDays !== null && inventoryDepletionDays > EPSILON && shortTermOrundum > sustainableOrundum + EPSILON
      ? 'inventory_burst'
      : sustainableOrundum + EPSILON < rockLimitedOrundum
        ? 'capacity_limited'
        : 'budget_limited'

  const hardLmdCost = (sustainableOrundum / ORUNDUM_PER_ORDER) * LMD_PER_ORUNDUM_ORDER
  const shardCostSanity = (sustainableOrundum / ORUNDUM_PER_SHARD) * SANITY_PER_ORIGINIUM_SHARD
  const orundumValueSanity = sustainableOrundum * SANITY_PER_ORUNDUM
  const opportunityCostSanity = Math.max(0, shardCostSanity - orundumValueSanity)

  return {
    daily_sanity_budget: planning.daily_sanity_budget,
    monthly_card: planning.monthly_card,
    total_daily_sanity_budget: planning.total_daily_sanity_budget,
    daily_orirock_supply: round(dailyOrirockSupply, 4),
    rock_limited_orundum: round(rockLimitedOrundum, 4),
    factory_orundum_capacity: round(factoryOrundumCapacity, 4),
    trade_orundum_capacity: round(tradeOrundumCapacity, 4),
    sustainable_orundum: round(sustainableOrundum, 4),
    short_term_orundum: round(shortTermOrundum, 4),
    case: scenario,
    bottleneck: scenario === 'inventory_burst' ? 'inventory' : bottleneck,
    hard_lmd_cost: round(hardLmdCost, 4),
    inventory_depletion_days: inventoryDepletionDays === null ? null : round(inventoryDepletionDays, 2),
    shard_inventory_depletion_days:
      shardInventoryDepletionDays === null ? null : round(shardInventoryDepletionDays, 2),
    orirock_inventory_depletion_days:
      orirockInventoryDepletionDays === null ? null : round(orirockInventoryDepletionDays, 2),
    opportunity_cost_sanity: round(opportunityCostSanity, 4),
    opportunity_lmd_equivalent: round(opportunityCostSanity / SANITY_PER_LMD, 4),
  }
}

export function compareOrundumEconomy(
  current: OrundumEconomy | null | undefined,
  baseline: OrundumEconomy | null | undefined,
): OrundumRoi | undefined {
  if (!current || !baseline) return undefined
  const dailyOrundumGain =
    current.case === 'budget_limited'
      ? current.sustainable_orundum - baseline.sustainable_orundum
      : current.short_term_orundum - baseline.short_term_orundum
  const sustainableOrundumGain = current.sustainable_orundum - baseline.sustainable_orundum
  const opportunityCostDelta = baseline.opportunity_cost_sanity - current.opportunity_cost_sanity
  const opportunityLmdDelta = baseline.opportunity_lmd_equivalent - current.opportunity_lmd_equivalent
  const inventoryDaysDelta =
    current.inventory_depletion_days !== null && baseline.inventory_depletion_days !== null
      ? current.inventory_depletion_days - baseline.inventory_depletion_days
      : null
  return {
    case: current.case,
    daily_orundum_gain: round(dailyOrundumGain, 4),
    sustainable_orundum_gain: round(sustainableOrundumGain, 4),
    monthly_pulls_gain: round((dailyOrundumGain * 30) / 600, 4),
    opportunity_cost_delta: round(opportunityCostDelta, 4),
    opportunity_lmd_equivalent_delta: round(opportunityLmdDelta, 4),
    inventory_depletion_days_delta: inventoryDaysDelta === null ? null : round(inventoryDaysDelta, 2),
  }
}

function earliestDepletionDays(...values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return finiteValues.length > 0 ? Math.min(...finiteValues) : null
}

function findBottleneck(values: Record<'orirock_budget' | 'manufacture' | 'trading', number>): OrundumEconomy['bottleneck'] {
  return (Object.entries(values).sort((left, right) => left[1] - right[1])[0]?.[0] ?? 'orirock_budget') as OrundumEconomy['bottleneck']
}

function amount(values: Record<string, number> | undefined, key: string): number {
  const value = Number(values?.[key] ?? 0)
  return Number.isFinite(value) ? value : 0
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
