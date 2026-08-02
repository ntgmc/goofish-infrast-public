import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../../lib/api-client'
import type { InventoryResponse, ProfileCapacitySummary, ProfileReorderQuotaSummary, SystemItemCode } from '../../../lib/inventory-contracts'

const EMPTY_INVENTORY: InventoryResponse = {
  stacks: [],
  capacities: [],
  reorder_quotas: [],
  recent_events: [],
}

export function useInventoryBalances(profileId: string) {
  const [inventory, setInventory] = useState<InventoryResponse>(EMPTY_INVENTORY)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setInventory(await apiJson<InventoryResponse>('/api/user/inventory'))
      setLoaded(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '库存数据加载失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [profileId, refresh])

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
  const reorderQuota: ProfileReorderQuotaSummary | null = useMemo(
    () => inventory.reorder_quotas.find((entry) => entry.profile_id === profileId) ?? null,
    [inventory.reorder_quotas, profileId],
  )

  return { balances, capacity, reorderQuota, loaded, loading, error, refresh }
}
