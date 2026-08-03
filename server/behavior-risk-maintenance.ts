import { purgeExpiredBehaviorRiskData, runBehaviorRiskEvaluation } from './storage/behavior-risk-store'
import { createBackgroundWorker } from './background-worker-runtime'

const DAY_MS = 24 * 60 * 60 * 1000
const controller = createBackgroundWorker({
  name: 'behavior_risk',
  intervalMs: DAY_MS,
  maximumBackoffMs: DAY_MS,
  run: runMaintenance,
})

export async function initializeBehaviorRiskMaintenance(): Promise<void> {
  await controller.initialize()
}

export function shutdownBehaviorRiskMaintenance(): void {
  controller.stop()
}

export function waitForBehaviorRiskMaintenanceIdle(): Promise<void> {
  return controller.waitForIdle()
}

async function runMaintenance(): Promise<void> {
  const startedAt = Date.now()
  const evaluation = await runBehaviorRiskEvaluation()
  const purge = await purgeExpiredBehaviorRiskData()
  if (evaluation.status === 'lock_busy' || purge.status === 'lock_busy') {
    console.warn(
      `[behavior-risk] daily maintenance partially skipped: evaluation=${evaluation.status}, purge=${purge.status}, backlog=${evaluation.backlog}`,
    )
    return
  }
  console.info(
    `[behavior-risk] daily maintenance completed in ${Date.now() - startedAt}ms: ${evaluation.cases} cases, ${evaluation.eventsProcessed} events evaluated, backlog=${evaluation.backlog}, ${purge.purgedEvents} expired events and ${purge.purgedCases} expired cases purged`,
  )
}
