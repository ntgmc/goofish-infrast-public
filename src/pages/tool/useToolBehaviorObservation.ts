import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { resolveToolRoute } from '../../lib/app-routes'
import { recordToolBehavior, setToolBehaviorPage, startToolBehaviorObservation } from '../../lib/tool-behavior-observation'

export function useToolBehaviorObservation(userId: string | null, profileId: string | null): void {
  const location = useLocation()
  const route = resolveToolRoute(location.pathname)
  const page = route ? `${route.kind}.${route.section}` : null
  const sessionRef = useRef<{ userId: string; id: string } | null>(null)

  useEffect(() => {
    if (!userId) {
      sessionRef.current = null
      return
    }
    if (!page) return
    if (sessionRef.current?.userId !== userId) {
      try {
        sessionRef.current = { userId, id: crypto.randomUUID() }
      } catch {
        return
      }
    }
    const stop = startToolBehaviorObservation(userId, sessionRef.current.id)
    setToolBehaviorPage(page, profileId)
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : null
    function flush() {
      if (visibleSince === null) return
      const startedAt = visibleSince
      visibleSince = null
      const duration = Math.min(24 * 60 * 60 * 1000, Math.max(0, Date.now() - startedAt))
      // Ignore zero-length effect cleanup from StrictMode.
      if (duration > 0) recordToolBehavior({ name: 'page_visit', at: startedAt, duration_ms: duration })
    }
    function resume() {
      if (document.visibilityState === 'visible' && visibleSince === null) visibleSince = Date.now()
    }
    function visibilityChanged() {
      if (document.visibilityState === 'hidden') flush()
      else resume()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', flush)
    window.addEventListener('pageshow', resume)
    return () => {
      flush()
      stop()
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('pageshow', resume)
    }
  }, [userId, page, profileId])
}
