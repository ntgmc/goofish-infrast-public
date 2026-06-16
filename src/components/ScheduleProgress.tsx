import { useEffect, useMemo, useState } from 'react'

export interface ScheduleProgressState {
  mode: 'generate' | 'apply';
  startedAt: number;
  completedAt?: number;
  estimatedDurationMs?: number;
}

interface Props {
  progress: ScheduleProgressState;
  className?: string;
}

export default function ScheduleProgress({ progress, className = '' }: Props) {
  const [rawPercent, setRawPercent] = useState(() => getTimedPercent(progress, Date.now()))
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)))
  const progressCopy = useMemo(() => getProgressCopy(progress.mode, rawPercent), [progress.mode, rawPercent])

  useEffect(() => {
    let frame = 0

    const tick = () => {
      const nextPercent = getTimedPercent(progress, Date.now())
      setRawPercent(nextPercent)
      if (nextPercent < 100) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    tick()
    return () => window.cancelAnimationFrame(frame)
  }, [progress])

  return (
    <div
      className={`rounded-xl bg-surface-2/70 p-4 ${className}`}
      aria-live="polite"
      aria-label={progress.mode === 'generate' ? '排班生成进度' : '重新计算进度'}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-primary">{progressCopy.label}</p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">{progressCopy.detail}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-1 px-2.5 py-1 text-xs font-semibold tabular-nums text-brand-400">
          {percent}%
        </span>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${progressCopy.label}，${percent}%`}
      >
        <div
          className="schedule-progress-fill h-full rounded-full bg-brand-500"
          style={{ width: `${rawPercent}%` }}
        />
      </div>

      <div className="mt-4 grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
        {progressCopy.steps.map((step, index) => {
          const done = index < progressCopy.stepIndex || percent === 100
          const current = index === progressCopy.stepIndex && percent < 100
          return (
            <div
              key={step}
              className={`flex items-center gap-2 ${current ? 'font-medium text-ink-primary' : ''}`}
            >
              <span
                className={`
                  flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold
                  ${done ? 'bg-success text-white' : current ? 'bg-brand-500 text-white' : 'bg-surface-1 text-ink-muted'}
                `}
                aria-hidden="true"
              >
                {done ? '✓' : index + 1}
              </span>
              <span className="min-w-0 truncate">{step}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ESTIMATED_DURATION_MS = 10_000
export const SCHEDULE_PROGRESS_COMPLETION_DURATION_MS = 420
const MAX_WAITING_PERCENT = 96

const PROGRESS_COPY: Record<ScheduleProgressState['mode'], Array<{ label: string; detail: string; step: string }>> = {
  generate: [
    {
      label: '分析当前配置',
      detail: '正在计算当前练度下的最优排班。',
      step: '分析配置',
    },
    {
      label: '评估升级空间',
      detail: '正在对比潜在精英化收益，筛选值得查看的建议。',
      step: '评估升级',
    },
    {
      label: '整理排班结果',
      detail: '正在汇总方案、效率数据和升级建议。',
      step: '整理结果',
    },
  ],
  apply: [
    {
      label: '应用练度建议',
      detail: '正在写入勾选的练度调整。',
      step: '应用建议',
    },
    {
      label: '重新计算排班',
      detail: '正在根据新的练度组合搜索排班方案。',
      step: '重新计算',
    },
    {
      label: '生成最终方案',
      detail: '正在整理可保存和可下载的最终结果。',
      step: '生成方案',
    },
  ],
}

function getTimedPercent(progress: ScheduleProgressState, now: number): number {
  const estimatedDurationMs = progress.estimatedDurationMs ?? ESTIMATED_DURATION_MS
  const waitingPercent = getWaitingPercent(progress.startedAt, now, estimatedDurationMs)

  if (!progress.completedAt) {
    return waitingPercent
  }

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

function getProgressCopy(mode: ScheduleProgressState['mode'], percent: number) {
  const stages = PROGRESS_COPY[mode]
  const stepIndex = Math.min(stages.length - 1, Math.floor((Math.min(percent, 99.9) / 100) * stages.length))
  const current = stages[stepIndex]

  return {
    label: percent >= 100 ? (mode === 'generate' ? '排班方案已就绪' : '最终方案已就绪') : current.label,
    detail: percent >= 100 ? '正在展示结果。' : current.detail,
    stepIndex,
    steps: stages.map((stage) => stage.step),
  }
}
