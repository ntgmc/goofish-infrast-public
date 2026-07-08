import type { LicenseConfig } from '../../../lib/types'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import ScheduleProgress, { type ScheduleProgressState } from '../../../components/ScheduleProgress'
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
  config: LicenseConfig;
  configChanged: boolean;
  showConfigDetails: boolean;
  operatorCount: number;
  configPresetLabel: string;
  validation: ValidationState;
  loading: boolean;
  syncing: boolean;
  progress: ScheduleProgressState | null;
  hasResult: boolean;
  resultIsCurrent: boolean;
  error: string | null;
  extraDisabledReason?: string | null;
  onGenerate: () => void;
  onReset: () => void;
}) {
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const readyLabel = resultIsCurrent ? '方案已是最新' : hasResult ? '已有结果' : '待生成'
  const configLabel = showConfigDetails
    ? `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${config.layout} · ${config.desc}`
    : `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${configPresetLabel}`

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-400">生成控制</span>
            <span className={`inline-flex w-max shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
              resultIsCurrent
                ? 'bg-brand-600/15 text-brand-300'
                : hasResult
                  ? 'bg-warning/10 text-warning'
                  : 'bg-surface-2 text-ink-secondary'
            }`}>
              {readyLabel}
            </span>
            {configChanged && (
              <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                配置已调整
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)] xl:grid-cols-[minmax(120px,0.24fr)_minmax(0,1fr)_minmax(120px,0.24fr)]">
            <DashboardMiniStat label="干员数据" value={`${operatorCount} 名`} />
            <DashboardMiniStat label="当前配置" value={configLabel} />
            <DashboardMiniStat label="配置状态" value={configChanged ? '已调整' : '未改动'} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:w-64">
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading || syncing || !validation.ok || resultIsCurrent || Boolean(extraDisabledReason)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
          >
            {loading || syncing ? (
              <span className="inline-flex w-max shrink-0 items-center gap-3 whitespace-nowrap">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {syncing ? '正在同步授权...' : progress?.queueStatus === 'queued' ? '排队中...' : '正在计算...'}
              </span>
            ) : resultIsCurrent ? '方案已是最新' : hasResult ? '重新计算排班' : '生成排班方案'}
          </button>
          {resultIsCurrent && (
            <p className="text-xs leading-5 text-ink-muted">修改配置或干员数据后才需要重新计算。</p>
          )}
          {!validation.ok && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">{validation.message}</p>
          )}
          {extraDisabledReason && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">{extraDisabledReason}</p>
          )}
        </div>
      </div>
      {loading && progress && (
        <div className="border-t border-surface-3/60 px-4 py-4 sm:px-5">
          <ScheduleProgress progress={progress} />
        </div>
      )}
      {error && (
        <div className="border-t border-surface-3/60 px-4 py-4 sm:px-5">
          <InlineErrorPanel message={error} onRetry={onGenerate} onReset={onReset} />
        </div>
      )}
    </section>
  )
}

export function DashboardMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink-primary" title={value}>{value}</p>
    </div>
  )
}
