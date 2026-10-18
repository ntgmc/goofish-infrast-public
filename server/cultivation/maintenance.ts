import { refreshCultivationSnapshot, shutdownCultivationWorker } from './worker-client'
import { CULTIVATION_DAY_MS, cultivationDayStart } from './cache-policy'

let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let controller: AbortController | null = null

async function updateIfStale(signal: AbortSignal) {
  try { await refreshCultivationSnapshot(signal) }
  catch (error) {
    if (!signal.aborted && !(error instanceof Error && 'code' in error && ['prts_data_unavailable', 'cultivation_busy'].includes(String(error.code)))) {
      console.warn('PRTS cultivation incremental update failed:', error instanceof Error ? error.message : 'unknown')
    }
  }
}

export function initializeCultivationMaintenance() {
  if (timer) return
  controller = new AbortController()
  const signal = controller.signal
  const tick = () => {
    if (signal.aborted) return
    running ??= updateIfStale(signal).finally(() => { running = null })
    timer = setTimeout(tick, cultivationDayStart() + CULTIVATION_DAY_MS - Date.now())
    timer.unref()
  }
  tick()
}

export function shutdownCultivationMaintenance() {
  if (timer) clearTimeout(timer)
  timer = null
  controller?.abort()
  controller = null
  return (running ?? Promise.resolve()).finally(shutdownCultivationWorker)
}
