import { Component, lazy, Suspense, type ErrorInfo, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { LicenseOperator, OptimizeResult, UpgradeSuggestion, WorkspaceResultHistoryItem } from '../../../lib/types'
import ScheduleProgress, { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import { isMaaJsonDownloadable } from '../../../lib/workspace-history'
import { dashboardPath } from '../../../lib/app-routes'
import { resolveActivePurchaseChannel } from '../../../lib/purchase'
import { usePublicContent } from '../../../lib/public-content-context'
import { ResultFallback } from './feedback'
import type { OptimizePhase } from './types'
import { copy } from '../../../copy/index'
import { LockedResultPreview } from './PaidCapabilityPreview'
import { recordDebugError } from '../../../lib/debug-diagnostics'


const ResultPanel = lazy(() => import('../../../components/ResultPanel'))
const UpgradeSuggestions = lazy(() => import('../../../components/UpgradeSuggestions'))

export default function ResultSection({
  phase,
  historyItem,
  currentResult,
  finalResult,
  operators,
  suggestions,
  loading,
  progress,
  previewProfile,
  canViewUpgradeSuggestions,
  upgradeCdk,
  upgradeLoading,
  upgradeError,
  onUpgradeCdkChange,
  onUpgradePreviewProfile,
  onDownloadMAA,
  onDownloadFullResult,
  maaDownloadBusy = false,
  fullResultDownloadBusy = false,
  fullDataAvailable = true,
}: {
  phase: OptimizePhase;
  historyItem: WorkspaceResultHistoryItem | null;
  currentResult: OptimizeResult | null;
  finalResult: OptimizeResult | null;
  operators: LicenseOperator[];
  suggestions: UpgradeSuggestion[];
  loading: boolean;
  progress: ScheduleProgressState | null;
  previewProfile: boolean;
  canViewUpgradeSuggestions: boolean;
  upgradeCdk: string;
  upgradeLoading: boolean;
  upgradeError: string | null;
  onUpgradeCdkChange: (value: string) => void;
  onUpgradePreviewProfile: (event: FormEvent) => void;
  onDownloadMAA?: () => void;
  onDownloadFullResult?: () => void;
  maaDownloadBusy?: boolean;
  fullResultDownloadBusy?: boolean;
  fullDataAvailable?: boolean;
}) {
  const { content, isFallback } = usePublicContent()
  const purchaseHref = isFallback ? undefined : resolveActivePurchaseChannel(content.cdk_purchase.xianyu_url)?.href ?? undefined
  const suggestionsSlot = suggestions.length > 0 ? (
    <Suspense fallback={<ResultFallback />}>
      <UpgradeSuggestions suggestions={suggestions} embedded />
    </Suspense>
  ) : !canViewUpgradeSuggestions ? (
    <LockedUpgradeSuggestions purchaseHref={purchaseHref} />
  ) : null

  return (
    <section className="min-w-0" data-tour-target="optimize-result-content">
      {previewProfile && phase === 'idle' && !loading && <LockedResultPreview />}
      {phase === 'idle' && loading && progress && (
        <ScheduleProgress progress={progress} variant="focus" />
      )}

      {phase === 'idle' && !(loading && progress) && (
        <div className="tool-panel border-dashed px-5 py-10 text-center">
          <p className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ResultSection_001}</p>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {copy.optimize.pages_tool_optimize_ResultSection_002}</p>
        </div>
      )}

      <ResultErrorBoundary
        resetKey={`${phase}:${historyItem?.id ?? progress?.jobId ?? 'none'}`}
        onDownloadDiagnostic={onDownloadFullResult}
        diagnosticDownloadBusy={fullResultDownloadBusy}
      >
      <div data-tour-target="optimize-result-actions">
      {phase === 'history' && historyItem && (
        <Suspense fallback={<ResultFallback />}>
          <UpgradeSuggestionStatusNotice result={historyItem.result} />
          <ResultPanel
            result={historyItem.result}
            operators={operators}
            previewLimit={previewProfile ? historyItem.result.preview_limit : undefined}
            onDownload={onDownloadMAA && isMaaJsonDownloadable(historyItem.result) ? onDownloadMAA : undefined}
            onDownloadFullResult={onDownloadFullResult}
            downloadBusy={maaDownloadBusy}
            fullResultDownloadBusy={fullResultDownloadBusy}
            fullDataAvailable={fullDataAvailable}
            suggestionsSlot={suggestionsSlot}
          />
          {previewProfile && <PreviewUpgradePanel cdk={upgradeCdk} loading={upgradeLoading} error={upgradeError} onCdkChange={onUpgradeCdkChange} onSubmit={onUpgradePreviewProfile} />}
        </Suspense>
      )}

      {phase === 'suggestions' && currentResult && (
        <Suspense fallback={<ResultFallback />}>
          <UpgradeSuggestionStatusNotice result={currentResult} />
          <ResultPanel
            result={currentResult}
            operators={operators}
            previewLimit={previewProfile ? currentResult.preview_limit : undefined}
            onDownload={onDownloadMAA}
            onDownloadFullResult={onDownloadFullResult}
            downloadBusy={maaDownloadBusy}
            fullResultDownloadBusy={fullResultDownloadBusy}
            fullDataAvailable={fullDataAvailable}
            suggestionsSlot={suggestionsSlot}
          />
          {previewProfile && <PreviewUpgradePanel cdk={upgradeCdk} loading={upgradeLoading} error={upgradeError} onCdkChange={onUpgradeCdkChange} onSubmit={onUpgradePreviewProfile} />}
        </Suspense>
      )}

      {phase === 'final' && finalResult && (
        <Suspense fallback={<ResultFallback />}>
          <ResultPanel
            result={finalResult}
            operators={operators}
            previewLimit={previewProfile ? finalResult.preview_limit : undefined}
            onDownload={onDownloadMAA}
            onDownloadFullResult={onDownloadFullResult}
            downloadBusy={maaDownloadBusy}
            fullResultDownloadBusy={fullResultDownloadBusy}
            fullDataAvailable={fullDataAvailable}
            suggestionsSlot={suggestionsSlot}
          />
          {previewProfile && <PreviewUpgradePanel cdk={upgradeCdk} loading={upgradeLoading} error={upgradeError} onCdkChange={onUpgradeCdkChange} onSubmit={onUpgradePreviewProfile} />}
        </Suspense>
      )}
      </div>
      </ResultErrorBoundary>
    </section>
  )
}

function LockedUpgradeSuggestions({ purchaseHref }: { purchaseHref?: string }) {
  return (
    <div className="relative min-h-80 overflow-hidden rounded-xl">
      <div className="space-y-4 select-none opacity-50 blur-[3px]" aria-hidden="true" data-locked-suggestions-preview>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="h-5 w-32 rounded bg-surface-3" />
            <div className="h-4 w-72 max-w-full rounded bg-surface-2" />
          </div>
          <div className="h-11 w-64 max-w-full rounded-lg bg-surface-3" />
        </div>
        {[0, 1].map((index) => (
          <div key={index} className="tool-panel grid gap-4 p-4 lg:grid-cols-[auto_1fr]">
            <div className="h-12 w-12 rounded-lg bg-surface-3" />
            <div className="space-y-3">
              <div className="h-5 w-48 max-w-full rounded bg-surface-3" />
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="h-16 rounded-lg bg-surface-2" />
                <div className="h-16 rounded-lg bg-surface-2" />
                <div className="h-16 rounded-lg bg-surface-2" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-surface-1/70 p-4 backdrop-blur-[2px]">
        <div className="tool-panel max-w-lg p-5 text-center shadow-lg sm:p-6">
          <span className="tool-status">{copy.optimize.pages_tool_optimize_ResultSection_015}</span>
          <h3 className="mt-3 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ResultSection_016}</h3>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_ResultSection_017}</p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            {purchaseHref ? (
              <a href={purchaseHref} target="_blank" rel="noopener noreferrer" className="tool-primary-action">
                {copy.optimize.pages_tool_optimize_ResultSection_018}
              </a>
            ) : (
              <Link to="/pricing" className="tool-primary-action">
                {copy.optimize.pages_tool_optimize_ResultSection_018}
              </Link>
            )}
            <Link to={dashboardPath('redeem')} className="tool-secondary-action">
              {copy.optimize.pages_tool_optimize_ResultSection_019}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

class ResultErrorBoundary extends Component<{
  resetKey: string
  onDownloadDiagnostic?: () => void
  diagnosticDownloadBusy: boolean
  children: ReactNode
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDebugError(error, 'react_error', { context: 'result_render' })
    console.error('result rendering failed:', error, info.componentStack)
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="tool-alert tool-alert--warning" role="alert">
        <p>{copy.inventory.result_data_incompatible}</p>
        {this.props.onDownloadDiagnostic && (
          <button
            type="button"
            className="tool-secondary-action mt-3"
            disabled={this.props.diagnosticDownloadBusy}
            aria-busy={this.props.diagnosticDownloadBusy}
            onClick={this.props.onDownloadDiagnostic}
          >
            {this.props.diagnosticDownloadBusy
              ? copy.inventory.export_downloading
              : copy.domain.components_result_panel_ResultPanel_039}
          </button>
        )}
      </div>
    )
  }
}

export function UpgradeSuggestionStatusNotice({ result }: { result: OptimizeResult }) {
  const status = result.upgrade_suggestions_status
  if (!status) return null
  const evaluated = result.upgrade_suggestions_evaluated_count ?? 0
  const candidate = result.upgrade_suggestions_candidate_count ?? 0
  const partialTemplate = result.upgrade_suggestions_truncated_reason === 'simulation_limit'
    ? copy.optimize.pages_tool_optimize_ResultSection_014
    : copy.optimize.pages_tool_optimize_ResultSection_013
  const message = status === 'completed'
    ? result.upgrade_suggestions?.length
      ? copy.optimize.pages_tool_optimize_ResultSection_008
      : copy.optimize.pages_tool_optimize_ResultSection_009
    : status === 'partial'
      ? partialTemplate
        .replace('{evaluated}', String(evaluated))
        .replace('{candidate}', String(candidate))
      : status === 'failed'
        ? copy.optimize.pages_tool_optimize_ResultSection_010
        : status === 'not_allowed'
          ? copy.optimize.pages_tool_optimize_ResultSection_011
          : copy.optimize.pages_tool_optimize_ResultSection_012
  const className = status === 'completed'
    ? 'tool-alert--success'
    : status === 'failed' || status === 'not_allowed' || status === 'partial' ? 'tool-alert--warning' : ''
  return (
    <div
      className={`tool-alert ${className} mb-4`}
      role={status === 'failed' ? 'alert' : 'status'}
      aria-live={status === 'failed' ? 'assertive' : 'polite'}
    >
      {message}
    </div>
  )
}

function PreviewUpgradePanel({
  cdk,
  loading,
  error,
  onCdkChange,
  onSubmit,
}: {
  cdk: string;
  loading: boolean;
  error: string | null;
  onCdkChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="tool-panel mt-5 border-brand-600/25 p-5 sm:p-6">
      <h3 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ResultSection_003}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_ResultSection_004}</p>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={cdk}
          onChange={(event) => onCdkChange(event.currentTarget.value)}
          className="tool-field flex-1 font-mono uppercase tracking-wide"
          placeholder="MAA-XXXX-XXXX-XXXX"
          aria-label={copy.optimize.pages_tool_optimize_ResultSection_005}
          required
        />
        <button type="submit" disabled={loading} className="tool-primary-action">
          {loading ? copy.optimize.pages_tool_optimize_ResultSection_006 : copy.optimize.pages_tool_optimize_ResultSection_007}
        </button>
      </div>
    </form>
  )
}
