import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../../lib/api-client'

export function useLicenseSync(profileId: string, orderHash: string) {
  const [syncing, setSyncing] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSyncing(true)

    apiJson(`/api/user/status?profile_id=${encodeURIComponent(profileId)}`, {
      fallbackMessage: '账号授权状态同步失败',
    })
      .then(() => {
        if (!cancelled) setStatus(null)
      })
      .catch((error) => {
        if (!cancelled) setStatus((error as Error).message)
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })

    return () => {
      cancelled = true
    }
  }, [orderHash, profileId])

  // License updates are currently delivered by the profile owner. Keeping the
  // completion callback explicit lets the optimization workflow flush queued
  // sync implementations without exposing refs or timers to the page view.
  const flushPendingSync = useCallback(() => undefined, [])

  return { syncing, status, flushPendingSync }
}
