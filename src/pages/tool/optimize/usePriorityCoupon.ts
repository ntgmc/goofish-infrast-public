import { useCallback, useEffect, useState } from 'react'
import { copy } from '../../../copy/index'
import { apiJson } from '../../../lib/api-client'
import type { PriorityCouponBalance } from '../../../lib/types'

export function usePriorityCoupon(profileId: string) {
  const [balance, setBalance] = useState<PriorityCouponBalance | null>(null)
  const [selected, setSelected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<{ balances?: PriorityCouponBalance[] }>('/api/user/priority-coupon-balance')
      const next = data.balances?.find((item) => item.type === 'priority_compute_coupon') ?? null
      setBalance(next)
      if (!next?.available) setSelected(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.inventory.priority_coupon_balance_load_failed)
      setSelected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [profileId, refresh])

  return { balance, selected, setSelected, loading, error, refresh }
}
