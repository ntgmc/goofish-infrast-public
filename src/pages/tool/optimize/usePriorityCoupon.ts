import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../../lib/api-client'
import type { RewardBalance } from '../../../lib/types'

export function usePriorityCoupon(profileId: string) {
  const [balance, setBalance] = useState<RewardBalance | null>(null)
  const [selected, setSelected] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await apiJson<{ balances?: RewardBalance[] }>('/api/user/rewards')
      const next = data.balances?.find((item) => item.type === 'priority_compute_coupon') ?? null
      setBalance(next)
      if (!next?.available) setSelected(false)
    } catch {
      setBalance(null)
      setSelected(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [profileId, refresh])

  return { balance, selected, setSelected, refresh }
}
