import type { LicenseConfig, PriorityCouponBalance, WorkspaceResultHistorySummary } from '../../../lib/types'
import type { IssuedMeteredScheduleQuote } from '../../../lib/metered-billing'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import InfoTooltip from '../../../components/InfoTooltip'
import { formatResultHistorySummary, formatWorkspaceDate } from '../../../lib/workspace-history'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../../lib/workspace-limits'
import GenerateControlBar, { DashboardMiniStat } from './GenerateControlBar'
import { SmallActionButton } from './feedback'
import type { ValidationState } from './types'
import { copy } from '../../../copy/index'


type FreeScheduleViewState = {
  visible: boolean;
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
  onGenerate,
  incrementalRecompute,
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
  onGenerate: () => void;
  incrementalRecompute?: {
    visible: boolean;
    loading: boolean;
    quote: IssuedMeteredScheduleQuote | null;
    quoteLoading: boolean;
    quoteError: string | null;
    onRun: () => void;
  };
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
        extraDisabledReason={generationDisabledReason ?? null}
        onGenerate={onGenerate}
        onReset={onReset}
        onOpenConfig={onOpenConfig}
        />
      </div>

      {incrementalRecompute?.visible && (
        <section className="tool-panel border-brand-500/30 p-5 sm:p-6" aria-labelledby="incremental-recompute-title">
          <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_OverviewSection_071}</p>
          <h2 id="incremental-recompute-title" className="mt-1 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_OverviewSection_072}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_OverviewSection_073}</p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">{incrementalRecompute.quote ? copy.optimize.pages_tool_optimize_OverviewSection_074(incrementalRecompute.quote.charge) : copy.optimize.pages_tool_optimize_OverviewSection_075}</p>
          {incrementalRecompute.quoteError && <p className="tool-alert tool-alert--warning mt-3 text-sm" role="status">{incrementalRecompute.quoteError}</p>}
          <button
            type="button"
            className="tool-secondary-action mt-4 w-full"
            disabled={incrementalRecompute.loading || incrementalRecompute.quoteLoading || Boolean(incrementalRecompute.quote && !incrementalRecompute.quote.sufficient)}
            onClick={incrementalRecompute.onRun}
          >
            {incrementalRecompute.loading ? copy.optimize.pages_tool_optimize_OverviewSection_076 : copy.optimize.pages_tool_optimize_OverviewSection_077}
          </button>
        </section>
      )}

      {freeSchedule?.visible && (
        <FreeIdleQueueCard />
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

function FreeIdleQueueCard() {
  return (
    <section className="tool-panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-400">{copy.optimize.pages_tool_optimize_OverviewSection_021}</p>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_OverviewSection_024}</h2>
            <InfoTooltip label={copy.optimize.pages_tool_optimize_OverviewSection_022} side="bottom">
              {copy.optimize.pages_tool_optimize_OverviewSection_023}</InfoTooltip>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_026} value={copy.optimize.pages_tool_optimize_OverviewSection_027} />
        <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_028} value={copy.optimize.pages_tool_optimize_OverviewSection_029} />
        <DashboardMiniStat label={copy.optimize.pages_tool_optimize_OverviewSection_030} value={copy.optimize.pages_tool_optimize_OverviewSection_031} />
      </div>
    </section>
  )
}
