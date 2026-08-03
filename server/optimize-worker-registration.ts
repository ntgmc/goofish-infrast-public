import { createBackgroundWorker } from './background-worker-runtime'
import { getOptimizeJobProcessingState } from './optimize-job-runner'
import { getOptimizeWorkerConcurrency } from './optimize-job-config'
import { describeServerError } from './security/error-reporting'
import { query } from './storage/postgres'

export const OPTIMIZE_WORKER_HEARTBEAT_INTERVAL_MS = 10_000
export const OPTIMIZE_WORKER_STALE_AFTER_MS = 30_000
const startedAt = new Date().toISOString()
let registered = false

const controller = createBackgroundWorker({
  name: 'worker_registration',
  intervalMs: OPTIMIZE_WORKER_HEARTBEAT_INTERVAL_MS,
  maximumBackoffMs: OPTIMIZE_WORKER_HEARTBEAT_INTERVAL_MS,
  run: async () => {
    const now = new Date().toISOString()
    await query(
      `insert into optimize_worker_registry
        (worker_id, concurrency, heartbeat_interval_ms, stale_after_ms, capabilities,
         build_sha, started_at, heartbeat_at, draining)
       values ($1, $2, $3, $4, $5::text[], $6, $7, $8, false)
       on conflict (worker_id) do update
         set concurrency = excluded.concurrency,
             heartbeat_interval_ms = excluded.heartbeat_interval_ms,
             stale_after_ms = excluded.stale_after_ms,
             capabilities = excluded.capabilities,
             build_sha = excluded.build_sha,
             heartbeat_at = excluded.heartbeat_at,
             draining = false`,
      [
        getOptimizeJobProcessingState().workerId,
        getOptimizeWorkerConcurrency(),
        OPTIMIZE_WORKER_HEARTBEAT_INTERVAL_MS,
        OPTIMIZE_WORKER_STALE_AFTER_MS,
        ['optimize_jobs', 'optimize_queue', 'inventory_campaign', 'invitation_settlement', 'behavior_risk'],
        buildSha(),
        startedAt,
        now,
      ],
    )
    registered = true
  },
})

export async function initializeOptimizeWorkerRegistration(): Promise<void> {
  await controller.initialize()
}

export function stopOptimizeWorkerRegistration(): void {
  controller.stop()
}

export async function waitForOptimizeWorkerRegistrationIdle(): Promise<void> {
  await controller.waitForIdle()
  if (!registered) return
  registered = false
  await query(
    `update optimize_worker_registry
        set draining = true, heartbeat_at = now()
      where worker_id = $1`,
    [getOptimizeJobProcessingState().workerId],
  ).catch((error) => console.warn('[optimize-worker-registration] draining update failed', describeServerError(error)))
}

function buildSha(): string | null {
  const configured = process.env.APP_BUILD_SHA?.trim() || process.env.GIT_COMMIT_SHA?.trim()
  return configured && /^[A-Za-z0-9._-]{7,64}$/.test(configured) ? configured : null
}
