import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../../lib/api-client'
import type { RewardBalance } from '../../../lib/types'

export function usePriorityCoupon(profileId: string) {
  const [balance, setBalance] = useState<RewardBalance | null>(null)
  const [selected, setSelected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<{ balances?: RewardBalance[] }>('/api/user/rewards')
      const next = data.balances?.find((item) => item.type === 'priority_compute_coupon') ?? null
      setBalance(next)
      if (!next?.available) setSelected(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '优先计算券余额加载失败。')
      setSelected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [profileId, refresh])

  return { balance, selected, setSelected, loading, error, refresh }
}
