import { useEffect, useMemo, useState, type CSSProperties } from 'react'

export interface ScheduleProgressState {
  mode: 'generate' | 'apply';
  startedAt: number;
  completedAt?: number;
  estimatedDurationMs?: number;
  queueStatus?: 'queued' | 'running';
  queuePosition?: number | null;
  priority?: 'paid' | 'standard';
  jobId?: string;
  lastUpdatedAt?: number;
}

interface Props {
  progress: ScheduleProgressState;
  className?: string;
  variant?: 'embedded' | 'focus';
}

type TaskStatus = 'preparing' | 'queued' | 'running' | 'finishing' | 'completed'
type StepVisualState = 'done' | 'active' | 'pending'

export default function ScheduleProgress({ progress, className = '', variant = 'embedded' }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const rawPercent = getTimedPercent(progress, now)
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)))
  const task = useMemo(() => getTaskView(progress, rawPercent, now), [progress, rawPercent, now])
  const compact = variant === 'embedded'
  const meterSizeClass = compact ? 'h-24 w-24' : 'h-28 w-28 sm:h-32 sm:w-32'
  const meterStyle = {
    background: `conic-gradient(var(--color-brand-500) ${percent * 3.6}deg, color-mix(in oklch, var(--color-surface-3) 82%, transparent) 0deg)`,
  } satisfies CSSProperties

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
      aria-label={progress.mode === 'generate' ? '排班生成任务状态' : '重新计算任务状态'}
    >
      <div className={`grid gap-4 ${compact ? 'sm:grid-cols-[auto,minmax(0,1fr)]' : 'md:grid-cols-[auto,minmax(0,1fr)] md:items-center'}`}>
        <div className={`${meterSizeClass} schedule-task-meter relative shrink-0 rounded-full p-1.5`} style={meterStyle}>
          <div className="grid h-full w-full place-items-center rounded-full border border-surface-3 bg-surface-1 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink-primary">{percent}%</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{task.meterLabel}</p>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-brand-400">{task.eyebrow}</span>
                <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ${task.priorityClass}`}>
                  {task.priorityLabel}
                </span>
                {task.jobLabel && (
                  <span className="inline-flex max-w-full items-center rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-muted">
                    {task.jobLabel}
                  </span>
                )}
              </div>
              <h3 className={`${compact ? 'mt-2 text-base' : 'mt-3 text-lg'} font-semibold text-ink-primary`}>
                {task.title}
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">{task.detail}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:w-52">
              <TaskMiniStat label="已等待" value={task.elapsedLabel} />
              <TaskMiniStat label="同步" value={task.syncLabel} />
            </div>
          </div>

          <div className={`${compact ? 'mt-4' : 'mt-5'} grid gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-4'}`}>
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
      </div>
    </section>
  )
}

function TaskMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-surface-3/70 bg-surface-2/60 px-3 py-2">
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
        <span className="min-w-0 truncate text-xs font-semibold text-ink-primary">{label}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-muted">{detail}</p>
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
    { label: '提交建议', detail: '写入勾选的练度调整。' },
    { label: '进入队列', detail: '等待后台任务领取。' },
    { label: '重新计算', detail: '根据新的练度组合搜索方案。' },
    { label: '生成方案', detail: '整理最终结果和可下载文件。' },
  ],
}

function getTimedPercent(progress: ScheduleProgressState, now: number): number {
  const estimatedDurationMs = progress.estimatedDurationMs ?? ESTIMATED_DURATION_MS
  const waitingPercent = getWaitingPercent(progress.startedAt, now, estimatedDurationMs)
  if (!progress.completedAt) return waitingPercent
  const percentAtCompletion = getWaitingPercent(progress.startedAt, progress.completedAt, estimatedDurationMs)
  const completionElapsed = Math.max(0, now - progress.completedAt)
  const completionRatio = Math.min(1, completionElapsed / SCHEDULE_PROGRESS_COMPLETION_DURATION_MS)
  const easedCompletion = 1 - Math.pow(1 - completionRatio, 3)
  return percentAtCompletion + (100 - percentAtCompletion) * easedCompletion
}

function getWaitingPercent(startedAt: number, now: number, estimatedDurationMs: number): number {
  const elapsed = Math.max(0, now - startedAt)
  const ratio = Math.min(1, elapsed / estimatedDurationMs)
  return ratio * MAX_WAITING_PERCENT
}

