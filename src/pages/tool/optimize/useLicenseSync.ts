import { useCallback, useEffect, useRef, useState } from 'react'
import { apiJson } from '../../../lib/api-client'
import { copy } from '../../../copy/index'


export function useLicenseSync(profileId: string, orderHash: string) {
  const [syncing, setSyncing] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const requestVersionRef = useRef(0)

  const sync = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    setSyncing(true)
    try {
      await apiJson(`/api/user/status?profile_id=${encodeURIComponent(profileId)}`, {
        fallbackMessage: copy.optimize.pages_tool_optimize_useLicenseSync_001,
      })
      if (requestVersionRef.current === requestVersion) setStatus(null)
    } catch (error) {
      if (requestVersionRef.current === requestVersion) setStatus((error as Error).message)
    } finally {
      if (requestVersionRef.current === requestVersion) setSyncing(false)
    }
  }, [profileId])

  useEffect(() => {
    void sync()
    const handleFocus = () => { void sync() }
    window.addEventListener('focus', handleFocus)

    return () => {
      requestVersionRef.current += 1
      window.removeEventListener('focus', handleFocus)
    }
  }, [orderHash, sync])

  // License updates are currently delivered by the profile owner. Keeping the
  // completion callback explicit lets the optimization workflow flush queued
  // sync implementations without exposing refs or timers to the page view.
  const flushPendingSync = useCallback(() => { void sync() }, [sync])

  return { syncing, status, flushPendingSync }
}
