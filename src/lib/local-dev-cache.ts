const VITE_DEV_PORT = '5173'
const SERVICE_WORKER_RELOAD_KEY = 'goofish:vite-dev-service-worker-cleanup-at'
const SERVICE_WORKER_RELOAD_THROTTLE_MS = 60_000

export function clearLocalViteDevCaches(): void {
  if (!isLocalViteDevServer()) return

  void unregisterLocalServiceWorkers()
  void clearLocalCacheStorage()
}

function isLocalViteDevServer(): boolean {
  return (
    window.location.port === VITE_DEV_PORT
    && (
      window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.hostname === '[::1]'
      || window.location.hostname === '::1'
    )
  )
}

async function unregisterLocalServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    if (registrations.length === 0) return

    await Promise.all(registrations.map((registration) => registration.unregister()))

    if (navigator.serviceWorker.controller && !wasRecentlyReloadedForServiceWorker()) {
      writeServiceWorkerReloadAt(Date.now())
      window.location.reload()
    }
  } catch (error) {
    console.warn('Failed to clear localhost service workers for Vite dev server.', error)
  }
}

async function clearLocalCacheStorage(): Promise<void> {
  if (!('caches' in window)) return

  try {
    const cacheNames = await window.caches.keys()
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)))
  } catch (error) {
    console.warn('Failed to clear localhost CacheStorage for Vite dev server.', error)
  }
}

function wasRecentlyReloadedForServiceWorker(): boolean {
  try {
    const lastReloadAt = Number(window.sessionStorage.getItem(SERVICE_WORKER_RELOAD_KEY))
    return Number.isFinite(lastReloadAt) && Date.now() - lastReloadAt < SERVICE_WORKER_RELOAD_THROTTLE_MS
  } catch {
    return true
  }
}

function writeServiceWorkerReloadAt(timestamp: number): void {
  try {
    window.sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, String(timestamp))
  } catch {
    // If sessionStorage is unavailable, avoid forcing a reload loop.
  }
}