function getTaskView(progress: ScheduleProgressState, percent: number, now: number) {
  const status = getTaskStatus(progress, percent)
  const aheadCount = typeof progress.queuePosition === 'number' ? Math.max(0, progress.queuePosition - 1) : null
  const queueLabel = getQueueLabel(progress, aheadCount)
  const priorityLabel = progress.priority === 'paid' ? '付费优先' : '普通队列'
  const priorityClass = progress.priority === 'paid'
    ? 'bg-brand-600/15 text-brand-300 ring-1 ring-brand-500/25'
    : 'bg-surface-2 text-ink-secondary ring-1 ring-surface-3'
  const jobLabel = progress.jobId ? `任务 #${progress.jobId.slice(0, 8)}` : null
  const title = getStatusTitle(progress.mode, status)
  const detail = getStatusDetail(progress, status, queueLabel)
  const syncLabel = progress.lastUpdatedAt ? formatSyncAge(now - progress.lastUpdatedAt) : '等待同步'
  const elapsedLabel = formatElapsed(now - progress.startedAt)
  const footer = progress.priority === 'paid' && status === 'queued'
    ? '优先领取已生效；不会中断正在运行的任务。'
    : '页面可保持打开，结果完成后会自动展示。'

  return {
    status,
    title,
    detail,
    eyebrow: progress.mode === 'generate' ? '排班优化任务' : '练度建议任务',
    meterLabel: getMeterLabel(status),
    priorityLabel,
    priorityClass,
    queueLabel,
    jobLabel,
    syncLabel,
    elapsedLabel,
    footer,
    steps: TASK_STEPS[progress.mode],
    ariaText: `${title}，${priorityLabel}，${queueLabel}`,
  }
}

function getTaskStatus(progress: ScheduleProgressState, percent: number): TaskStatus {
  if (progress.completedAt || percent >= 100) return 'completed'
  if (percent >= 92) return 'finishing'
  if (progress.queueStatus === 'queued') return 'queued'
  if (progress.queueStatus === 'running') return 'running'
  return 'preparing'
}

function getStatusTitle(mode: ScheduleProgressState['mode'], status: TaskStatus): string {
  if (status === 'completed') return mode === 'generate' ? '排班方案已就绪' : '最终方案已就绪'
  if (status === 'finishing') return '即将完成'
  if (status === 'running') return mode === 'generate' ? '正在计算排班' : '正在重新计算'
  if (status === 'queued') return '已加入队列'
  return '正在提交任务'
}

function getStatusDetail(progress: ScheduleProgressState, status: TaskStatus, queueLabel: string): string {
  if (status === 'completed') return '正在展示结果。'
  if (status === 'finishing') return '后台计算已进入收尾阶段，结果完成后会自动展示。'
  if (status === 'running') return '任务已开始执行，正在占用独立 worker 计算，不会阻塞页面操作。'
  if (status === 'queued') {
    const priorityText = progress.priority === 'paid' ? '付费优先队列' : '普通队列'
    return `${priorityText}，${queueLabel}，后台会自动领取任务。`
  }
  return '正在提交优化请求，完成校验后会进入后台队列。'
}

function getQueueLabel(progress: ScheduleProgressState, aheadCount: number | null): string {
  if (progress.queueStatus === 'running') return '任务已开始执行'
  if (progress.completedAt) return '结果已返回'
  if (aheadCount === null) return progress.queueStatus === 'queued' ? '等待队列同步' : '等待提交'
  if (aheadCount <= 0) return '即将开始'
  return `前方还有 ${aheadCount} 个任务`
}

function getMeterLabel(status: TaskStatus): string {
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Running'
  if (status === 'finishing') return 'Final'
  if (status === 'completed') return 'Done'
  return 'Init'
}

function getStepState(status: TaskStatus, index: number): StepVisualState {
  const activeIndex = status === 'preparing' ? 0 : status === 'queued' ? 1 : status === 'running' ? 2 : 3
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
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes} 分 ${rest} 秒`
}

function formatSyncAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds <= 2) return '刚刚同步'
  if (seconds < 60) return `${seconds} 秒前`
  return `${Math.floor(seconds / 60)} 分钟前`
}
