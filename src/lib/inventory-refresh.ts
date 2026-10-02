import { useEffect } from 'react'

const INVENTORY_STALE_EVENT = 'inventory:stale'

export function markInventoryStale(): void {
  window.dispatchEvent(new Event(INVENTORY_STALE_EVENT))
}

export function useInventoryRefresh(refresh: () => Promise<void>, refreshKey?: string): void {
  useEffect(() => {
    let stale = true
    let pending = false
    let disposed = false

    const refreshIfStale = () => {
      if (disposed || pending || !stale || document.visibilityState !== 'visible') return
      stale = false
      pending = true
      void refresh().finally(() => {
        pending = false
        refreshIfStale()
      })
    }
    const invalidate = () => {
      stale = true
      refreshIfStale()
    }

    refreshIfStale()
    window.addEventListener(INVENTORY_STALE_EVENT, invalidate)
    window.addEventListener('focus', invalidate)
    document.addEventListener('visibilitychange', invalidate)
    return () => {
      disposed = true
      window.removeEventListener(INVENTORY_STALE_EVENT, invalidate)
      window.removeEventListener('focus', invalidate)
      document.removeEventListener('visibilitychange', invalidate)
    }
  }, [refresh, refreshKey])
}
