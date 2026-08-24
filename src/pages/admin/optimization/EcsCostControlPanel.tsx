import { copy } from '../../../copy'
import type {
  ServiceStatusCostConfig,
  ServiceStatusCostEstimate,
} from '../../../lib/service-status'

interface EcsCostControlPanelProps {
  config: ServiceStatusCostConfig
  estimate: ServiceStatusCostEstimate
  billableWorkerInstances?: number
  saving: boolean
  onChange: (config: ServiceStatusCostConfig) => void
  onSave: () => void
}

export default function EcsCostControlPanel({
  config,
  estimate,
  billableWorkerInstances,
  saving,
  onChange,
  onSave,
}: EcsCostControlPanelProps) {
  const currentWorkerState = billableWorkerInstances === undefined
    ? copy.status.pages_AdminEcsCost_046
    : billableWorkerInstances > 0
      ? `${copy.status.pages_AdminEcsCost_047}（${billableWorkerInstances}）`
      : copy.status.pages_AdminEcsCost_048

  return (
    <section className="tool-panel mt-6 p-5" aria-labelledby="ecs-cost-control-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="tool-eyebrow">{copy.status.pages_AdminEcsCost_003}</p>
          <h4 id="ecs-cost-control-title" className="mt-2 text-base font-semibold text-ink-primary">{copy.status.pages_AdminEcsCost_001}</h4>
          <p className="mt-1 text-sm leading-6 text-ink-muted">{copy.status.pages_AdminEcsCost_002}</p>
        </div>
        <span className="tool-status">{currentWorkerState}</span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="block text-sm text-ink-secondary">
          <span className="mb-2 block">{copy.status.pages_AdminEcsCost_059}</span>
          <input
            className="tool-field"
            type="number"
            min="0"
            step="0.0001"
            value={config.resident_hourly_price_cny ?? ''}
            placeholder={copy.status.pages_AdminEcsCost_006}
            onChange={(event) => onChange({ ...config, resident_hourly_price_cny: event.currentTarget.value === '' ? null : Math.max(0, Number(event.currentTarget.value) || 0) })}
          />
          <span className="mt-1 block text-xs text-ink-muted">{copy.status.pages_AdminEcsCost_054}</span>
        </label>
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
          <span className="mt-1 block text-xs text-ink-muted">{copy.status.pages_AdminEcsCost_054}</span>
        </label>
        <div className="tool-inset p-4 text-sm text-ink-secondary">
          <p className="font-semibold text-ink-primary">{copy.status.pages_AdminEcsCost_049}</p>
          <p className="mt-2 leading-6">{copy.status.pages_AdminEcsCost_050}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 border-t border-surface-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <CostSummary label={copy.status.pages_AdminEcsCost_027} value={formatHours(estimate.observed_24h_worker_hours)} hint={formatCoverage(estimate.observed_24h_sample_hours)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_028} value={formatHours(estimate.observed_30d_worker_hours)} hint={formatCoverage(estimate.observed_30d_sample_hours)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_051} value={formatMoney(estimate.observed_24h_cost_cny)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_052} value={formatMoney(estimate.observed_30d_cost_cny)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_053} value={formatMoney(estimate.projected_monthly_cost_cny)} />
        <CostSummary label={copy.status.pages_AdminEcsCost_055} value={formatMoney(estimate.observed_savings_cny)} />
      </div>
      <p className="mt-4 text-xs leading-6 text-ink-muted">{copy.status.pages_AdminEcsCost_056}</p>
      <button type="button" className="tool-primary-action mt-5" onClick={onSave} disabled={saving}>{saving ? copy.status.pages_AdminEcsCost_034 : copy.status.pages_AdminEcsCost_033}</button>
    </section>
  )
}

function CostSummary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="tool-inset p-3"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-base font-semibold tabular-nums text-ink-primary">{value}</p>{hint && <p className="mt-1 text-xs leading-5 text-ink-muted">{hint}</p>}</div>
}

function formatHours(value: number | null): string {
  return value === null ? '—' : `${value} ${copy.status.pages_AdminEcsCost_037}`
}

function formatMoney(value: number | null): string {
  return value === null ? copy.status.pages_AdminEcsCost_006 : `${value.toFixed(2)} ${copy.status.pages_AdminEcsCost_036}`
}

function formatCoverage(value: number): string {
  return value > 0 ? copy.status.pages_AdminEcsCost_057(value) : copy.status.pages_AdminEcsCost_058
}
