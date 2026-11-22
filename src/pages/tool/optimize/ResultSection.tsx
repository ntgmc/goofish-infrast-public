import { Component, type ErrorInfo, type ReactNode } from 'react'
import InternalLink from '../../../components/InternalLink'
import type { OptimizeResult } from '../../../lib/types'
import { v2Path } from '../../v2/navigation'
import { resolveActivePurchaseChannel } from '../../../lib/purchase'
import { usePublicContent } from '../../../lib/public-content-context'
import { copy } from '../../../copy'
import { recordDebugError } from '../../../lib/debug-diagnostics'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { isStaleChunkError } from '../../../lib/chunk-reload'

export function LockedCapabilityPreview({ title, description, className = '' }: { title: string; description: string; className?: string }) {
  const { features } = useSiteFeatures()
  const { content, isFallback } = usePublicContent()
  const purchaseHref = isFallback ? undefined : resolveActivePurchaseChannel(content.cdk_purchase.xianyu_url)?.href ?? undefined
  return (
    <div className={`relative min-h-80 overflow-hidden rounded-xl ${className}`}>
      <div className="space-y-4 select-none opacity-50 blur-[3px]" aria-hidden="true" data-locked-capability-preview>
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
      <div className="absolute inset-0 flex items-center justify-center bg-surface-1/70 p-4 backdrop-blur-[2px]" data-locked-capability-overlay>
        <div className="tool-panel max-w-lg p-5 text-center shadow-lg sm:p-6">
          <span className="tool-status">{copy.optimize.pages_tool_optimize_ResultSection_015}</span>
          <h3 className="mt-3 text-lg font-semibold text-ink-primary">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{description}</p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            {purchaseHref ? (
              <a href={purchaseHref} target="_blank" rel="noopener noreferrer" className="tool-primary-action">
                {copy.optimize.pages_tool_optimize_ResultSection_018}
              </a>
            ) : features.pricing && (
              <InternalLink to="/pricing" className="tool-primary-action">
                {copy.optimize.pages_tool_optimize_ResultSection_018}
              </InternalLink>
            )}
            <InternalLink to={v2Path('add-account')} className="tool-secondary-action">
              {copy.optimize.pages_tool_optimize_ResultSection_019}
            </InternalLink>
          </div>
        </div>
      </div>
    </div>
  )
}

export class ResultErrorBoundary extends Component<{
  resetKey: string
  onDownloadDiagnostic?: () => void
  diagnosticDownloadBusy: boolean
  loadErrorFallback?: ReactNode
  children: ReactNode
}, { failed: boolean; loadFailed: boolean }> {
  state = { failed: false, loadFailed: false }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, loadFailed: isStaleChunkError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDebugError(error, 'react_error', { context: 'result_render' })
    console.error('result rendering failed:', error, info.componentStack)
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, loadFailed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (this.state.loadFailed) return this.props.loadErrorFallback ?? (
      <div className="tool-alert tool-alert--error" role="alert">
        <p>{copy.common.pageLoadFailed}</p>
        <button type="button" className="tool-secondary-action mt-3" onClick={() => window.location.reload()}>
          {copy.common.pageReload}
        </button>
      </div>
    )
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
  const quick = result.calculation_mode === 'quick' && (status === 'completed' || status === 'partial')
  const message = quick && !result.upgrade_suggestions?.length
    ? copy.optimize.quickUpgradeEmpty
    : status === 'completed'
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
      {quick && <p className="mb-1">{copy.optimize.quickUpgradeNotice}</p>}
      {message}
    </div>
  )
}
