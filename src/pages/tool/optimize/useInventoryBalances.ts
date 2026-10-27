import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { copy } from '../../../copy/index'
import { useInventoryQuery } from '../../../lib/inventory-query'
import type { InventoryResponse, ProfileCapacitySummary, SystemItemCode } from '../../../lib/inventory-contracts'
import type { PriorityCouponBalance } from '../../../lib/types'

const EMPTY_INVENTORY: InventoryResponse = {
  stacks: [],
  capacities: [],
  recent_events: [],
}

export function useInventoryBalances(userId: string, profileId: string) {
  const queryClient = useQueryClient()
  const { data, isFetching: loading, error: queryError } = useInventoryQuery(userId, profileId)
  const inventory = data ?? EMPTY_INVENTORY
  const loaded = data !== undefined
  const error = queryError ? queryError instanceof Error ? queryError.message : copy.inventory.balances_load_failed : null
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'user' && queryKey[1] === userId && queryKey[3] === 'inventory',
    })
  }, [queryClient, userId])

  const { balances, priorityCouponBalance } = useMemo(() => {
    const balances = {} as Partial<Record<SystemItemCode, number>>
    const priority: PriorityCouponBalance = { type: 'priority_compute_coupon', available: 0, permanent: 0, next_expiry_at: null }
    for (const stack of inventory.stacks) {
      const code = stack.item.code as SystemItemCode
      balances[code] = (balances[code] ?? 0) + stack.quantity
      if (code === priority.type) {
        priority.available += stack.quantity
        priority.permanent += stack.permanent
        if (stack.next_expiry_at && (!priority.next_expiry_at || Date.parse(stack.next_expiry_at) < Date.parse(priority.next_expiry_at))) {
          priority.next_expiry_at = stack.next_expiry_at
        }
      }
    }
    return { balances, priorityCouponBalance: loaded ? priority : null }
  }, [inventory.stacks, loaded])

  const capacity: ProfileCapacitySummary | null = useMemo(
    () => inventory.capacities.find((entry) => entry.profile_id === profileId) ?? null,
    [inventory.capacities, profileId],
  )
  return { balances, priorityCouponBalance, capacity, loaded, loading, error, refresh }
}
