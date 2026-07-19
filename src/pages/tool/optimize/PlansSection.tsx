import { useEffect, useState, type FormEvent } from 'react'
import type { LicenseConfig, WorkspaceResultHistoryItem, WorkspaceSavedConfig } from '../../../lib/types'
import { formatPlanName, formatResultSummary, formatWorkspaceDate, isMaaJsonDownloadable, type ConfigDiffItem } from '../../../lib/workspace-history'
import { SmallActionButton } from './feedback'
import { copy } from '../../../copy/index'


export default function PlansSection({
  activeConfig,
  savedConfigs,
  resultHistory,
  latestResult,
  selectedHistoryId,
  diffRows,
  busyAction,
  notice,
  error,
  onSaveCurrent,
  onUseSavedConfig,
  onRenameSavedConfig,
  onDeleteSavedConfig,
  onViewHistory,
  onUseHistoryConfig,
  onDownloadHistory,
}: {
  activeConfig: LicenseConfig;
  savedConfigs: WorkspaceSavedConfig[];
  resultHistory: WorkspaceResultHistoryItem[];
  latestResult: WorkspaceResultHistoryItem | null;
  selectedHistoryId: string | null;
  diffRows: ConfigDiffItem[];
  busyAction: string | null;
  notice: string | null;
  error: string | null;
  onSaveCurrent: (name: string) => Promise<void>;
  onUseSavedConfig: (config: WorkspaceSavedConfig) => void;
  onRenameSavedConfig: (config: WorkspaceSavedConfig) => Promise<void>;
  onDeleteSavedConfig: (config: WorkspaceSavedConfig) => Promise<void>;
  onViewHistory: (item: WorkspaceResultHistoryItem) => void;
  onUseHistoryConfig: (item: WorkspaceResultHistoryItem) => void;
  onDownloadHistory: (item: WorkspaceResultHistoryItem) => void;
}) {
  const [draftName, setDraftName] = useState(formatPlanName(activeConfig))

  useEffect(() => {
    setDraftName(formatPlanName(activeConfig))
  }, [activeConfig.desc, activeConfig.layout])

  const saving = busyAction === 'save-current'

  const submitSave = (event: FormEvent) => {
    event.preventDefault()
    void onSaveCurrent(draftName)
  }

  return (
    <section className="tool-panel overflow-hidden">
      <div className="tool-panel-header px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_PlansSection_001}</p>
            <h2 className="mt-1 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_002}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {copy.optimize.pages_tool_optimize_PlansSection_003}</p>
          </div>
          <form onSubmit={submitSave} className="flex w-full min-w-0 flex-col gap-2 sm:flex-row lg:w-auto" data-tour-target="optimize-plans-save">
            <label className="min-w-0 flex-1 lg:w-56">
              <span className="sr-only">{copy.optimize.pages_tool_optimize_PlansSection_004}</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                maxLength={40}
                className="tool-field"
                placeholder={copy.optimize.pages_tool_optimize_PlansSection_005}
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="tool-primary-action disabled:cursor-wait"
            >
              {saving ? copy.optimize.pages_tool_optimize_PlansSection_006 : copy.optimize.pages_tool_optimize_PlansSection_007}
            </button>
          </form>
        </div>
        {(notice || error) && (
          <div className={`tool-alert mt-4 ${error ? 'tool-alert--error' : 'tool-alert--success'}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
            {error ?? notice}
          </div>
        )}
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="border-b border-surface-3/60 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_008}</h3>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {latestResult ? `${latestResult.name} · ${formatWorkspaceDate(latestResult.created_at)}` : copy.optimize.pages_tool_optimize_PlansSection_009}
              </p>
            </div>
            {latestResult && (
              <span className={`tool-status ${latestResult.source === 'applied_suggestions' ? 'tool-status--success' : 'tool-status--current'}`}>
                {latestResult.source === 'applied_suggestions' ? copy.optimize.pages_tool_optimize_PlansSection_010 : latestResult.source === 'legacy' ? copy.optimize.pages_tool_optimize_PlansSection_011 : copy.optimize.pages_tool_optimize_PlansSection_012}
              </span>
            )}
          </div>
          {latestResult ? (
            <>
              <p className="mt-3 text-sm text-ink-secondary">{formatResultSummary(latestResult.result)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SmallActionButton onClick={() => onViewHistory(latestResult)}>{copy.optimize.pages_tool_optimize_PlansSection_013}</SmallActionButton>
                <SmallActionButton onClick={() => onDownloadHistory(latestResult)} disabled={!isMaaJsonDownloadable(latestResult.result)}>{copy.optimize.pages_tool_optimize_PlansSection_014}</SmallActionButton>
                <SmallActionButton onClick={() => onUseHistoryConfig(latestResult)} disabled={!latestResult.config}>{copy.optimize.pages_tool_optimize_PlansSection_015}</SmallActionButton>
              </div>
            </>
          ) : (
            <p className="tool-inset mt-4 px-3 py-3 text-sm text-ink-muted">{copy.optimize.pages_tool_optimize_PlansSection_016}</p>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <h3 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_017}</h3>
          {latestResult ? (
            diffRows.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {diffRows.map((row) => (
                  <div key={row.label} className="tool-inset grid gap-2 px-3 py-3 text-sm md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="font-medium text-ink-primary">{row.label}</span>
                    <span className="min-w-0 text-ink-muted">{copy.optimize.pages_tool_optimize_PlansSection_018}{row.before}</span>
                    <span className="min-w-0 text-brand-300">{copy.optimize.pages_tool_optimize_PlansSection_019}{row.after}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tool-alert tool-alert--success mt-4" role="status">{copy.optimize.pages_tool_optimize_PlansSection_020}</p>
            )
          ) : (
            <p className="tool-inset mt-4 px-3 py-3 text-sm text-ink-muted">{copy.optimize.pages_tool_optimize_PlansSection_021}</p>
          )}
        </div>
      </div>

      <div className="grid border-t border-surface-3/60 lg:grid-cols-2">
        <div className="border-b border-surface-3/60 p-5 sm:p-6 lg:border-b-0 lg:border-r" data-tour-target="optimize-plans-saved">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_022}</h3>
            <span className="text-xs text-ink-muted">{savedConfigs.length}/20</span>
          </div>
          <div className="mt-4 space-y-3">
            {savedConfigs.length === 0 && <p className="tool-inset px-3 py-3 text-sm text-ink-muted">{copy.optimize.pages_tool_optimize_PlansSection_023}</p>}
            {savedConfigs.map((item) => (
              <div key={item.id} className="tool-inset px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatPlanName(item.config)} {copy.optimize.pages_tool_optimize_PlansSection_024}{formatWorkspaceDate(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <SmallActionButton onClick={() => onUseSavedConfig(item)} disabled={item.read_only || busyAction === `touch:${item.id}`}>{copy.optimize.pages_tool_optimize_PlansSection_025}</SmallActionButton>
                    <SmallActionButton onClick={() => void onRenameSavedConfig(item)} disabled={item.read_only || busyAction === `rename:${item.id}`}>{copy.optimize.pages_tool_optimize_PlansSection_026}</SmallActionButton>
                    <SmallActionButton onClick={() => void onDeleteSavedConfig(item)} disabled={item.read_only || busyAction === `delete:${item.id}`} tone="danger">{copy.optimize.pages_tool_optimize_PlansSection_027}</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-6" data-tour-target="optimize-plans-history">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_028}</h3>
            <span className="text-xs text-ink-muted">{resultHistory.length}/10</span>
          </div>
          <div className="mt-4 space-y-3">
            {resultHistory.length === 0 && <p className="tool-inset px-3 py-3 text-sm text-ink-muted">{copy.optimize.pages_tool_optimize_PlansSection_029}</p>}
            {resultHistory.map((item) => (
              <div key={item.id} className={`tool-inset px-3 py-3 ${selectedHistoryId === item.id ? 'border-brand-500/60 bg-brand-600/10' : ''}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatWorkspaceDate(item.created_at)} · {formatResultSummary(item.result)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <SmallActionButton onClick={() => onViewHistory(item)}>{copy.optimize.pages_tool_optimize_PlansSection_030}</SmallActionButton>
                    <SmallActionButton onClick={() => onDownloadHistory(item)} disabled={!isMaaJsonDownloadable(item.result)}>{copy.optimize.pages_tool_optimize_PlansSection_031}</SmallActionButton>
                    <SmallActionButton onClick={() => onUseHistoryConfig(item)} disabled={!item.config}>{copy.optimize.pages_tool_optimize_PlansSection_032}</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
