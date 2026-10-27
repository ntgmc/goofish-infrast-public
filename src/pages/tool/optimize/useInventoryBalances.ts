import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { copy } from '../../../copy/index'
import { useInventoryQuery } from '../../../lib/inventory-query'
import type { InventoryResponse, ProfileCapacitySummary, SystemItemCode } from '../../../lib/inventory-contracts'

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

  const balances = useMemo(() => {
    const result = {} as Partial<Record<SystemItemCode, number>>
    for (const stack of inventory.stacks) {
      const code = stack.item.code as SystemItemCode
      result[code] = (result[code] ?? 0) + stack.quantity
    }
    return result
  }, [inventory.stacks])

  const capacity: ProfileCapacitySummary | null = useMemo(
    () => inventory.capacities.find((entry) => entry.profile_id === profileId) ?? null,
    [inventory.capacities, profileId],
  )
  return { balances, capacity, loaded, loading, error, refresh }
}
