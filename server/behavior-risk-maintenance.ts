import { runBehaviorRiskEvaluation } from './storage/behavior-risk-store'

const DAY_MS = 24 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

export async function initializeBehaviorRiskMaintenance(): Promise<void> {
  if (timer) return
  await runMaintenance()
  timer = setInterval(() => void runMaintenance(), DAY_MS)
  timer.unref?.()
}

export function shutdownBehaviorRiskMaintenance(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function runMaintenance(): Promise<void> {
  try {
    await runBehaviorRiskEvaluation()
  } catch (error) {
    console.warn('[behavior-risk] daily maintenance skipped:', error instanceof Error ? error.message : 'unknown error')
  }
}
