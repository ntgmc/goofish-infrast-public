import type { IntermediateDepletion, OptimizeResult } from './types'

const LOW_INVENTORY_DAYS = 7

export function inventoryDepletionWarnings(
  depletion: IntermediateDepletion[] | undefined,
): NonNullable<OptimizeResult['inventory_warnings']> {
  return (depletion ?? []).flatMap((item) => {
    const days = item.days_remaining
    if (!(item.net_per_day < 0) || days === null || !Number.isFinite(days) || days > LOW_INVENTORY_DAYS) return []
    return [{ product: item.product, days_remaining: Math.max(0, days) }]
  })
}
