import type { ReactNode } from 'react'
import ScheduleProgress, { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import InfoTooltip from '../../../components/InfoTooltip'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import type { LicenseConfig, PriorityCouponBalance } from '../../../lib/types'
import { InlineErrorPanel } from './feedback'
import type { ValidationState } from './types'
import { copy, CURRENT_LOCALE } from '../../../copy/index'


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
  priorityCoupon,
  additionalCoupons = [],
  extraDisabledReason,
  onGenerate,
  onReset,
  onOpenConfig,
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
  priorityCoupon: { balance: PriorityCouponBalance | null; selected: boolean; onChange: (selected: boolean) => void }
  additionalCoupons?: Array<{ id: string; label: string; help: string; balance: number; selected: boolean; onChange: (selected: boolean) => void }>
  extraDisabledReason?: string | null
  onGenerate: () => void
  onReset: () => void
  onOpenConfig: () => void
}) {
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const readyLabel = resultIsCurrent ? copy.optimize.pages_tool_optimize_GenerateControlBar_001 : hasResult ? copy.optimize.pages_tool_optimize_GenerateControlBar_002 : copy.optimize.pages_tool_optimize_GenerateControlBar_003
  const busyLabel = syncing
    ? copy.optimize.pages_tool_optimize_GenerateControlBar_004
    : progress?.queueStatus === 'queued'
      ? copy.optimize.pages_tool_optimize_GenerateControlBar_005
      : progress?.completedAt
        ? copy.optimize.pages_tool_optimize_GenerateControlBar_006
        : copy.optimize.pages_tool_optimize_GenerateControlBar_007
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
            <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_GenerateControlBar_008}</p>
            <span className={`tool-status ${readinessClass}`}>{readyLabel}</span>
            {configChanged && <span className="tool-status tool-status--warning">{copy.optimize.pages_tool_optimize_GenerateControlBar_009}</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <h2 id="generate-control-title" className="text-lg font-semibold text-ink-primary">
              {resultIsCurrent ? copy.optimize.pages_tool_optimize_GenerateControlBar_010 : copy.optimize.pages_tool_optimize_GenerateControlBar_011}
            </h2>
            <InfoTooltip label={copy.optimize.pages_tool_optimize_GenerateControlBar_012} side="bottom">
              {copy.optimize.pages_tool_optimize_GenerateControlBar_013}</InfoTooltip>
          </div>
          <div className="mt-5 grid gap-3 border-y border-surface-3 py-4 sm:grid-cols-[minmax(7rem,0.5fr)_minmax(0,1fr)_minmax(7rem,0.5fr)]" role="group" aria-label={copy.optimize.pages_tool_optimize_GenerateControlBar_014}>
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_GenerateControlBar_015} value={`${operatorCount}${copy.optimize.pages_tool_optimize_GenerateControlBar_016}`} />
            <DashboardMiniStat
              label={copy.optimize.pages_tool_optimize_GenerateControlBar_017}
              value={configLabel}
              action={(
                <button type="button" onClick={onOpenConfig} className="tool-secondary-action mt-2 px-3 py-2 text-xs">
                  {copy.optimize.pages_tool_optimize_GenerateControlBar_032}
                </button>
              )}
            />
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_GenerateControlBar_018} value={configChanged ? copy.optimize.pages_tool_optimize_GenerateControlBar_019 : copy.optimize.pages_tool_optimize_GenerateControlBar_020} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="tool-inset flex items-start gap-3 px-3 py-3 text-sm text-ink-secondary">
            <input
              id="use-priority-coupon"
              type="checkbox"
              checked={priorityCoupon.selected}
              disabled={(priorityCoupon.balance?.available ?? 0) < 1 || loading || syncing}
              onChange={(event) => priorityCoupon.onChange(event.currentTarget.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="use-priority-coupon" className="font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_GenerateControlBar_021}</label>
                <InfoTooltip label={copy.optimize.pages_tool_optimize_GenerateControlBar_022}>
                  <span className="block">
                    {copy.optimize.pages_tool_optimize_GenerateControlBar_023}</span>
                </InfoTooltip>
              </div>
              <span className="mt-1 block text-xs leading-5 text-ink-secondary">
                {copy.optimize.pages_tool_optimize_GenerateControlBar_024}{priorityCoupon.balance?.available ?? 0} {copy.optimize.pages_tool_optimize_GenerateControlBar_025}{priorityCoupon.balance?.next_expiry_at ? `${copy.optimize.pages_tool_optimize_GenerateControlBar_026}${new Date(priorityCoupon.balance.next_expiry_at).toLocaleDateString(CURRENT_LOCALE)}${copy.optimize.pages_tool_optimize_GenerateControlBar_027}` : ''}
              </span>
            </div>
          </div>
          {additionalCoupons.map((coupon) => (
            <div key={coupon.id} className="tool-inset flex items-start gap-3 px-3 py-3 text-sm text-ink-secondary">
              <input
                id={coupon.id}
                type="checkbox"
                checked={coupon.selected}
                disabled={coupon.balance < 1 || loading || syncing}
                onChange={(event) => coupon.onChange(event.currentTarget.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <label htmlFor={coupon.id} className="font-semibold text-ink-primary">{coupon.label}</label>
                  <InfoTooltip label={coupon.label}><span className="block">{coupon.help}</span></InfoTooltip>
                </div>
                <span className="mt-1 block text-xs leading-5 text-ink-secondary">
                  {copy.inventory.coupon_available}{coupon.balance}
                </span>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={onGenerate}
            data-tour-target="optimize-overview-generate"
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
            ) : resultIsCurrent ? copy.optimize.pages_tool_optimize_GenerateControlBar_028 : hasResult ? copy.optimize.pages_tool_optimize_GenerateControlBar_029 : copy.optimize.pages_tool_optimize_GenerateControlBar_030}
          </button>
          {resultIsCurrent && <p className="text-xs leading-5 text-ink-muted">{copy.optimize.pages_tool_optimize_GenerateControlBar_031}</p>}
          {!validation.ok && <p className="tool-alert tool-alert--warning px-3 py-2 text-xs leading-5" role="alert">{validation.message}</p>}
          {extraDisabledReason && <p className="tool-alert tool-alert--warning px-3 py-2 text-xs leading-5" role="status" aria-live="polite">{extraDisabledReason}</p>}
        </div>
      </div>

      {progress && (loading || progress.estimatePhase === 'cancelled') && (
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

export function DashboardMiniStat({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="min-w-0 border-l border-surface-3 pl-3 first:border-l-0 first:pl-0">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink-primary" title={value}>{value}</p>
      {action}
    </div>
  )
}
