import { getOptimizeJobMaxAttempts } from './optimize-job-config'
import { requestOptimizeJobProcessing } from './optimize-job-signals'
import { canMaintainOptimizeQueue } from './process-role'
import { getOptimizeJobStore } from './storage/optimize-job-store'

const DEFAULT_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000
const MAINTENANCE_INTERVAL_MS = 60_000

let maintenanceInitialized = false
let cleanupTimer: ReturnType<typeof setInterval> | null = null

export async function initializeOptimizeQueueMaintenance(): Promise<void> {
  if (!canMaintainOptimizeQueue() || maintenanceInitialized) return
  maintenanceInitialized = true
  await runQueueMaintenance()
  startMaintenanceTimer()
}

export function shutdownOptimizeQueueMaintenance(): void {
  if (cleanupTimer) clearInterval(cleanupTimer)
  cleanupTimer = null
  maintenanceInitialized = false
}

export function isOptimizeQueueMaintenanceInitialized(): boolean {
  return maintenanceInitialized
}

function startMaintenanceTimer(): void {
  cleanupTimer = setInterval(() => void runQueueMaintenance(), MAINTENANCE_INTERVAL_MS)
  cleanupTimer.unref?.()
}

async function runQueueMaintenance(): Promise<void> {
  try {
    const store = getOptimizeJobStore()
    const now = new Date().toISOString()
    const recovered = await store.recoverExpiredAttempts(now, getOptimizeJobMaxAttempts())
    const expired = await store.expireQueuedJobs(now)
    const before = new Date(Date.now() - DEFAULT_CLEANUP_AGE_MS).toISOString()
    await store.cleanupOldJobs(before)
    if (recovered > 0 || expired > 0) requestOptimizeJobProcessing()
  } catch (error) {
    console.warn('optimize job recovery skipped:', error)
  }
}
