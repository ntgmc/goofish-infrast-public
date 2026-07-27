import { runBehaviorRiskEvaluation } from './storage/behavior-risk-store'

const DAY_MS = 24 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

export async function initializeBehaviorRiskMaintenance(): Promise<void> {
  if (timer) return
  timer = setInterval(() => void runMaintenance(), DAY_MS)
  timer.unref?.()
  void runMaintenance()
}

export function shutdownBehaviorRiskMaintenance(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function runMaintenance(): Promise<void> {
  const startedAt = Date.now()
  try {
    const result = await runBehaviorRiskEvaluation()
    console.info(
      `[behavior-risk] daily maintenance completed in ${Date.now() - startedAt}ms: ${result.cases} cases, ${result.purgedEvents} expired events purged`,
    )
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? ` code=${error.code}`
      : ''
    console.warn(
      `[behavior-risk] daily maintenance skipped after ${Date.now() - startedAt}ms${code}:`,
      error instanceof Error ? error.message : 'unknown error',
    )
  }
}
