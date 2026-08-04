import type { FreeScheduleEntitlement, LicenseConfig, PriorityCouponBalance, ReorderCheckResult, WorkspaceResultHistorySummary } from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import InfoTooltip from '../../../components/InfoTooltip'
import { formatResultHistorySummary, formatWorkspaceDate } from '../../../lib/workspace-history'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../../lib/workspace-limits'
import GenerateControlBar, { DashboardMiniStat } from './GenerateControlBar'
import { SmallActionButton } from './feedback'
import type { ValidationState } from './types'
import { copy } from '../../../copy/index'


type ReorderCheckViewState = {
  visible: boolean;
  disabledReason: string | null;
  loading: boolean;
  error: string | null;
  result: ReorderCheckResult | null;
  onCheck: () => void;
  onCancel: () => void;
  onGenerate: () => void;
  coupon?: { visible: boolean; balance: number; selected: boolean; onChange: (selected: boolean) => void };
}

type FreeScheduleViewState = {
  visible: boolean;
  entitlement: FreeScheduleEntitlement | null;
  generateBlockedReason: string | null;
  confirming: boolean;
  confirmError: string | null;
  onConfirm: () => void;
}

export default function OverviewSection({
  activeConfig,
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
  additionalCoupons,
  savedConfigCount,
  savedConfigLimit = WORKSPACE_SAVED_CONFIG_LIMIT,
  resultHistoryCount,
  resultHistoryLimit = WORKSPACE_RESULT_HISTORY_LIMIT,
  latestResult,
  generationDisabledReason,
  freeSchedule,
  reorderCheck,
  onGenerate,
  onReset,
  onOpenPlans,
  onOpenConfig,
  onViewHistory,
  onUseHistoryConfig,
  onDownloadHistory,
  downloadBusy = false,
}: {
  activeConfig: LicenseConfig;
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
  priorityCoupon: { balance: PriorityCouponBalance | null; selected: boolean; onChange: (selected: boolean) => void };
  additionalCoupons?: Array<{ id: string; label: string; help: string; balance: number; selected: boolean; onChange: (selected: boolean) => void }>;
  savedConfigCount: number;
  savedConfigLimit?: number;
  resultHistoryCount: number;
  resultHistoryLimit?: number;
  latestResult: WorkspaceResultHistorySummary | null;
  generationDisabledReason?: string | null;
  freeSchedule?: FreeScheduleViewState;
  reorderCheck?: ReorderCheckViewState;
  onGenerate: () => void;
  onReset: () => void;
  onOpenPlans: () => void;
  onOpenConfig: () => void;
  onViewHistory: (item: WorkspaceResultHistorySummary) => Promise<void>;
  onUseHistoryConfig: (item: WorkspaceResultHistorySummary) => Promise<void>;
  onDownloadHistory: (item: WorkspaceResultHistorySummary) => void;
  downloadBusy?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div data-tour-target="optimize-overview-status">
        <GenerateControlBar
          config={activeConfig}
        configChanged={configChanged}
        showConfigDetails={showConfigDetails}
        operatorCount={operatorCount}
        configPresetLabel={configPresetLabel}
        validation={validation}
        loading={loading}
        syncing={syncing}
        progress={progress}
        hasResult={hasResult}
        resultIsCurrent={resultIsCurrent}
        error={error}
        priorityCoupon={priorityCoupon}
        additionalCoupons={additionalCoupons}
        extraDisabledReason={generationDisabledReason ?? freeSchedule?.generateBlockedReason ?? null}
        onGenerate={onGenerate}
        onReset={onReset}
        onOpenConfig={onOpenConfig}
        />
      </div>

      {freeSchedule?.visible && (
        <FreeScheduleEntitlementCard state={freeSchedule} />
      )}

      {reorderCheck?.visible && (
        <ReorderCheckCard state={reorderCheck} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="tool-panel p-5 sm:p-6" data-tour-target="optimize-overview-workspace">
          <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_OverviewSection_001}</p>
          <h2 className="mt-1 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_OverviewSection_002}</h2>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_OverviewSection_005}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_003} value={`${savedConfigCount}/${savedConfigLimit}`} />
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_004} value={`${resultHistoryCount}/${resultHistoryLimit}`} />
          </div>
          <button type="button" onClick={onOpenPlans} className="tool-secondary-action mt-5">
            {copy.optimize.pages_tool_optimize_OverviewSection_010}
          </button>
        </section>

        <section className="tool-panel p-5 sm:p-6" data-tour-target="optimize-overview-latest">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_OverviewSection_012}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                {latestResult ? latestResult.name : copy.optimize.pages_tool_optimize_OverviewSection_013}
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {latestResult
                  ? `${formatWorkspaceDate(latestResult.created_at)} · ${formatResultHistorySummary(latestResult)}`
                  : copy.optimize.pages_tool_optimize_OverviewSection_014}
              </p>
            </div>
            {latestResult && (
              <span className="tool-status tool-status--current">
                {latestResult.source === 'applied_suggestions' ? copy.optimize.pages_tool_optimize_OverviewSection_015 : latestResult.source === 'legacy' ? copy.optimize.pages_tool_optimize_OverviewSection_016 : copy.optimize.pages_tool_optimize_OverviewSection_017}
              </span>
            )}
          </div>
          {latestResult ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <SmallActionButton onClick={() => void onViewHistory(latestResult)}>{copy.optimize.pages_tool_optimize_OverviewSection_018}</SmallActionButton>
              <SmallActionButton onClick={() => onDownloadHistory(latestResult)} disabled={downloadBusy || !latestResult.maa_exportable}>{downloadBusy ? copy.inventory.export_downloading : copy.optimize.pages_tool_optimize_OverviewSection_019}</SmallActionButton>
              <SmallActionButton onClick={() => void onUseHistoryConfig(latestResult)} disabled={!latestResult.has_config}>{copy.optimize.pages_tool_optimize_OverviewSection_020}</SmallActionButton>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function FreeScheduleEntitlementCard({ state }: { state: FreeScheduleViewState }) {
  const entitlement = state.entitlement
  const remaining = entitlement
    ? Math.max(0, entitlement.revision_limit - entitlement.revision_count)
    : 3
  const windowEndsAt = entitlement?.first_generated_at
    ? new Date(Date.parse(entitlement.first_generated_at) + entitlement.revision_window_hours * 60 * 60 * 1000).toISOString()
    : null
  const locked = Boolean(state.generateBlockedReason)
  const bonusAvailable = entitlement?.strong_reorder_bonus && !entitlement.strong_reorder_bonus.used_at

  return (
    <section className="tool-panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-400">{copy.optimize.pages_tool_optimize_OverviewSection_021}</p>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">{formatFreeScheduleTitle(entitlement, locked, Boolean(bonusAvailable))}</h2>
            <InfoTooltip label={copy.optimize.pages_tool_optimize_OverviewSection_022} side="bottom">
              {copy.optimize.pages_tool_optimize_OverviewSection_023}</InfoTooltip>
          </div>
        </div>
        {entitlement?.first_generated_at && !locked && !entitlement.confirmed_at && !entitlement.locked_at && (
          <SmallActionButton onClick={state.onConfirm} disabled={state.confirming}>
            {state.confirming ? copy.optimize.pages_tool_optimize_OverviewSection_024 : copy.optimize.pages_tool_optimize_OverviewSection_025}
          </SmallActionButton>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_026} value={entitlement?.first_generated_at ? `${remaining}/${entitlement.revision_limit}` : '3/3'} />
        <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_027} value={windowEndsAt ? formatWorkspaceDate(windowEndsAt) : copy.optimize.pages_tool_optimize_OverviewSection_028} />
        <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_029} value={bonusAvailable ? copy.optimize.pages_tool_optimize_OverviewSection_030 : copy.optimize.pages_tool_optimize_OverviewSection_031} />
      </div>

      {state.generateBlockedReason && (
        <div className="tool-alert tool-alert--warning mt-4">
          {state.generateBlockedReason}
        </div>
      )}

      {state.confirmError && (
        <div role="alert" className="tool-alert tool-alert--error mt-4">
          {state.confirmError}
        </div>
      )}
    </section>
  )
}

function formatFreeScheduleTitle(
  entitlement: FreeScheduleEntitlement | null,
  locked: boolean,
  bonusAvailable: boolean,
): string {
  if (bonusAvailable) return copy.optimize.pages_tool_optimize_OverviewSection_032
  if (!entitlement?.first_generated_at) return copy.optimize.pages_tool_optimize_OverviewSection_033
  if (locked) return copy.optimize.pages_tool_optimize_OverviewSection_034
  return copy.optimize.pages_tool_optimize_OverviewSection_035
}

function ReorderCheckCard({ state }: { state: ReorderCheckViewState }) {
  const result = state.result
  const disabled = state.loading || Boolean(state.disabledReason)
  return (
    <section className="tool-panel border-brand-600/25 p-5 shadow-sm shadow-brand-950/10 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-400">{copy.optimize.pages_tool_optimize_OverviewSection_036}</p>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_OverviewSection_037}</h2>
            <InfoTooltip label={copy.optimize.pages_tool_optimize_OverviewSection_038} side="bottom">
              {copy.optimize.pages_tool_optimize_OverviewSection_039}</InfoTooltip>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {state.loading && <button type="button" onClick={state.onCancel} className="tool-secondary-action">
            {copy.optimize.pages_tool_optimize_OverviewSection_069}
          </button>}
          <button
            type="button"
            onClick={state.onCheck}
            disabled={disabled}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-400 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
          >
            {state.loading ? copy.optimize.pages_tool_optimize_OverviewSection_040 : copy.optimize.pages_tool_optimize_OverviewSection_041}
          </button>
        </div>
      </div>

      {state.coupon?.visible && (
        <label className="tool-inset mt-4 flex cursor-pointer items-start gap-3 px-4 py-3 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={state.coupon.selected}
            disabled={state.loading || state.coupon.balance < 1}
            onChange={(event) => state.coupon?.onChange(event.currentTarget.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span>
            <span className="block font-semibold text-ink-primary">{copy.inventory.reorder_coupon}</span>
            <span className="mt-1 block text-xs leading-5">{copy.inventory.reorder_coupon_help} {copy.inventory.coupon_available}{state.coupon.balance}</span>
          </span>
        </label>
      )}

      {state.disabledReason && (
        <div className="tool-inset mt-4 px-4 py-3 text-sm leading-6 text-ink-secondary">
          {state.disabledReason}
        </div>
      )}

      {state.error && (
        <div role="alert" className="tool-alert tool-alert--error mt-4">
          {state.error}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className={`tool-inset px-4 py-3 ${getRecommendationTone(result.recommendation)}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold">{formatRecommendationTitle(result.recommendation)}</p>
                <p className="mt-1 text-sm leading-6">{formatRecommendationSummary(result.recommendation)}</p>
              </div>
              <span className="inline-flex w-fit rounded-md bg-surface-1/80 px-2.5 py-1 text-xs font-semibold text-ink-secondary">
                {formatReorderQuota(result)}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_042} value={result.estimated_gain_range.label} />
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_043} value={`${result.changed_room_count}`} />
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_044} value={result.current_plan_usable ? copy.optimize.pages_tool_optimize_OverviewSection_045 : copy.optimize.pages_tool_optimize_OverviewSection_046} />
            <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_047} value={`${result.quota.remaining}/${result.quota.limit}`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SummaryBlock
              label={copy.optimize.pages_tool_optimize_OverviewSection_048}
              value={result.affected_facility_types.length > 0
                ? result.affected_facility_types.map(formatFacilityType).join(' / ')
                : copy.optimize.pages_tool_optimize_OverviewSection_049}
            />
            <SummaryBlock
              label={copy.optimize.pages_tool_optimize_OverviewSection_050}
              value={result.key_operators.length > 0
                ? result.key_operators.map((operator) => `${operator.name} x${operator.occurrence_count}`).join(' / ')
                : copy.optimize.pages_tool_optimize_OverviewSection_051}
            />
          </div>

          {result.reasons.length > 0 && (
            <div className="tool-inset px-4 py-3 text-sm leading-6 text-ink-secondary">
              {result.reasons.join(' ')}
            </div>
          )}

          {result.recommendation === 'strongly_recommended' && (
            <div>
              <SmallActionButton onClick={state.onGenerate} tone="primary">{copy.optimize.pages_tool_optimize_OverviewSection_052}</SmallActionButton>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-inset px-4 py-3">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-sm leading-6 text-ink-primary">{value}</p>
    </div>
  )
}

function formatRecommendationTitle(recommendation: ReorderCheckResult['recommendation']): string {
  if (recommendation === 'strongly_recommended') return copy.optimize.pages_tool_optimize_OverviewSection_053
  if (recommendation === 'recommended') return copy.optimize.pages_tool_optimize_OverviewSection_054
  return copy.optimize.pages_tool_optimize_OverviewSection_055
}

function formatRecommendationSummary(recommendation: ReorderCheckResult['recommendation']): string {
  if (recommendation === 'strongly_recommended') return copy.optimize.pages_tool_optimize_OverviewSection_056
  if (recommendation === 'recommended') return copy.optimize.pages_tool_optimize_OverviewSection_057
  return copy.optimize.pages_tool_optimize_OverviewSection_058
}

function getRecommendationTone(recommendation: ReorderCheckResult['recommendation']): string {
  if (recommendation === 'strongly_recommended') return 'border-error/40 bg-error/10 text-error'
  if (recommendation === 'recommended') return 'border-warning/40 bg-warning/10 text-warning'
  return 'border-success/40 bg-success/10 text-success'
}

function formatFacilityType(type: string): string {
  const labels: Record<string, string> = {
    trading: copy.optimize.pages_tool_optimize_OverviewSection_059,
    manufacture: copy.optimize.pages_tool_optimize_OverviewSection_060,
    manufacturing: copy.optimize.pages_tool_optimize_OverviewSection_061,
    power: copy.optimize.pages_tool_optimize_OverviewSection_062,
    meeting: copy.optimize.pages_tool_optimize_OverviewSection_063,
    control: copy.optimize.pages_tool_optimize_OverviewSection_064,
    dormitory: copy.optimize.pages_tool_optimize_OverviewSection_065,
    office: copy.optimize.pages_tool_optimize_OverviewSection_066,
  }
  return labels[type] ?? type
}

function formatReorderQuota(result: ReorderCheckResult): string {
  return `${copy.optimize.pages_tool_optimize_OverviewSection_067}${result.quota.remaining}/${result.quota.limit} · ${formatWorkspaceDate(result.quota.reset_at)}${copy.optimize.pages_tool_optimize_OverviewSection_068}`
}
