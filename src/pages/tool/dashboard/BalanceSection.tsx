import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { copy } from '../../../copy/index'
import { ApiError, apiJson, getApiErrorMessage } from '../../../lib/api-client'
import type { BalancePage, PublicBalanceTransaction } from '../../../lib/balance-contracts'
import { getMeteredBillingPolicy } from '../../../lib/metered-billing'

const meteredPolicy = getMeteredBillingPolicy()

type RedeemResponse = {
  balance: { currency: 'points'; available: string }
  transaction: PublicBalanceTransaction
  cdk: { cdk_type: 'balance'; amount: string }
  replayed: boolean
}

export default function BalanceSection({ redemptionEnabled }: { redemptionEnabled: boolean }) {
  const [page, setPage] = useState<BalancePage | null>(null)
  const [cdk, setCdk] = useState('')
  const [pending, setPending] = useState<{ cdk: string; key: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorTarget, setErrorTarget] = useState<string | null>(null)

  const load = useCallback(async (cursor?: string | null) => {
    cursor ? setLoadingMore(true) : setLoading(true)
    setError(null)
    setErrorTarget(null)
    try {
      const next = await apiJson<BalancePage>(`/api/user/balance${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
      setPage((current) => cursor && current ? {
        balance: next.balance,
        transactions: [...current.transactions, ...next.transactions],
        next_cursor: next.next_cursor,
        as_of: next.as_of,
      } : next)
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.balance.load_failed))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const redeem = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedCdk = cdk.trim().toUpperCase()
    if (!normalizedCdk) return
    const request = pending?.cdk === normalizedCdk ? pending : { cdk: normalizedCdk, key: crypto.randomUUID() }
    setPending(request)
    setRedeeming(true)
    setError(null)
    setErrorTarget(null)
    setNotice(null)
    try {
      const response = await apiJson<RedeemResponse>('/api/user/balance/redeem', {
        method: 'POST',
        json: { cdk: request.cdk, idempotency_key: request.key },
        fallbackMessage: copy.metered.balance.redeem_failed,
      })
      setCdk('')
      setPending(null)
      setNotice(`${copy.balance.redeem_success}：+${formatPoints(response.cdk.amount)} ${copy.balance.unit}`)
      await load()
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.metered.balance.redeem_retry))
      setErrorTarget(getSafeErrorTarget(caught))
    } finally {
      setRedeeming(false)
    }
  }

  if (!page) {
    if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.balance.loading}</div>
    return <div className="tool-panel p-6" role="alert">
      <p className="text-sm text-error">{error ?? copy.balance.load_failed}</p>
      <button type="button" className="tool-secondary-action mt-4" onClick={() => void load()}>{copy.balance.retry}</button>
    </div>
  }

  const debt = page.balance.debt ?? '0.00'
  const hasDebt = debt !== '0.00'
  const balanceCards = [
    [copy.balance.available, formatPoints(page.balance.available ?? '0.00')],
    [copy.balance.reserved, formatPoints(page.balance.reserved ?? '0.00')],
    ...(hasDebt ? [[copy.balance.debt, formatPoints(debt)]] : []),
  ] as const

  return (
    <div className="space-y-5">
      <section className="tool-panel p-5 sm:p-6">
        <p className="tool-eyebrow">{copy.balance.eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-ink-primary">{copy.balance.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.balance.description}</p>
        <div className={`mt-5 grid gap-3 ${hasDebt ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {balanceCards.map(([label, value]) => <div key={label} className="tool-inset p-5">
            <span className="text-sm text-ink-secondary">{label}</span>
            <strong className="mt-2 block text-2xl font-semibold tabular-nums text-ink-primary">{value}</strong>
            <span className="mt-1 block text-xs text-ink-muted">{copy.balance.unit}</span>
          </div>)}
        </div>
        <div className="tool-inset mt-3 p-5 text-sm text-ink-secondary">
          <div className="flex justify-between gap-4"><span>{copy.balance.lifetime_credited}</span><strong className="tabular-nums text-ink-primary">{formatPoints(page.balance.lifetime_credited ?? '0.00')}</strong></div>
          <div className="mt-2 flex justify-between gap-4"><span>{copy.metered.balance.personal_price_label}</span><strong className="text-ink-primary">{copy.metered.balance.personal_price_value(formatPoints(meteredPolicy.personal.main_schedule_points))}</strong></div>
          {page.balance.commercial && <><div className="mt-2 flex justify-between gap-4"><span>{copy.metered.balance.commercial_label}</span><strong className="text-right text-ink-primary">{hasDebt
            ? copy.metered.balance.commercial_debt(page.balance.commercial.level, formatPoints(debt))
            : page.balance.commercial.eligible
              ? copy.metered.balance.commercial_eligible(page.balance.commercial.level, formatPoints(page.balance.commercial.charge_points))
              : copy.metered.balance.commercial_locked(formatPoints(page.balance.commercial.points_to_next_level ?? page.balance.commercial.threshold_points ?? '10000.00'))}</strong></div>
          {page.balance.commercial.eligible && page.balance.commercial.next_threshold_points && <div className="mt-2 flex justify-between gap-4"><span>{copy.metered.balance.next_level_label}</span><strong className="text-right text-ink-primary">{copy.metered.balance.next_level(formatPoints(page.balance.commercial.points_to_next_level ?? '0.00'), formatPoints(page.balance.commercial.next_threshold_points))}</strong></div>}</>}
        </div>
        {error && <div className="tool-alert tool-alert--error mt-4" role="alert">
          <span>{error}</span>
          {errorTarget && <a className="ml-2 underline" href={errorTarget}>{copy.balance.go_to_redeem}</a>}
        </div>}
        {notice && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{notice}</div>}
      </section>

      {redemptionEnabled && <form onSubmit={redeem} className="tool-panel p-5 sm:p-6">
        <h3 className="text-base font-semibold text-ink-primary">{copy.balance.redeem_title}</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.balance.redeem_description}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{copy.balance.redeem_placeholder}</span>
            <input value={cdk} onChange={(event) => { setCdk(event.currentTarget.value); setPending(null) }} className="tool-field font-mono uppercase tracking-wide" placeholder={copy.balance.redeem_placeholder} required />
          </label>
          <button type="submit" disabled={redeeming} className="tool-primary-action">{redeeming ? copy.balance.redeeming : copy.balance.redeem}</button>
        </div>
      </form>}

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="balance-history-title">
        <h3 id="balance-history-title" className="text-base font-semibold text-ink-primary">{copy.balance.history}</h3>
        {(page?.transactions.length ?? 0) === 0 ? (
          <div className="tool-inset mt-4 p-6 text-center text-sm text-ink-muted">{copy.balance.empty}</div>
        ) : (
          <ul className="mt-4 divide-y divide-surface-3">
            {page!.transactions.map((transaction) => (
              <li key={transaction.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div><strong className="text-sm text-ink-primary">{transactionLabel(transaction.kind)}</strong><span className="mt-1 block text-xs text-ink-muted">{formatDate(transaction.created_at)}</span></div>
                <div className="text-left sm:text-right"><strong className={`tabular-nums ${transaction.amount.startsWith('-') ? 'text-error' : 'text-success'}`}>{transaction.amount.startsWith('-') ? formatPoints(transaction.amount) : `+${formatPoints(transaction.amount)}`}</strong><span className="mt-1 block text-xs text-ink-muted">{copy.metered.balance.transaction_balance(formatPoints(transaction.balance_after))}</span></div>
              </li>
            ))}
          </ul>
        )}
        {page?.next_cursor && <button type="button" disabled={loadingMore} onClick={() => void load(page.next_cursor)} className="tool-secondary-action mt-4 w-full">{loadingMore ? copy.balance.loading : copy.balance.load_more}</button>}
      </section>
    </div>
  )
}

function transactionLabel(kind: PublicBalanceTransaction['kind']): string {
  return copy.balance[kind]
}

function formatPoints(value: string): string {
  return value.endsWith('.00') ? value.slice(0, -3) : value
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function getSafeErrorTarget(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return null
  const target = 'target' in error.data ? (error.data as { target?: unknown }).target : undefined
  return target === '/tool/redeem' ? target : null
}
