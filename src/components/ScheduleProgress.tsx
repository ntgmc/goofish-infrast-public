import { useEffect, useMemo, useState, type CSSProperties } from 'react'

export type ScheduleEstimatePhase = 'queued' | 'running' | 'overdue' | 'completed' | 'failed'

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
  priority?: 'paid' | 'analysis' | 'standard';
  jobId?: string;
  observedRunning?: boolean;
  percentFloor?: number;
  lastUpdatedAt?: number;
  connectionStatus?: 'connected' | 'reconnecting';
  consecutivePollFailures?: number;
  lastSuccessfulSyncAt?: number;
}

interface Props {
  progress: ScheduleProgressState;
  className?: string;
  variant?: 'embedded' | 'focus';
}

type TaskStatus = 'preparing' | 'queued' | 'running' | 'overdue' | 'finishing' | 'completed'
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
  const meterSizeClass = compact ? 'h-24 w-24' : 'h-28 w-28 sm:h-32 sm:w-32'
  const meterStyle = {
    background: `conic-gradient(var(--color-brand-500) ${percent * 3.6}deg, color-mix(in oklch, var(--color-surface-3) 82%, transparent) 0deg)`,
  } satisfies CSSProperties

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
      className={`schedule-task-shell rounded-xl border border-surface-3 bg-surface-1 ${compact ? 'p-4' : 'p-5 sm:p-6'} ${className}`}
      data-status={task.status}
      aria-live="polite"
      aria-label={progress.mode === 'generate' ? '排班生成任务状态' : progress.mode === 'scenario' ? '场景对比任务状态' : '练度建议任务状态'}
    >
      <div className="relative z-10">
        <div className={`flex ${compact ? 'flex-col gap-4 sm:flex-row sm:items-center' : 'flex-col gap-5 md:flex-row md:items-center'}`}>
          <div className={`schedule-task-meter relative grid shrink-0 place-items-center rounded-full ${meterSizeClass}`} style={meterStyle}>
            <div className="grid h-[calc(100%-14px)] w-[calc(100%-14px)] place-items-center rounded-full border border-surface-3 bg-surface-1 shadow-inner">
              <div className="text-center">
                <div className="text-[11px] font-semibold uppercase text-ink-muted">{task.meterLabel}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-ink-primary">{percent}%</div>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase text-brand-300">{task.eyebrow}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${task.priorityClass}`}>{task.priorityLabel}</span>
              {task.jobLabel && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">{task.jobLabel}</span>}
            </div>
            <h3 className={`${compact ? 'mt-2 text-base' : 'mt-3 text-lg'} font-semibold text-ink-primary`}>{task.title}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">{task.detail}</p>
            {task.adjustmentLabel && (
              <p className="mt-2 inline-flex max-w-full rounded-full border border-brand-500/25 bg-brand-600/10 px-2.5 py-1 text-xs font-medium leading-5 text-brand-200">
                {task.adjustmentLabel}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 sm:w-[25rem]">
            <TaskMiniStat label="预计还需" value={task.remainingLabel} emphasis={task.status === 'overdue'} />
            <TaskMiniStat label="已等待" value={task.elapsedLabel} />
            <TaskMiniStat label="同步" value={task.syncLabel} />
          </div>
        </div>

        <div className={`${compact ? 'mt-4' : 'mt-5'} grid gap-2 sm:grid-cols-4`}>
          {task.steps.map((step, index) => (
            <TaskStep key={step.label} label={step.label} detail={step.detail} state={getStepState(task.status, index)} />
          ))}
        </div>

        <div className="mt-4">
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={task.ariaText}
          >
            <div
              className="schedule-task-fill h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          {!compact && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-ink-muted">
              <span>{task.footer}</span>
              <span className="tabular-nums">{task.queueLabel}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function TaskMiniStat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2 ${emphasis ? 'border-brand-500/35 bg-brand-600/10' : 'border-surface-3/70 bg-surface-2/60'}`}>
      <p className="text-[11px] font-medium text-ink-muted">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold tabular-nums text-ink-primary" title={value}>{value}</p>
    </div>
  )
}

