import ScheduleProgress, { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import type { LicenseConfig } from '../../../lib/types'
import { InlineErrorPanel } from './feedback'
import type { ValidationState } from './types'

export default function GenerateControlBar({
  config,
  configChanged,
  showConfigDetails,
  operatorCount,
  configPresetLabel,
  validation,
  loading,
  syncing,
  progress,
  hasResult,
  resultIsCurrent,
  error,
  extraDisabledReason,
  onGenerate,
  onReset,
}: {
  config: LicenseConfig
  configChanged: boolean
  showConfigDetails: boolean
  operatorCount: number
  configPresetLabel: string
  validation: ValidationState
  loading: boolean
  syncing: boolean
  progress: ScheduleProgressState | null
  hasResult: boolean
  resultIsCurrent: boolean
  error: string | null
  extraDisabledReason?: string | null
  onGenerate: () => void
  onReset: () => void
}) {
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const readyLabel = resultIsCurrent ? '方案已是最新' : hasResult ? '已有历史结果' : '待生成'
  const busyLabel = syncing
    ? '正在同步授权…'
    : progress?.queueStatus === 'queued'
      ? '正在排队…'
      : progress?.completedAt
        ? '正在整理结果…'
        : '正在计算…'
  const configLabel = showConfigDetails
    ? `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${config.layout} · ${config.desc}`
    : `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${configPresetLabel}`
  const readinessClass = resultIsCurrent
    ? 'tool-status--current'
    : hasResult
      ? 'tool-status--warning'
      : ''

  return (
    <section className="tool-panel overflow-hidden" aria-labelledby="generate-control-title">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="tool-eyebrow">排班计算</p>
            <span className={`tool-status ${readinessClass}`}>{readyLabel}</span>
            {configChanged && <span className="tool-status tool-status--warning">配置已调整</span>}
          </div>
          <h2 id="generate-control-title" className="mt-2 text-lg font-semibold text-ink-primary">
            {resultIsCurrent ? '当前结果已匹配工作区' : '准备生成排班方案'}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">
            计算会使用当前干员数据和基建配置。生成完成后可直接下载 MAA JSON，并按需查看效率明细。
          </p>
          <div className="mt-5 grid gap-3 border-y border-surface-3 py-4 sm:grid-cols-[minmax(7rem,0.5fr)_minmax(0,1fr)_minmax(7rem,0.5fr)]" role="group" aria-label="当前生成输入">
            <DashboardMiniStat label="干员数据" value={`${operatorCount} 名`} />
            <DashboardMiniStat label="当前配置" value={configLabel} />
            <DashboardMiniStat label="配置状态" value={configChanged ? '已调整' : '未改动'} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading || syncing || !validation.ok || resultIsCurrent || Boolean(extraDisabledReason)}
            className="tool-primary-action w-full"
          >
            {loading || syncing ? (
              <span className="inline-flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {busyLabel}
              </span>
            ) : resultIsCurrent ? '方案已是最新' : hasResult ? '重新计算排班' : '生成排班方案'}
          </button>
          {resultIsCurrent && <p className="text-xs leading-5 text-ink-muted">修改配置或干员数据后，才需要重新计算。</p>}
          {!validation.ok && <p className="tool-alert tool-alert--warning px-3 py-2 text-xs leading-5" role="alert">{validation.message}</p>}
          {extraDisabledReason && <p className="tool-alert tool-alert--warning px-3 py-2 text-xs leading-5" role="status" aria-live="polite">{extraDisabledReason}</p>}
        </div>
      </div>

      {loading && progress && (
        <div className="tool-panel-header px-5 py-5 sm:px-6">
          <ScheduleProgress progress={progress} variant="embedded" />
        </div>
      )}
      {error && (
        <div className="tool-panel-header px-5 py-5 sm:px-6">
          <InlineErrorPanel message={error} onRetry={onGenerate} onReset={onReset} />
        </div>
      )}
    </section>
  )
}

export function DashboardMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l border-surface-3 pl-3 first:border-l-0 first:pl-0">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink-primary" title={value}>{value}</p>
    </div>
  )
}
