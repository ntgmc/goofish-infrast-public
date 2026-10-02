import { useCallback, useMemo, useRef, useState } from 'react'
import { copy } from '../../../copy/index'
import { apiJson } from '../../../lib/api-client'
import type { InventoryResponse, ProfileCapacitySummary, SystemItemCode } from '../../../lib/inventory-contracts'
import { useInventoryRefresh } from '../../../lib/inventory-refresh'

const EMPTY_INVENTORY: InventoryResponse = {
  stacks: [],
  capacities: [],
  recent_events: [],
}

export function useInventoryBalances(profileId: string) {
  const [inventory, setInventory] = useState<InventoryResponse>(EMPTY_INVENTORY)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++loadVersion.current
    setLoading(true)
    setError(null)
    try {
      const next = await apiJson<InventoryResponse>('/api/user/inventory', { cache: 'no-store' })
      if (version !== loadVersion.current) return
      setInventory(next)
      setLoaded(true)
    } catch (caught) {
      if (version === loadVersion.current) setError(caught instanceof Error ? caught.message : copy.inventory.balances_load_failed)
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [])

  useInventoryRefresh(refresh, profileId)

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
