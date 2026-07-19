import { useEffect, useMemo, useState } from 'react'
import type { OptimizeJobPriority } from '../lib/types'
import { copy } from '../copy/index'


type ScheduleEstimatePhase = 'queued' | 'running' | 'overdue' | 'completed' | 'failed' | 'cancelled'

export interface ScheduleProgressState {
  mode: 'generate' | 'apply' | 'scenario';
  startedAt: number;
  completedAt?: number;
  estimatedDurationMs?: number;
  estimatedRemainingMs?: number | null;
  estimatedTotalMs?: number | null;
  estimatePhase?: ScheduleEstimatePhase;
  estimateUpdatedAt?: string;
  estimateAdjustment?: string;
  queueStatus?: 'queued' | 'running';
  queuePosition?: number | null;
  priority?: OptimizeJobPriority;
  jobId?: string;
  observedRunning?: boolean;
  percentFloor?: number;
  lastUpdatedAt?: number;
  connectionStatus?: 'connected' | 'reconnecting';
  consecutivePollFailures?: number;
  lastSuccessfulSyncAt?: number;
  executionPhase?: 'initial_queue' | 'retry_wait' | 'executing' | 'settling' | 'terminal';
  attemptCount?: number;
  nextAttemptAt?: string | null;
  cancellationRequested?: boolean;
}

interface Props {
  progress: ScheduleProgressState;
  className?: string;
  variant?: 'embedded' | 'focus';
}

type TaskStatus = 'preparing' | 'queued' | 'retrying' | 'cancelling' | 'running' | 'overdue' | 'finishing' | 'completed'
type StepVisualState = 'done' | 'active' | 'pending'

