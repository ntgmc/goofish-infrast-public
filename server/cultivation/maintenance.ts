import { syncPrtsPlanning } from '../../scripts/prts-planning-sync.mjs'
import { readPrtsSnapshot } from './catalog'

let timer: ReturnType<typeof setInterval> | null = null
let running: Promise<void> | null = null
let controller: AbortController | null = null

async function updateIfStale(signal: AbortSignal) {
  let snapshot
  try { snapshot = await readPrtsSnapshot() }
  catch { return }
  if (Date.now() - Date.parse(snapshot.updatedAt) < 24 * 3600000 || signal.aborted) return
  try { await syncPrtsPlanning({ signal }) }
  catch (error) {
    if (!signal.aborted) console.warn('PRTS cultivation incremental update failed:', error instanceof Error ? error.message : 'unknown')
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
  return running ?? Promise.resolve()
}
