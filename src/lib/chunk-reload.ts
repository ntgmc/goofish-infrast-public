const RELOAD_STORAGE_KEY = 'goofish:stale-chunk-reload-at'
const RELOAD_QUERY_PARAM = 'app_reload'
const RELOAD_THROTTLE_MS = 60_000

export function installStaleChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', handleVitePreloadError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  window.addEventListener('error', handleWindowError, true)
}

function handleVitePreloadError(event: Event): void {
  event.preventDefault()
  reloadOnceForStaleChunk('vite preload error')
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!isStaleChunkError(event.reason)) return
  event.preventDefault()
  reloadOnceForStaleChunk('dynamic import rejection')
}

function handleWindowError(event: ErrorEvent): void {
  if (isAssetLoadError(event) || isStaleChunkError(event.error) || isStaleChunkError(event.message)) {
    event.preventDefault()
    reloadOnceForStaleChunk('module load error')
  }
}

function reloadOnceForStaleChunk(reason: string): void {
  const now = Date.now()
  if (wasRecentlyReloaded(now)) return

  writeLastReloadAt(now)
  console.warn(`Detected a stale frontend bundle after ${reason}; refreshing the page.`)

  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set(RELOAD_QUERY_PARAM, String(now))
  window.location.replace(nextUrl.toString())
}

function wasRecentlyReloaded(now: number): boolean {
  const lastStoredReloadAt = readLastReloadAt()
  if (lastStoredReloadAt && now - lastStoredReloadAt < RELOAD_THROTTLE_MS) return true

  const lastQueryReloadAt = Number(new URL(window.location.href).searchParams.get(RELOAD_QUERY_PARAM))
  return Number.isFinite(lastQueryReloadAt) && now - lastQueryReloadAt < RELOAD_THROTTLE_MS
}

function readLastReloadAt(): number | null {
  try {
    const value = window.sessionStorage.getItem(RELOAD_STORAGE_KEY)
    if (!value) return null
    const timestamp = Number(value)
    return Number.isFinite(timestamp) ? timestamp : null
  } catch {
    return null
  }
}

function writeLastReloadAt(timestamp: number): void {
  try {
    window.sessionStorage.setItem(RELOAD_STORAGE_KEY, String(timestamp))
  } catch {
    // The query string fallback still prevents a tight reload loop.
  }
}

function isAssetLoadError(event: ErrorEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLScriptElement) && !(target instanceof HTMLLinkElement)) return false

  const url = target instanceof HTMLScriptElement ? target.src : target.href
  return isBundledAssetUrl(url)
}

function isBundledAssetUrl(url: string): boolean {
  if (!url) return false
  try {
    return new URL(url, window.location.href).pathname.startsWith('/assets/')
  } catch {
    return url.startsWith('/assets/')
  }
}

function isStaleChunkError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase()
  return (
    message.includes('failed to fetch dynamically imported module')
    || message.includes('error loading dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('dynamically imported module')
    || message.includes('chunkloaderror')
    || message.includes('loading chunk')
  )
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message : ''
  }
  return ''
}
