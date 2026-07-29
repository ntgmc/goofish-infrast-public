import type { Dispatch, SetStateAction } from 'react'
import type { AdminBalanceTransaction, BalancePage } from '../../../lib/balance-contracts'
import { adminApiJson as apiJson } from '../../../lib/admin-api-client'
import type { AdminUserDetail } from '../contracts'

export function fetchAdminUserBalance(userId: string, cursor?: string | null) {
  const params = new URLSearchParams({ user_id: userId })
  if (cursor) params.set('cursor', cursor)
  return apiJson<BalancePage<AdminBalanceTransaction>>(`/api/admin/balance?${params}`, {
    fallbackMessage: '加载用户积分失败',
  })
}

async function loadMoreAdminUserBalance(options: {
  userId: string
  current: BalancePage<AdminBalanceTransaction>
  setBalance: Dispatch<SetStateAction<BalancePage<AdminBalanceTransaction> | null>>
}): Promise<void> {
  if (!options.current.next_cursor) return
  const page = await fetchAdminUserBalance(options.userId, options.current.next_cursor)
  options.setBalance((current) => current ? {
    balance: page.balance,
    transactions: [
      ...current.transactions,
      ...page.transactions.filter((item) => !current.transactions.some((existing) => existing.id === item.id)),
    ],
    next_cursor: page.next_cursor,
  } : page)
}

async function adjustAdminUserBalance(options: {
  userId: string
  operation: 'credit' | 'debit'
  amount: string
  reason: string
  idempotencyKey: string
}): Promise<BalancePage<AdminBalanceTransaction>> {
  await apiJson('/api/admin/balance', {
    method: 'POST',
    json: {
      user_id: options.userId,
      operation: options.operation,
      amount: options.amount,
      reason: options.reason,
      idempotency_key: options.idempotencyKey,
    },
    fallbackMessage: options.operation === 'credit' ? '增加积分失败' : '扣减积分失败',
  })
  return fetchAdminUserBalance(options.userId)
}

export function createAdminUserBalanceActions(options: {
  detail: AdminUserDetail | null
  balance: BalancePage<AdminBalanceTransaction> | null
  loading: boolean
  setBalance: Dispatch<SetStateAction<BalancePage<AdminBalanceTransaction> | null>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setBusyAction: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  refreshUsers: () => Promise<void>
}) {
  const handleLoadMoreUserBalance = async () => {
    if (!options.detail || !options.balance?.next_cursor || options.loading) return
    options.setLoading(true)
    options.setError(null)
    try {
      await loadMoreAdminUserBalance({ userId: options.detail.user.id, current: options.balance, setBalance: options.setBalance })
    } catch (error) {
      options.setError((error as Error).message)
    } finally {
      options.setLoading(false)
    }
  }

  const handleAdjustUserBalance = async (
    operation: 'credit' | 'debit', amount: string, reason: string, idempotencyKey: string,
  ): Promise<boolean> => {
    if (!options.detail) return false
    if (operation === 'debit' && !window.confirm(`确认从该用户余额扣减 ${amount} 积分？余额不足时服务端会拒绝本次操作。`)) return false
    options.setBusyAction(`user-balance:${options.detail.user.id}`)
    options.setError(null)
    options.setNotice(null)
    try {
      options.setBalance(await adjustAdminUserBalance({ userId: options.detail.user.id, operation, amount, reason, idempotencyKey }))
      options.setNotice(operation === 'credit' ? `已增加 ${amount} 积分` : `已扣减 ${amount} 积分`)
      await options.refreshUsers()
      return true
    } catch (error) {
      options.setError((error as Error).message)
      return false
    } finally {
      options.setBusyAction(null)
    }
  }
  return { handleLoadMoreUserBalance, handleAdjustUserBalance }
}
