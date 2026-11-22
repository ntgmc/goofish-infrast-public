import { createHash } from 'node:crypto'
import { z } from 'zod'
import { calculateProductionSanity, getProductionSanityLedger } from '../src/lib/production-sanity'
import { valueClockVectorSchema, type ValueClockVector } from '../src/lib/value-clock'
import type { WorkspaceResultHistoryExportItem } from '../src/lib/types'

const resourceMap = z.record(z.string(), z.number().finite())
const productionSchema = z.object({
  hours: z.number().finite().positive(), manufacturing: resourceMap, trading: resourceMap, consumption: resourceMap,
  recycling: resourceMap.optional(), support: resourceMap.optional(), originium_shard_inventory: z.number().finite().nonnegative().optional(),
})
export class ValueClockError extends Error {}

export function freezeValueClockProduction(item: WorkspaceResultHistoryExportItem, importedAt: string | null): {
  daily: ValueClockVector; inventory: { snapshot: string; durationMs: number } | null
} {
  const result = item.result
  const parsed = productionSchema.safeParse(result.daily_production)
  const moodValid = !result.mood_simulation || result.mood_simulation.valid && result.mood_simulation.daily_loop_stable
  const plansValid = result.plans?.length && result.plans.every((plan) => plan.mood_valid !== false && (plan.mood_assumptions?.cyclic_mood_simulation_delta ?? 0) === 0 && Object.values(plan.rooms ?? {}).some((rooms) => Array.isArray(rooms) && rooms.length > 0))
  if (!parsed.success || !moodValid || !plansValid) throw new ValueClockError('Saved result lacks usable production data')
  const factor = 24 / parsed.data.hours
  const normalize = (values: Record<string, number> | undefined) => values && Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * factor]))
  const daily = { ...parsed.data, manufacturing: normalize(parsed.data.manufacturing)!, trading: normalize(parsed.data.trading)!, consumption: normalize(parsed.data.consumption)!, recycling: normalize(parsed.data.recycling), support: normalize(parsed.data.support) }
  const { manufacturing, trading, consumption } = getProductionSanityLedger(daily)
  const amount = (map: Record<string, number>, key: string) => map[key] ?? 0
  const received = amount(trading, 'LMD'), spent = amount(consumption, 'LMD')
  const vector = valueClockVectorSchema.safeParse({
    sanity: calculateProductionSanity(daily).value, lmd_received: received, lmd_spent: spent, lmd_net: received - spent,
    experience_points: amount(manufacturing, 'Battle Record') * 1000, orundum: amount(trading, 'Orundum'),
    gold_produced: amount(manufacturing, 'Pure Gold'), gold_consumed: amount(consumption, 'Pure Gold'),
    shards_produced: amount(manufacturing, 'Originium Shard'), shards_consumed: amount(consumption, 'Originium Shard'),
  })
  if (!vector.success) throw new ValueClockError('Saved result contains invalid production values')
  const depletion: number[] = []
  for (const resource of ['Pure Gold', 'Originium Shard'] as const) {
    const deficit = amount(consumption, resource) - amount(manufacturing, resource)
    if (deficit <= 0) continue
    const stock = resource === 'Originium Shard' ? daily.originium_shard_inventory : item.config?.intermediate_inventory?.[resource]
    if (stock === undefined || !Number.isFinite(stock) || stock <= 0) throw new ValueClockError('Saved result lacks supporting inventory')
    depletion.push(stock / deficit)
  }
  for (const entry of result.intermediate_depletion ?? []) {
    if (entry.net_per_day >= 0) continue
    if (!Number.isFinite(entry.stock) || entry.stock < 0) throw new ValueClockError('Saved result lacks inventory duration')
    depletion.push(entry.stock / -entry.net_per_day)
  }
  const economy = result.orundum_economy
  if (economy?.case === 'inventory_burst') {
    if (economy.inventory_depletion_days === null || !Number.isFinite(economy.inventory_depletion_days)) throw new ValueClockError('Saved result lacks inventory duration')
    // The existing economy rounds to two decimals; use its lower bound.
    depletion.push(Math.max(0, economy.inventory_depletion_days - 0.005))
  }
  if (spent > received) {
    const stock = item.config?.intermediate_inventory?.LMD
    if (stock === undefined || !Number.isFinite(stock) || stock <= 0) throw new ValueClockError('Saved result lacks LMD inventory')
    depletion.push(stock / (spent - received))
  }
  if (amount(trading, 'Orundum') > 0 && !economy) throw new ValueClockError('Saved result lacks orundum supply analysis')
  const inventoryValues = { ...item.config?.intermediate_inventory, 'Originium Shard': item.config?.intermediate_inventory?.['Originium Shard'] ?? daily.originium_shard_inventory ?? null }
  const inventory = depletion.length ? {
    snapshot: createHash('sha256').update(JSON.stringify([importedAt, Object.entries(inventoryValues).sort()])).digest('hex'),
    durationMs: Math.min(...depletion) * 86_400_000,
  } : null
  return { daily: vector.data, inventory }
}
