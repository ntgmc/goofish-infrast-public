import { refreshCultivationSnapshot, shutdownCultivationWorker } from './worker-client'

let timer: ReturnType<typeof setInterval> | null = null
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
  const tick = () => { running ??= updateIfStale(signal).finally(() => { running = null }) }
  tick()
  timer = setInterval(tick, 3600000)
  timer.unref()
}

export function shutdownCultivationMaintenance() {
  if (timer) clearInterval(timer)
  timer = null
  controller?.abort()
  controller = null
  return (running ?? Promise.resolve()).finally(shutdownCultivationWorker)
}