function TaskStep({ label, detail, state }: { label: string; detail: string; state: StepVisualState }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors duration-200 ${getStepClass(state)}`}>
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
    { label: '提交请求', detail: '校验授权、配置和风控结果。' },
    { label: '进入队列', detail: '按优先级等待 worker 领取。' },
    { label: '开始计算', detail: '搜索当前基建的最优排班。' },
    { label: '整理结果', detail: '汇总方案、效率和练度建议。' },
  ],
  apply: [
    { label: '提交建议', detail: '确认练度任务和当前配置。' },
    { label: '进入队列', detail: '等待后台领取重新计算。' },
    { label: '重新计算', detail: '应用练度变化并生成最终方案。' },
    { label: '生成最终方案', detail: '整理可下载结果和效率对比。' },
  ],
  scenario: [
    { label: '校验组合', detail: '检查账号权限、场景因子和运行上限。' },
    { label: '进入队列', detail: '等待高级分析 worker 领取任务。' },
    { label: '快速筛选', detail: '计算全部场景；自动非固定模式同时选择班次数组。' },
    { label: '精确复核', detail: '按实际操作成本分组，冻结候选班次后生成 Pareto 前沿。' },
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
  const priorityLabel = progress.priority === 'paid' ? '付费优先' : progress.priority === 'analysis' ? '高级分析' : '普通队列'
  const priorityClass = progress.priority === 'paid' || progress.priority === 'analysis'
    ? 'bg-brand-600/15 text-brand-300 ring-1 ring-brand-500/25'
    : 'bg-surface-2 text-ink-secondary ring-1 ring-surface-3'
  const jobLabel = progress.jobId ? `任务 #${progress.jobId.slice(0, 8)}` : null
  const title = reconnecting ? '连接恢复中' : getStatusTitle(progress.mode, status)
  const remainingLabel = getRemainingLabel(progress, status, now)
  const estimateContext = getEstimateContext(progress, aheadCount)
  const detail = reconnecting
    ? '暂时无法同步最新状态，任务仍在后台执行，连接恢复后会自动继续。'
    : getStatusDetail(progress, status, queueLabel, remainingLabel, estimateContext)
  const adjustmentLabel = reconnecting
    ? `正在进行第 ${Math.max(1, progress.consecutivePollFailures ?? 1)} 次重连`
    : getAdjustmentLabel(progress, status)
  const syncAt = reconnecting ? progress.lastSuccessfulSyncAt : progress.lastUpdatedAt
  const syncLabel = syncAt ? formatSyncAge(now - syncAt) : '等待同步'
  const elapsedLabel = formatElapsed(now - progress.startedAt)
  const footer = reconnecting
    ? '不会重复提交任务；当前任务完成后仍会自动展示结果。'
    : adjustmentLabel
      ?? (progress.priority === 'paid' && status === 'queued'
        ? '优先领取已生效；不会中断正在运行的任务。'
        : '页面可保持打开，结果完成后会自动展示。')
  return {
    status,
    title,
    detail,
    adjustmentLabel,
    eyebrow: progress.mode === 'generate' ? '排班优化任务' : progress.mode === 'scenario' ? '场景对比任务' : '练度建议任务',
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
  if (status === 'completed') return mode === 'generate' ? '排班方案已就绪' : mode === 'scenario' ? '场景前沿已就绪' : '最终方案已就绪'
  if (status === 'overdue') return '正在校准预估'
  if (status === 'finishing') return '即将完成'
  if (status === 'running') return mode === 'generate' ? '正在计算排班' : mode === 'scenario' ? '正在比较场景' : '正在重新计算'
  if (status === 'queued') return '已加入队列'
  return '正在提交任务'
}

function getStatusDetail(
  progress: ScheduleProgressState,
  status: TaskStatus,
  queueLabel: string,
  remainingLabel: string,
  estimateContext: string,
): string {
  if (status === 'completed') return '正在展示结果。'
  if (status === 'overdue') return '已超过当前预估，后台仍在计算，完成后会自动展示。'
  if (status === 'finishing') return '后台计算已进入收尾阶段，结果完成后会自动展示。'
  if (status === 'running') return `任务已开始执行，预计还需 ${remainingLabel}，会随实际耗时自动校准。`
  if (status === 'queued') {
    const priorityText = progress.priority === 'paid' ? '付费优先队列' : progress.priority === 'analysis' ? '高级分析队列' : '普通队列'
    return `${priorityText}，${queueLabel}，预计还需 ${remainingLabel}${estimateContext ? `，${estimateContext}` : ''}。`
  }
  return '正在提交优化请求，完成校验后会进入后台队列。'
}

function getQueueLabel(progress: ScheduleProgressState, aheadCount: number | null): string {
  if (progress.observedRunning || progress.queueStatus === 'running') return '任务已开始执行'
  if (progress.completedAt || progress.estimatePhase === 'completed') return '结果已返回'
  if (aheadCount === null) return progress.queueStatus === 'queued' ? '等待队列同步' : '等待提交'
  if (aheadCount <= 0) return '即将开始'
  return `前方还有 ${aheadCount} 个任务`
}

function getEstimateContext(progress: ScheduleProgressState, aheadCount: number | null): string {
  if (progress.queueStatus !== 'queued') return ''
  if (aheadCount === null) return ''
  if (aheadCount <= 0) return ''
  return `含前方 ${aheadCount} 个任务`
}

function getAdjustmentLabel(progress: ScheduleProgressState, status: TaskStatus): string | undefined {
  if (status === 'overdue') return '已超过预估，后台仍在计算'
  return progress.estimateAdjustment
}

function getRemainingLabel(progress: ScheduleProgressState, status: TaskStatus, now: number): string {
  if (progress.completedAt || progress.estimatePhase === 'completed') return '约 0 秒'
  if (status === 'overdue' || progress.estimatePhase === 'overdue' || progress.estimatedRemainingMs === null) return '正在校准'
  if (status === 'finishing') return '即将完成'
  const currentRemainingMs = getCurrentRemainingMs(progress, now)
  if (currentRemainingMs !== null) return `约 ${formatDuration(currentRemainingMs, 'ceil')}`
  const fallbackRemainingMs = Math.max(0, (progress.estimatedDurationMs ?? ESTIMATED_DURATION_MS) - Math.max(0, now - progress.startedAt))
  return `约 ${formatDuration(fallbackRemainingMs, 'ceil')}`
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
  if (remainingLabel === '正在校准' || progress.estimatePhase === 'overdue' || progress.estimatedRemainingMs === null) return '预计耗时正在校准'
  if (remainingLabel === '即将完成') return '预计即将完成'
  return `预计还需${remainingLabel}`
}

function getMeterLabel(status: TaskStatus): string {
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Running'
  if (status === 'overdue') return 'Calibrate'
  if (status === 'finishing') return 'Final'
  if (status === 'completed') return 'Done'
  return 'Init'
}

function getStepState(status: TaskStatus, index: number): StepVisualState {
  const activeIndex = status === 'preparing' ? 0 : status === 'queued' ? 1 : status === 'running' || status === 'overdue' ? 2 : 3
  if (status === 'completed') return 'done'
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'pending'
}

function getStepClass(state: StepVisualState): string {
  if (state === 'done') return 'border-brand-500/25 bg-brand-600/10'
  if (state === 'active') return 'border-brand-500/40 bg-surface-2 shadow-[0_0_0_1px_rgba(59,130,246,0.08)]'
  return 'border-surface-3/70 bg-surface-2/35'
}

function getStepDotClass(state: StepVisualState): string {
  if (state === 'done') return 'border-brand-500 bg-brand-500 text-white'
  if (state === 'active') return 'border-brand-400 text-brand-400 schedule-task-dot'
  return 'border-surface-4 text-ink-muted'
}

function formatElapsed(ms: number): string {
  return formatDuration(ms, 'floor')
}

function formatDuration(ms: number, rounding: 'ceil' | 'floor'): string {
  const rawSeconds = Math.max(0, ms / 1000)
  const seconds = rounding === 'ceil' ? Math.ceil(rawSeconds) : Math.floor(rawSeconds)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest > 0 ? `${hours} 小时 ${minuteRest} 分` : `${hours} 小时`
}

function formatSyncAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds <= 2) return '刚刚同步'
  if (seconds < 60) return `${seconds} 秒前`
  return `${Math.floor(seconds / 60)} 分钟前`
}
