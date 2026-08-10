import { createBackgroundWorker } from './background-worker-runtime'
import { isServiceReady } from './lifecycle'
import { getAdminOptimizationQueueSnapshot } from './storage/optimize-job-store'
import {
  recordServiceStatusSample,
  pruneServiceStatusHistory,
} from './storage/service-status-store'
import { hasDatabaseUrl, withPostgresAdvisoryLock } from './storage/postgres'
import {
  floorStatusTimestampToHour,
  resolveOptimizationServiceStatus,
} from '../src/lib/service-status'

const SERVICE_STATUS_SAMPLE_INTERVAL_MS = 5 * 60 * 1000
const SERVICE_STATUS_ADVISORY_LOCK = 'service-status-history-sampler'
const SERVICE_STATUS_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const controller = createBackgroundWorker({
  name: 'service_status_history',
  intervalMs: SERVICE_STATUS_SAMPLE_INTERVAL_MS,
  idleIntervalMs: SERVICE_STATUS_SAMPLE_INTERVAL_MS,
  run: runServiceStatusSampling,
  logError: (message, error) => console.warn(message, { name: error.name, code: error.code }),
})

export async function initializeServiceStatusHistory(): Promise<void> {
  await controller.initialize()
}

export function shutdownServiceStatusHistory(): void {
  controller.stop()
}

export function waitForServiceStatusHistoryIdle(): Promise<void> {
  return controller.waitForIdle()
}

/**
 * Execute one safe, leader-elected sample. Errors are deliberately contained
 * so an optional history database outage never prevents the API from starting.
 */
export async function runServiceStatusSampling(): Promise<boolean> {
  if (!isServiceReady()) return false
  if (!hasDatabaseUrl()) return false

  try {
    const result = await withPostgresAdvisoryLock(SERVICE_STATUS_ADVISORY_LOCK, async () => {
      const snapshot = await getAdminOptimizationQueueSnapshot(undefined, 1)
      const sampledAt = snapshot.snapshot_at || new Date().toISOString()
      const status = resolveOptimizationServiceStatus({
        serviceReady: isServiceReady(),
        queued: snapshot.counts.queued,
        running: snapshot.counts.running,
        workerConcurrency: snapshot.capacity.worker_concurrency,
        workerInstances: snapshot.capacity.worker_instances,
      })
      await recordServiceStatusSample({
        componentId: 'optimization',
        bucketStart: floorStatusTimestampToHour(sampledAt),
        status,
        queued: snapshot.counts.queued,
        running: snapshot.counts.running,
        workerConcurrency: snapshot.capacity.worker_concurrency,
        workerInstances: snapshot.capacity.billable_worker_instances ?? snapshot.capacity.worker_instances,
        sampledAt,
      })
      const before = new Date(Date.parse(sampledAt) - SERVICE_STATUS_HISTORY_RETENTION_MS).toISOString()
      await pruneServiceStatusHistory(before)
      return true
    })
    return result.acquired ? result.value : false
  } catch (error) {
    // Do not include queue rows or any request payload in maintenance logs.
    console.warn('[service-status-history] sample failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined,
    })
    return false
  }
}
