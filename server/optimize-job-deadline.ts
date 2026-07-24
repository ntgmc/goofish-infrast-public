import { getOptimizeJobHardTimeoutMs } from './optimize-job-config'

export function calculateOptimizeExecutionDeadlineAtMs(
  startedAt: string | null | undefined,
  nowMs = Date.now(),
  hardTimeoutMs = getOptimizeJobHardTimeoutMs(),
): number {
  const startedAtMs = Date.parse(startedAt ?? '')
  const executionStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : nowMs
  return executionStartedAtMs + hardTimeoutMs
}

export function remainingOptimizeExecutionMs(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(1, deadlineAtMs - nowMs)
}