export default function ScheduleProgress({ progress, className = '', variant = 'embedded' }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const calculatedPercent = getTimedPercent(progress, now)
  const progressKey = `${progress.jobId ?? 'local'}:${progress.startedAt}`
  const [percentFloor, setPercentFloor] = useState<{ key: string; value: number }>(() => ({
    key: progressKey,
    value: Math.max(calculatedPercent, progress.percentFloor ?? 0),
  }))
  const floor = percentFloor.key === progressKey ? Math.max(percentFloor.value, progress.percentFloor ?? 0) : progress.percentFloor ?? 0
  const rawPercent = Math.max(calculatedPercent, floor)
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)))
  const task = useMemo(() => getTaskView(progress, rawPercent, now), [progress, rawPercent, now])
  const compact = variant === 'embedded'

  useEffect(() => {
    setPercentFloor((current) => {
    const nextCalculated = Math.max(calculatedPercent, progress.percentFloor ?? 0)
    if (current.key !== progressKey) return { key: progressKey, value: nextCalculated }
    const nextValue = Math.max(current.value, nextCalculated)
      return nextValue === current.value ? current : { key: progressKey, value: nextValue }
    })
  }, [calculatedPercent, progress.completedAt, progressKey])

  useEffect(() => {
    let timer = 0
    const tick = () => {
      const nextNow = Date.now()
      setNow(nextNow)
      if (getTimedPercent(progress, nextNow) < 100 || !progress.completedAt) {
        timer = window.setTimeout(tick, progress.queueStatus === 'queued' ? 900 : 260)
      }
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [progress])

  return (
    <section
      className={`tool-panel ${compact ? 'p-4' : 'p-5 sm:p-6'} ${className}`}
      data-status={task.status}
      aria-live="polite"
      aria-label={progress.mode === 'generate' ? copy.common.components_ScheduleProgress_001 : progress.mode === 'scenario' ? copy.common.components_ScheduleProgress_002 : copy.common.components_ScheduleProgress_003}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="tool-eyebrow">{task.eyebrow}</p>
              <span className={`tool-status ${task.priorityClass}`}>{task.priorityLabel}</span>
              {task.jobLabel && <span className="tool-status">{task.jobLabel}</span>}
            </div>
            <h3 className={`${compact ? 'mt-2 text-base' : 'mt-3 text-lg'} font-semibold text-ink-primary`}>{task.title}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">{task.detail}</p>
            {task.adjustmentLabel && <p className="mt-3 tool-status tool-status--current max-w-full">{task.adjustmentLabel}</p>}
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-xs font-medium text-ink-muted">{task.meterLabel}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-[-0.03em] text-ink-primary">{percent}%</p>
          </div>
        </div>

        <div
          className="h-2 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={task.ariaText}
        >
          <div className="schedule-progress-fill h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
        </div>

        <ol className="grid gap-2 sm:grid-cols-4" aria-label={copy.common.components_ScheduleProgress_004}>
          {task.steps.map((step, index) => (
            <li key={step.label}>
              <TaskStep label={step.label} detail={step.detail} state={getStepState(task.status, index)} />
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-3 gap-2">
          <TaskMiniStat label={copy.common.components_ScheduleProgress_005} value={task.remainingLabel} emphasis={task.status === 'overdue'} />
          <TaskMiniStat label={copy.common.components_ScheduleProgress_006} value={task.elapsedLabel} />
          <TaskMiniStat label={copy.common.components_ScheduleProgress_007} value={task.syncLabel} />
        </div>

        {!compact && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-3 pt-3 text-xs leading-5 text-ink-muted">
            <span>{task.footer}</span>
            <span className="tabular-nums">{task.queueLabel}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function TaskMiniStat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`tool-inset min-w-0 px-3 py-2 ${emphasis ? 'border-warning/40 bg-warning/10' : 'bg-surface-2/60'}`}>
      <p className="text-[11px] font-medium text-ink-muted">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold tabular-nums text-ink-primary" title={value}>{value}</p>
    </div>
  )
}

function TaskStep({ label, detail, state }: { label: string; detail: string; state: StepVisualState }) {
  return (
    <div className={`tool-inset h-full px-3 py-2.5 transition-colors duration-200 ${getStepClass(state)}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${getStepDotClass(state)}`}>
          {state === 'done' ? <CheckIcon /> : state === 'active' ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
        </span>
        <span className="min-w-0 text-sm font-semibold text-ink-primary">{label}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{detail}</p>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.4 6.5 11 12.5 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ESTIMATED_DURATION_MS = 10_000
export const SCHEDULE_PROGRESS_COMPLETION_DURATION_MS = 420
const MAX_WAITING_PERCENT = 96

const TASK_STEPS: Record<ScheduleProgressState['mode'], Array<{ label: string; detail: string }>> = {
  generate: [
    { label: copy.common.components_ScheduleProgress_008, detail: copy.common.components_ScheduleProgress_009 },
    { label: copy.common.components_ScheduleProgress_010, detail: copy.common.components_ScheduleProgress_011 },
    { label: copy.common.components_ScheduleProgress_012, detail: copy.common.components_ScheduleProgress_013 },
    { label: copy.common.components_ScheduleProgress_014, detail: copy.common.components_ScheduleProgress_015 },
  ],
  apply: [
    { label: copy.common.components_ScheduleProgress_016, detail: copy.common.components_ScheduleProgress_017 },
    { label: copy.common.components_ScheduleProgress_018, detail: copy.common.components_ScheduleProgress_019 },
    { label: copy.common.components_ScheduleProgress_020, detail: copy.common.components_ScheduleProgress_021 },
    { label: copy.common.components_ScheduleProgress_022, detail: copy.common.components_ScheduleProgress_023 },
  ],
  scenario: [
    { label: copy.common.components_ScheduleProgress_024, detail: copy.common.components_ScheduleProgress_025 },
    { label: copy.common.components_ScheduleProgress_026, detail: copy.common.components_ScheduleProgress_027 },
    { label: copy.common.components_ScheduleProgress_028, detail: copy.common.components_ScheduleProgress_029 },
    { label: copy.common.components_ScheduleProgress_030, detail: copy.common.components_ScheduleProgress_031 },
  ],
}

function getTimedPercent(progress: ScheduleProgressState, now: number): number {
  const estimatedTotalMs = getEstimatedTotalMs(progress, now)
  const waitingPercent = getWaitingPercent(progress.startedAt, now, estimatedTotalMs)
  if (!progress.completedAt) return waitingPercent
  const percentAtCompletion = getWaitingPercent(progress.startedAt, progress.completedAt, estimatedTotalMs)
  const completionElapsed = Math.max(0, now - progress.completedAt)
  const completionRatio = Math.min(1, completionElapsed / SCHEDULE_PROGRESS_COMPLETION_DURATION_MS)
  const easedCompletion = 1 - Math.pow(1 - completionRatio, 3)
  return percentAtCompletion + (100 - percentAtCompletion) * easedCompletion
}

function getEstimatedTotalMs(progress: ScheduleProgressState, now: number): number {
  const fallback = progress.estimatedDurationMs ?? ESTIMATED_DURATION_MS
  if (typeof progress.estimatedTotalMs === 'number' && Number.isFinite(progress.estimatedTotalMs) && progress.estimatedTotalMs > 0) {
    return progress.estimatedTotalMs
  }
  if (progress.estimatePhase === 'overdue') {
    return Math.max(fallback, now - progress.startedAt)
  }
  return fallback
}

function getWaitingPercent(startedAt: number, now: number, estimatedDurationMs: number): number {
  const elapsed = Math.max(0, now - startedAt)
  const safeDuration = Math.max(1_000, estimatedDurationMs)
  const ratio = Math.min(1, elapsed / safeDuration)
  return ratio * MAX_WAITING_PERCENT
}

function getTaskView(progress: ScheduleProgressState, percent: number, now: number) {
  const status = getTaskStatus(progress, percent, now)
  const reconnecting = progress.connectionStatus === 'reconnecting'
  const aheadCount = typeof progress.queuePosition === 'number' ? Math.max(0, progress.queuePosition - 1) : null
  const queueLabel = getQueueLabel(progress, aheadCount)
  const priorityLabel = progress.priority === 'priority_coupon' ? copy.common.components_ScheduleProgress_032 : progress.priority === 'paid' ? copy.common.components_ScheduleProgress_033 : progress.priority === 'analysis' ? copy.common.components_ScheduleProgress_034 : copy.common.components_ScheduleProgress_035
  const priorityClass = progress.priority === 'priority_coupon' || progress.priority === 'paid' || progress.priority === 'analysis'
    ? 'bg-brand-600/15 text-brand-300 ring-1 ring-brand-500/25'
    : 'bg-surface-2 text-ink-secondary ring-1 ring-surface-3'
  const jobLabel = progress.jobId ? `${copy.common.components_ScheduleProgress_036}${progress.jobId.slice(0, 8)}` : null
  const title = reconnecting ? copy.common.components_ScheduleProgress_037 : getStatusTitle(progress.mode, status)
  const remainingLabel = getRemainingLabel(progress, status, now)
  const estimateContext = getEstimateContext(progress, aheadCount)
  const detail = reconnecting
    ? copy.common.components_ScheduleProgress_038
    : getStatusDetail(progress, status, queueLabel, remainingLabel, estimateContext)
  const adjustmentLabel = reconnecting
    ? `${copy.common.components_ScheduleProgress_039}${Math.max(1, progress.consecutivePollFailures ?? 1)}${copy.common.components_ScheduleProgress_040}`
    : getAdjustmentLabel(progress, status)
  const syncAt = reconnecting ? progress.lastSuccessfulSyncAt : progress.lastUpdatedAt
  const syncLabel = syncAt ? formatSyncAge(now - syncAt) : copy.common.components_ScheduleProgress_041
  const elapsedLabel = formatElapsed(now - progress.startedAt)
  const footer = reconnecting
    ? copy.common.components_ScheduleProgress_042
    : adjustmentLabel
      ?? ((progress.priority === 'paid' || progress.priority === 'priority_coupon') && status === 'queued'
        ? `${progress.priority === 'priority_coupon' ? copy.common.components_ScheduleProgress_044 : copy.common.components_ScheduleProgress_045}${copy.common.components_ScheduleProgress_043}`
        : copy.common.components_ScheduleProgress_046)
  return {
    status,
    title,
    detail,
    adjustmentLabel,
    eyebrow: progress.mode === 'generate' ? copy.common.components_ScheduleProgress_047 : progress.mode === 'scenario' ? copy.common.components_ScheduleProgress_048 : copy.common.components_ScheduleProgress_049,
    meterLabel: getMeterLabel(status),
    priorityLabel,
    priorityClass,
    queueLabel,
    jobLabel,
    syncLabel,
    elapsedLabel,
    remainingLabel,
    footer,
    steps: TASK_STEPS[progress.mode],
    ariaText: `${title}，${getRemainingAriaLabel(progress, remainingLabel)}，${priorityLabel}，${queueLabel}`,
  }
}

function getTaskStatus(progress: ScheduleProgressState, percent: number, now: number): TaskStatus {
  if (progress.cancellationRequested) return 'cancelling'
  if (progress.executionPhase === 'retry_wait') return 'retrying'
  if (!progress.completedAt && progress.observedRunning && getCurrentRemainingMs(progress, now) === 0) return 'overdue'
  if (progress.completedAt || percent >= 100 || progress.estimatePhase === 'completed') return 'completed'
  if (progress.estimatePhase === 'overdue') return 'overdue'
  const isRunning = progress.observedRunning || progress.queueStatus === 'running' || progress.estimatePhase === 'running'
  if (isRunning && percent >= 92) return 'finishing'
  if (isRunning) return 'running'
  if (progress.queueStatus === 'queued' || progress.estimatePhase === 'queued') return 'queued'
  return 'preparing'
}

function getStatusTitle(mode: ScheduleProgressState['mode'], status: TaskStatus): string {
  if (status === 'cancelling') return copy.common.components_ScheduleProgress_101
  if (status === 'retrying') return copy.common.components_ScheduleProgress_102
  if (status === 'completed') return mode === 'generate' ? copy.common.components_ScheduleProgress_050 : mode === 'scenario' ? copy.common.components_ScheduleProgress_051 : copy.common.components_ScheduleProgress_052
  if (status === 'overdue') return copy.common.components_ScheduleProgress_053
  if (status === 'finishing') return copy.common.components_ScheduleProgress_054
  if (status === 'running') return mode === 'generate' ? copy.common.components_ScheduleProgress_055 : mode === 'scenario' ? copy.common.components_ScheduleProgress_056 : copy.common.components_ScheduleProgress_057
  if (status === 'queued') return copy.common.components_ScheduleProgress_058
  return copy.common.components_ScheduleProgress_059
}

function getStatusDetail(
  progress: ScheduleProgressState,
  status: TaskStatus,
  queueLabel: string,
  remainingLabel: string,
  estimateContext: string,
): string {
  if (status === 'cancelling') return copy.common.components_ScheduleProgress_103
  if (status === 'retrying') {
    const attempt = Math.max(1, progress.attemptCount ?? 1)
    return `${copy.common.components_ScheduleProgress_104}${attempt}${copy.common.components_ScheduleProgress_105}`
  }
  if (status === 'completed') return copy.common.components_ScheduleProgress_060
  if (status === 'overdue') return copy.common.components_ScheduleProgress_061
  if (status === 'finishing') return copy.common.components_ScheduleProgress_062
  if (status === 'running') return `${copy.common.components_ScheduleProgress_063}${remainingLabel}${copy.common.components_ScheduleProgress_064}`
  if (status === 'queued') {
    const priorityText = progress.priority === 'priority_coupon' ? copy.common.components_ScheduleProgress_065 : progress.priority === 'paid' ? copy.common.components_ScheduleProgress_066 : progress.priority === 'analysis' ? copy.common.components_ScheduleProgress_067 : copy.common.components_ScheduleProgress_068
    return `${priorityText}，${queueLabel}${copy.common.components_ScheduleProgress_069}${remainingLabel}${estimateContext ? `，${estimateContext}` : ''}。`
  }
  return copy.common.components_ScheduleProgress_070
}

function getQueueLabel(progress: ScheduleProgressState, aheadCount: number | null): string {
  if (progress.observedRunning || progress.queueStatus === 'running') return copy.common.components_ScheduleProgress_071
  if (progress.completedAt || progress.estimatePhase === 'completed') return copy.common.components_ScheduleProgress_072
  if (aheadCount === null) return progress.queueStatus === 'queued' ? copy.common.components_ScheduleProgress_073 : copy.common.components_ScheduleProgress_074
  if (aheadCount <= 0) return copy.common.components_ScheduleProgress_075
  return `${copy.common.components_ScheduleProgress_076}${aheadCount}${copy.common.components_ScheduleProgress_077}`
}

function getEstimateContext(progress: ScheduleProgressState, aheadCount: number | null): string {
  if (progress.queueStatus !== 'queued') return ''
  if (aheadCount === null) return ''
  if (aheadCount <= 0) return ''
  return `${copy.common.components_ScheduleProgress_078}${aheadCount}${copy.common.components_ScheduleProgress_079}`
}

function getAdjustmentLabel(progress: ScheduleProgressState, status: TaskStatus): string | undefined {
  if (status === 'overdue') return copy.common.components_ScheduleProgress_080
  return progress.estimateAdjustment
}

function getRemainingLabel(progress: ScheduleProgressState, status: TaskStatus, now: number): string {
  if (progress.completedAt || progress.estimatePhase === 'completed') return copy.common.components_ScheduleProgress_081
  if (status === 'overdue' || progress.estimatePhase === 'overdue' || progress.estimatedRemainingMs === null) return copy.common.components_ScheduleProgress_082
  if (status === 'finishing') return copy.common.components_ScheduleProgress_083
  const currentRemainingMs = getCurrentRemainingMs(progress, now)
  if (currentRemainingMs !== null) return `${copy.common.components_ScheduleProgress_084}${formatDuration(currentRemainingMs, 'ceil')}`
  const fallbackRemainingMs = Math.max(0, (progress.estimatedDurationMs ?? ESTIMATED_DURATION_MS) - Math.max(0, now - progress.startedAt))
  return `${copy.common.components_ScheduleProgress_085}${formatDuration(fallbackRemainingMs, 'ceil')}`
}

function getCurrentRemainingMs(progress: ScheduleProgressState, now: number): number | null {
  if (typeof progress.estimatedRemainingMs === 'number' && Number.isFinite(progress.estimatedRemainingMs)) {
    const updatedAt = parseEstimateUpdatedAt(progress)
    const elapsedSinceUpdate = updatedAt === null ? 0 : Math.max(0, now - updatedAt)
    return Math.max(0, progress.estimatedRemainingMs - elapsedSinceUpdate)
  }
  if (typeof progress.estimatedTotalMs === 'number' && Number.isFinite(progress.estimatedTotalMs) && progress.estimatedTotalMs > 0) {
    return Math.max(0, progress.estimatedTotalMs - Math.max(0, now - progress.startedAt))
  }
  return null
}

function parseEstimateUpdatedAt(progress: ScheduleProgressState): number | null {
  const parsed = Date.parse(progress.estimateUpdatedAt ?? '')
  if (Number.isFinite(parsed)) return parsed
  return typeof progress.lastUpdatedAt === 'number' && Number.isFinite(progress.lastUpdatedAt) ? progress.lastUpdatedAt : null
}

function getRemainingAriaLabel(progress: ScheduleProgressState, remainingLabel: string): string {
  if (remainingLabel === copy.common.components_ScheduleProgress_086 || progress.estimatePhase === 'overdue' || progress.estimatedRemainingMs === null) return copy.common.components_ScheduleProgress_087
  if (remainingLabel === copy.common.components_ScheduleProgress_088) return copy.common.components_ScheduleProgress_089
  return `${copy.common.components_ScheduleProgress_090}${remainingLabel}`
}

function getMeterLabel(status: TaskStatus): string {
  if (status === 'retrying') return 'Retry'
  if (status === 'cancelling') return 'Cancel'
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Running'
  if (status === 'overdue') return 'Calibrate'
  if (status === 'finishing') return 'Final'
  if (status === 'completed') return 'Done'
  return 'Init'
}

function getStepState(status: TaskStatus, index: number): StepVisualState {
  const activeIndex = status === 'preparing' ? 0 : status === 'queued' || status === 'retrying' ? 1 : status === 'running' || status === 'overdue' || status === 'cancelling' ? 2 : 3
  if (status === 'completed') return 'done'
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'pending'
}

function getStepClass(state: StepVisualState): string {
  if (state === 'done') return 'border-brand-500/25 bg-brand-600/10'
  if (state === 'active') return 'border-brand-500/40 bg-surface-2'
  return 'border-surface-3/70 bg-surface-2/35'
}

function getStepDotClass(state: StepVisualState): string {
  if (state === 'done') return 'border-brand-500 bg-brand-500 text-white'
  if (state === 'active') return 'border-brand-400 text-brand-400'
  return 'border-surface-4 text-ink-muted'
}

function formatElapsed(ms: number): string {
  return formatDuration(ms, 'floor')
}

function formatDuration(ms: number, rounding: 'ceil' | 'floor'): string {
  const rawSeconds = Math.max(0, ms / 1000)
  const seconds = rounding === 'ceil' ? Math.ceil(rawSeconds) : Math.floor(rawSeconds)
  if (seconds < 60) return `${seconds}${copy.common.components_ScheduleProgress_091}`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes}${copy.common.components_ScheduleProgress_092}${rest}${copy.common.components_ScheduleProgress_093}` : `${minutes}${copy.common.components_ScheduleProgress_094}`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest > 0 ? `${hours}${copy.common.components_ScheduleProgress_095}${minuteRest}${copy.common.components_ScheduleProgress_096}` : `${hours}${copy.common.components_ScheduleProgress_097}`
}

function formatSyncAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds <= 2) return copy.common.components_ScheduleProgress_098
  if (seconds < 60) return `${seconds}${copy.common.components_ScheduleProgress_099}`
  return `${Math.floor(seconds / 60)}${copy.common.components_ScheduleProgress_100}`
}
