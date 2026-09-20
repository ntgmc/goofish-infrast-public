import type { ScheduleProgressState } from './ScheduleProgress'
import type { OptimizeCalculationStage } from '../lib/types'

export const SCHEDULE_PROGRESS_COMPLETION_DURATION_MS = 420

type StageBounds = readonly [minimum: number, maximum: number, pacingMs: number]

const SCHEDULE_STAGES: Record<Exclude<OptimizeCalculationStage, 'completed'>, StageBounds> = {
  starting: [8, 18, 4_000],
  generating_schedule: [18, 68, 30_000],
  generating_potential_schedule: [68, 72, 15_000],
  simulating_upgrades: [72, 80, 30_000],
  enriching_training_costs: [80, 84, 15_000],
  simulating_maa_baseline: [68, 88, 20_000],
  formatting_result: [88, 93, 5_000],
  persisting_result: [93, 99, 10_000],
}

const SUGGESTION_STAGES: typeof SCHEDULE_STAGES = {
  starting: [8, 16, 4_000],
  generating_schedule: [16, 48, 30_000],
  generating_potential_schedule: [48, 62, 15_000],
  simulating_upgrades: [62, 78, 30_000],
  enriching_training_costs: [78, 86, 15_000],
  simulating_maa_baseline: [86, 91, 20_000],
  formatting_result: [91, 94, 5_000],
  persisting_result: [94, 99, 10_000],
}

export function isScheduleProgressPaused(progress: ScheduleProgressState): boolean {
  return progress.estimatePhase === 'failed'
    || progress.estimatePhase === 'cancelled'
    || progress.cancellationRequested === true
    || progress.executionPhase === 'retry_wait'
    || progress.connectionStatus === 'reconnecting'
}

export function getScheduleProgressPercent(progress: ScheduleProgressState, now: number): number {
  const completed = progress.completedAt !== undefined || progress.estimatePhase === 'completed'
  const sampleAt = isScheduleProgressPaused(progress) && !completed
    ? Math.min(now, progress.lastUpdatedAt ?? progress.startedAt)
    : now
  const floor = Number.isFinite(progress.percentFloor) ? Math.max(0, progress.percentFloor ?? 0) : 0
  if (isScheduleProgressPaused(progress) && !completed && Number.isFinite(progress.percentFloor)) {
    return Math.min(99, floor)
  }
  const activePercent = getActivePercent(progress, sampleAt)
  const percent = Math.min(99, Math.max(activePercent, floor))
  if (!completed) return percent
  if (progress.completedAt === undefined) return 100
  const ratio = Math.max(0, Math.min(1, (now - progress.completedAt) / SCHEDULE_PROGRESS_COMPLETION_DURATION_MS))
  return percent + (100 - percent) * (1 - (1 - ratio) ** 3)
}

function getActivePercent(progress: ScheduleProgressState, now: number): number {
  const elapsed = Math.max(0, now - progress.startedAt)
  const running = progress.observedRunning || progress.queueStatus === 'running'
    || progress.estimatePhase === 'running' || progress.estimatePhase === 'overdue'
  if (!running && (progress.queueStatus === 'queued' || progress.estimatePhase === 'queued')) {
    return approach(2, 8, elapsed, 20_000)
  }
  const stage = progress.calculationStage
  if (stage && stage !== 'completed') {
    const stages = progress.upgradeSuggestionsRequested && progress.upgradeSuggestionsAllowed
      ? SUGGESTION_STAGES : SCHEDULE_STAGES
    const [minimum, maximum, pacingMs] = stages[stage]
    const stageStartedAt = Date.parse(progress.calculationStageUpdatedAt ?? '')
    return approach(minimum, maximum, Number.isFinite(stageStartedAt) ? Math.max(0, now - stageStartedAt) : 0, pacingMs)
  }
  if (stage === 'completed' || progress.executionPhase === 'settling') return 99
  const duration = progress.estimatedTotalMs ?? progress.estimatedDurationMs ?? 10_000
  const safeDuration = Number.isFinite(duration) ? Math.max(1_000, duration) : 10_000
  return approach(running ? 8 : 0, running ? 88 : 8, elapsed, safeDuration)
}

function approach(minimum: number, maximum: number, elapsed: number, pacingMs: number): number {
  // Keep the next milestone exclusive, including after rounding for display.
  return minimum + (maximum - minimum - 0.51) * (1 - Math.exp(-elapsed / pacingMs))
}
