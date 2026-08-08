import { copy } from '../../../copy'
import type {
  ServiceStatusCostConfig,
  ServiceStatusCostEstimate,
  ServiceStatusCostRecommendation,
} from '../../../lib/service-status'

interface EcsCostControlPanelProps {
  config: ServiceStatusCostConfig
  estimate: ServiceStatusCostEstimate
  recommendation: ServiceStatusCostRecommendation
  saving: boolean
  onChange: (config: ServiceStatusCostConfig) => void
  onApplyRecommendation: () => void
  onSave: () => void
}

export default function EcsCostControlPanel({
  config,
  estimate,
  recommendation,
  saving,
  onChange,
  onApplyRecommendation,
  onSave,
}: EcsCostControlPanelProps) {
  const updateWindow = (index: number, field: 'start' | 'end' | 'worker_instances', value: string) => {
    const peakWindows = config.peak_windows.map((window, current) => current === index
      ? { ...window, [field]: field === 'worker_instances' ? Math.max(0, Number(value) || 0) : value }
      : window)
    onChange({ ...config, peak_windows: peakWindows })
  }

  return (
    <section className="tool-panel mt-6 p-5" aria-labelledby="ecs-cost-control-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="tool-eyebrow">{copy.status.pages_AdminEcsCost_003}</p>
          <h4 id="ecs-cost-control-title" className="mt-2 text-base font-semibold text-ink-primary">{copy.status.pages_AdminEcsCost_001}</h4>
          <p className="mt-1 text-sm leading-6 text-ink-muted">{copy.status.pages_AdminEcsCost_002}</p>
        </div>
        <span className="tool-status">{copy.status.pages_AdminEcsCost_004}</span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-ink-secondary">
          <span className="mb-2 block">{copy.status.pages_AdminEcsCost_005}</span>
          <input
            className="tool-field"
            type="number"
            min="0"
            step="0.0001"
            value={config.hourly_price_cny ?? ''}
            placeholder={copy.status.pages_AdminEcsCost_006}
            onChange={(event) => onChange({ ...config, hourly_price_cny: event.currentTarget.value === '' ? null : Math.max(0, Number(event.currentTarget.value) || 0) })}
          />
        </label>
        <label className="flex items-center gap-3 text-sm text-ink-secondary">
          <input type="checkbox" checked={config.schedule_enabled} onChange={(event) => onChange({ ...config, schedule_enabled: event.currentTarget.checked })} className="h-4 w-4 accent-brand-500" />
          {copy.status.pages_AdminEcsCost_007}
        </label>
        <label className="block text-sm text-ink-secondary">
          <span className="mb-2 block">{copy.status.pages_AdminEcsCost_009}</span>
          <input className="tool-field" type="number" min="0" max="100" step="1" value={config.valley_worker_instances} onChange={(event) => onChange({ ...config, valley_worker_instances: Math.max(0, Number(event.currentTarget.value) || 0) })} />
          <span className="mt-1 block text-xs text-ink-muted">{copy.status.pages_AdminEcsCost_010}</span>
        </label>
      </div>
      <p className="mt-4 text-xs leading-6 text-ink-muted">{copy.status.pages_AdminEcsCost_008}</p>

      {config.schedule_enabled && (
        <div className="mt-5 border-t border-surface-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-sm font-semibold text-ink-primary">{copy.status.pages_AdminEcsCost_011}</h5>
            <button
              type="button"
              className="tool-secondary-action"
              onClick={() => onChange({ ...config, peak_windows: [...config.peak_windows, { start: '09:00', end: '18:00', worker_instances: Math.max(1, config.valley_worker_instances) }] })}
              disabled={config.peak_windows.length >= 24}
            >
              {copy.status.pages_AdminEcsCost_015}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {config.peak_windows.map((window, index) => (
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" key={`${index}:${window.start}:${window.end}`}>
                <label className="sr-only" htmlFor={`ecs-cost-start-${index}`}>{copy.status.pages_AdminEcsCost_012}</label>
                <input id={`ecs-cost-start-${index}`} className="tool-field" aria-label={copy.status.pages_AdminEcsCost_012} type="time" value={window.start} onChange={(event) => updateWindow(index, 'start', event.currentTarget.value)} />
                <label className="sr-only" htmlFor={`ecs-cost-end-${index}`}>{copy.status.pages_AdminEcsCost_013}</label>
                <input id={`ecs-cost-end-${index}`} className="tool-field" aria-label={copy.status.pages_AdminEcsCost_013} type="time" value={window.end} onChange={(event) => updateWindow(index, 'end', event.currentTarget.value)} />
                <label className="sr-only" htmlFor={`ecs-cost-workers-${index}`}>{copy.status.pages_AdminEcsCost_014}</label>
                <input id={`ecs-cost-workers-${index}`} className="tool-field" aria-label={copy.status.pages_AdminEcsCost_014} type="number" min="0" max="100" step="1" value={window.worker_instances} onChange={(event) => updateWindow(index, 'worker_instances', event.currentTarget.value)} />
                <button type="button" className="tool-secondary-action" onClick={() => onChange({ ...config, peak_windows: config.peak_windows.filter((_, current) => current !== index) })}>{copy.status.pages_AdminEcsCost_016}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-surface-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h5 className="text-sm font-semibold text-ink-primary">{copy.status.pages_AdminEcsCost_017}</h5>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{copy.status.pages_AdminEcsCost_018}</p>
          </div>
          <button type="button" className="tool-secondary-action" onClick={onApplyRecommendation} disabled={recommendation.confidence !== 'observed'}>{copy.status.pages_AdminEcsCost_019}</button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CostSummary label={copy.status.pages_AdminEcsCost_020} value={String(recommendation.source_sample_count)} />
          <CostSummary label={copy.status.pages_AdminEcsCost_043} value={formatRecommendationConfidence(recommendation.confidence)} />
          <CostSummary label={copy.status.pages_AdminEcsCost_021} value={String(recommendation.valley_worker_instances)} />
          <CostSummary label={copy.status.pages_AdminEcsCost_022} value={formatPlanWindows(recommendation.peak_windows)} />
        </div>
        {recommendation.confidence !== 'observed' && <p className="mt-3 text-xs leading-5 text-ink-muted">{recommendation.source_sample_count === 0 ? copy.status.pages_AdminEcsCost_039 : copy.status.pages_AdminEcsCost_044}</p>}
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-ink-muted">{recommendation.rationale.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>

      <div className="mt-5 grid gap-3 border-t border-surface-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <CostSummary label={copy.status.pages_AdminEcsCost_027} value={formatHours(estimate.observed_24h_worker_hours)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_028} value={formatHours(estimate.observed_30d_worker_hours)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_029} value={formatHours(estimate.planned_daily_worker_hours)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_030} value={formatHours(estimate.planned_monthly_worker_hours)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_031} value={formatMoney(estimate.estimated_daily_cost_cny)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_032} value={formatMoney(estimate.estimated_monthly_cost_cny)} />
      </div>
      <button type="button" className="tool-primary-action mt-5" onClick={onSave} disabled={saving}>{saving ? copy.status.pages_AdminEcsCost_034 : copy.status.pages_AdminEcsCost_033}</button>
    </section>
  )
}

function CostSummary({ label, value }: { label: string; value: string }) {
  return <div className="tool-inset p-3"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-base font-semibold tabular-nums text-ink-primary">{value}</p></div>
}

function formatHours(value: number | null): string {
  return value === null ? '—' : `${value} ${copy.status.pages_AdminEcsCost_037}`
}

function formatMoney(value: number | null): string {
  return value === null ? copy.status.pages_AdminEcsCost_006 : `${value.toFixed(2)} ${copy.status.pages_AdminEcsCost_036}`
}

function formatRecommendationConfidence(value: ServiceStatusCostRecommendation['confidence']): string {
  if (value === 'observed') return copy.status.pages_AdminEcsCost_024
  if (value === 'limited') return copy.status.pages_AdminEcsCost_025
  return copy.status.pages_AdminEcsCost_026
}

function formatPlanWindows(windows: ServiceStatusCostConfig['peak_windows']): string {
  return windows.length === 0 ? copy.status.pages_AdminEcsCost_038 : windows.map((window) => `${window.start}–${window.end}（${window.worker_instances}）`).join('、')
}
