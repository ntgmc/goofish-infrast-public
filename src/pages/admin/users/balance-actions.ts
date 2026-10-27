import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminBalanceTransaction, BalancePage } from '../../../lib/balance-contracts'
import { adminApiJson as apiJson } from '../../../lib/admin-api-client'
import type { AdminCapability } from '../contracts'
import { METERED_BILLING_AVAILABLE } from '../../../lib/site-features'

export function useAdminUserBalance(options: {
  username: string | null; capabilities: AdminCapability[]; userId: string | null; active: boolean
  setBusyAction: Dispatch<SetStateAction<string | null>>
  setError: (error: string | null) => void
  setNotice: (notice: string | null) => void
  refreshUsers: () => Promise<void>
}) {
  const client = useQueryClient()
  const [saving, setSaving] = useState(false)
  const enabled = METERED_BILLING_AVAILABLE && options.active && Boolean(options.username && options.userId)
  const owner = JSON.stringify([options.username, options.capabilities, options.userId, enabled])
  const current = useRef(owner)
  current.current = owner
  const key = ['admin', enabled ? options.username : null, 'details', options.capabilities, 'balance', options.userId]
  const query = useInfiniteQuery({ queryKey: key, enabled, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always',
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ user_id: options.userId! })
      if (pageParam) params.set('cursor', pageParam)
      return apiJson<BalancePage<AdminBalanceTransaction>>(`/api/admin/balance?${params}`, { signal, fallbackMessage: '加载用户积分失败' })
    }, getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const balance = useMemo(() => {
    const pages = query.data?.pages
    if (!enabled || !pages?.length) return null
    const transactions = new Map<string, AdminBalanceTransaction>()
    for (const page of pages) for (const item of page.transactions) if (!transactions.has(item.id)) transactions.set(item.id, item)
    return { ...pages[pages.length - 1], transactions: [...transactions.values()] }
  }, [enabled, query.data])
  const handleLoadMoreUserBalance = async () => {
    if (enabled && query.hasNextPage && !query.isFetching) await query.fetchNextPage({ cancelRefetch: false })
  }
  const handleAdjustUserBalance = async (operation: 'credit' | 'debit' | 'reverse_credit', amount: string, reason: string, idempotencyKey: string,
    rootPassword: string, originalTransactionId?: string): Promise<boolean> => {
    if (!enabled || saving) return false
    if (operation === 'debit' && !window.confirm(`确认从该用户余额扣减 ${amount} 积分？余额不足时服务端会拒绝本次操作。`)) return false
    if (operation === 'reverse_credit' && !window.confirm(`确认撤销交易 ${originalTransactionId} 发放的 ${amount} 积分？该操作可能降低商用资格，余额不足部分会记为待补扣积分。`)) return false
    setSaving(true)
    const busyKey = `user-balance:${options.userId}`
    options.setBusyAction(busyKey); options.setError(null); options.setNotice(null)
    try {
      await apiJson('/api/admin/balance', { method: 'POST', json: { user_id: options.userId, operation, amount, reason, idempotency_key: idempotencyKey, root_password: rootPassword,
        ...(originalTransactionId ? { original_transaction_id: originalTransactionId } : {}) }, fallbackMessage: operation === 'credit' ? '增加积分失败' : '扣减积分失败' })
      if (current.current !== owner) return true
      options.setNotice(operation === 'credit' ? `已增加 ${amount} 积分` : operation === 'debit' ? `已扣减 ${amount} 积分` : `已冲正 ${amount} 积分`)
      const reads = await Promise.allSettled([client.invalidateQueries({ queryKey: key }, { throwOnError: true }), options.refreshUsers()])
      if (current.current === owner && reads.some((result) => result.status === 'rejected')) options.setError('积分调整已成功，数据刷新失败，请手动刷新。')
      return true
    } catch (cause) { if (current.current === owner) options.setError((cause as Error).message); return false }
    finally { setSaving(false); options.setBusyAction((action) => action === busyKey ? null : action) }
  }
  return { balance, loading: query.isFetching, error: query.error, handleLoadMoreUserBalance, handleAdjustUserBalance }
}
