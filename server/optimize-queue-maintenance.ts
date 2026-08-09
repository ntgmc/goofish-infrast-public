import { getOptimizeJobMaxAttempts } from './optimize-job-config'
import { requestOptimizeJobProcessing } from './optimize-job-signals'
import { canMaintainOptimizeQueue } from './process-role'
import { getOptimizeJobStore } from './storage/optimize-job-store'
import { recordUsageEvent } from './handlers/usage-stats'
import { processPendingOptimizationJobEffects } from './optimization/jobs/job-effects'
import { describeServerError } from './security/error-reporting'
import { createBackgroundWorker } from './background-worker-runtime'
import { hasDatabaseUrl, withPostgresAdvisoryLock } from './storage/postgres'
import {
  initializeOptimizeWorkerAutoscaling,
  shutdownOptimizeWorkerAutoscaling,
  waitForOptimizeWorkerAutoscalingIdle,
} from './optimize-worker-autoscaler'

const DEFAULT_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000
const MAINTENANCE_INTERVAL_MS = 60_000

const controller = createBackgroundWorker({
  name: 'optimize_queue',
  intervalMs: MAINTENANCE_INTERVAL_MS,
  run: runQueueMaintenance,
})

export async function initializeOptimizeQueueMaintenance(): Promise<void> {
  if (!canMaintainOptimizeQueue()) return
  await controller.initialize()
  await initializeOptimizeWorkerAutoscaling()
}

export function shutdownOptimizeQueueMaintenance(): void {
  shutdownOptimizeWorkerAutoscaling()
  controller.stop()
}

export function isOptimizeQueueMaintenanceInitialized(): boolean {
  return controller.getHealth().initialized
}

export function waitForOptimizeQueueMaintenanceIdle(): Promise<void> {
  return Promise.all([
    controller.waitForIdle(),
    waitForOptimizeWorkerAutoscalingIdle(),
  ]).then(() => undefined)
}

async function runQueueMaintenance(): Promise<void> {
  if (!hasDatabaseUrl()) {
    await runQueueMaintenanceAsLeader()
    return
  }
  const result = await withPostgresAdvisoryLock('optimize-queue-maintenance', runQueueMaintenanceAsLeader)
  if (!result.acquired) console.info('[optimize-queue-maintenance] leader lock busy; run skipped')
}

async function runQueueMaintenanceAsLeader(): Promise<void> {
  try {
    const store = getOptimizeJobStore()
    const now = new Date().toISOString()
    const recovered = await store.recoverExpiredAttempts(now, getOptimizeJobMaxAttempts())
    const expired = await store.expireQueuedJobs(now)
    const billing = await store.reconcileBilling?.()
    await processPendingOptimizationJobEffects()
    if (billing && (billing.repaired > 0 || billing.quarantined > 0)) {
      console.warn(`[billing-reconciliation] repaired ${billing.repaired}; queued ${billing.quarantined} cases for review`)
    }
    if (billing?.anomalies) {
      console.error(`[billing-reconciliation] detected ${billing.anomalies} reservation/account projection inconsistencies`)
      await recordUsageEvent('metered_billing', {
        status: 'failure',
        reason_code: 'billing_reconciliation_anomaly',
        source: `count:${billing.anomalies}`,
      }, `reconciliation:${now.slice(0, 16)}`).catch((trackingError) => {
        console.warn('billing reconciliation metric skipped', describeServerError(trackingError))
      })
    }
    const before = new Date(Date.now() - DEFAULT_CLEANUP_AGE_MS).toISOString()
    await store.cleanupOldJobs(before)
    if (recovered > 0 || expired > 0) requestOptimizeJobProcessing()
  } catch (error) {
    console.warn('[optimize-queue-maintenance] run failed', describeServerError(error))
    throw error
  }
}
