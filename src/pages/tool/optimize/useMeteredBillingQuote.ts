import { useCallback, useEffect, useState } from 'react'
import { copy } from '../../../copy/index'
import { apiJson, getApiErrorCode, getApiErrorMessage } from '../../../lib/api-client'
import type { IssuedMeteredScheduleQuote, MeteredBillingOperation } from '../../../lib/metered-billing'
import type { UserGameAccountKind } from '../../../lib/types'

export type BillingQuote = IssuedMeteredScheduleQuote

export function useMeteredBillingQuote(
  profileKind: UserGameAccountKind,
  profileId: string,
  operation: MeteredBillingOperation = 'main_schedule',
  enabled = true,
) {
  const [quote, setQuote] = useState<BillingQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async (): Promise<BillingQuote | null> => {
    const shouldQuote = enabled && (operation !== 'main_schedule' || isMeteredProfileKind(profileKind))
    if (!shouldQuote) {
      setQuote(null)
      setError(null)
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const next = await apiJson<BillingQuote>(`/api/user/billing/quote?profile_id=${encodeURIComponent(profileId)}&operation=${operation}`, {
        fallbackMessage: copy.metered.quote.load_failed,
      })
      setQuote(next)
      return next
    } catch (caught) {
      setQuote(null)
      setError(getApiErrorMessage(caught, copy.metered.quote.load_failed))
      throw caught
    } finally {
      setLoading(false)
    }
  }, [enabled, operation, profileId, profileKind])
  useEffect(() => { void refresh().catch(() => undefined) }, [refresh])
  return { quote, loading, error, refresh }
}

export async function submitWithMeteredBillingQuote<T>(options: {
  profileKind: UserGameAccountKind
  quote: BillingQuote | null
  quoteError: string | null
  requireQuote?: boolean
  refreshQuote: () => Promise<BillingQuote | null>
  submit: (quote: BillingQuote | null) => Promise<T>
}): Promise<T> {
  if ((options.requireQuote || isMeteredProfileKind(options.profileKind)) && !options.quote) {
    throw new Error(options.quoteError ?? copy.metered.quote.load_failed)
  }
  if (options.quote?.sufficient === false) throw new Error(copy.metered.quote.insufficient)
  let refreshed = false
  try {
    return await options.submit(options.quote)
  } catch (error) {
    const code = getApiErrorCode(error)
    if (code === 'pricing_changed' || code === 'quote_already_used') {
      refreshed = true
      const latest = await options.refreshQuote().catch(() => null)
      if (latest && options.quote) {
        throw new Error(copy.metered.quote.changed(options.quote.charge, latest.charge))
      }
    }
    throw error
  } finally {
    if (!refreshed) void options.refreshQuote().catch(() => undefined)
  }
}

function isMeteredProfileKind(kind: UserGameAccountKind): boolean {
  return kind === 'metered_personal' || kind === 'metered_commercial'
}
