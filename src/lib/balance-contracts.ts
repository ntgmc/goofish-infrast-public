export const POINTS_CURRENCY = 'points' as const

export type BalanceTransactionKind = 'cdk_credit' | 'admin_credit' | 'admin_debit'

interface BalanceSummary {
  currency: typeof POINTS_CURRENCY
  available: string
}

export interface PublicBalanceTransaction {
  id: string
  kind: BalanceTransactionKind
  amount: string
  balance_after: string
  created_at: string
}

export interface AdminBalanceTransaction extends PublicBalanceTransaction {
  reference_type: string
  reference_id: string
  admin_username: string | null
  reason: string | null
}

export interface BalancePage<Transaction = PublicBalanceTransaction> {
  balance: BalanceSummary
  transactions: Transaction[]
  next_cursor: string | null
}

export function normalizePointsAmount(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(2, '0')
  const cents = BigInt(whole) * 100n + BigInt(fraction)
  if (cents < 1n || cents > 100_000_000n) return null
  return `${whole}.${fraction}`
}

export function normalizeStoredPoints(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '0.00'
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) return '0.00'
  return `${match[1] ?? ''}${match[2]}.${(match[3] ?? '').padEnd(2, '0')}`
}
