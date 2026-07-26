import { useEffect, useState, type FormEvent } from 'react'
import type { LicenseConfig, WorkspaceResultHistoryItem, WorkspaceSavedConfig } from '../../../lib/types'
import { formatPlanName, formatResultSummary, formatWorkspaceDate, isMaaJsonDownloadable } from '../../../lib/workspace-history'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../../lib/workspace-limits'
import { SmallActionButton } from './feedback'
import { copy } from '../../../copy/index'


export default function PlansSection({
  activeConfig,
  savedConfigs,
  resultHistory,
  archivedResults = [],
  savedConfigLimit = WORKSPACE_SAVED_CONFIG_LIMIT,
  resultHistoryLimit = WORKSPACE_RESULT_HISTORY_LIMIT,
  archiveLimit = 0,
  selectedHistoryId,
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
  canDownloadFullResult,
  onDownloadFullResultHistory,
  onArchiveHistory = async () => {},
  onUnarchiveHistory = async () => {},
  onDeleteHistory = async () => {},
}: {
  activeConfig: LicenseConfig;
  savedConfigs: WorkspaceSavedConfig[];
  resultHistory: WorkspaceResultHistoryItem[];
  archivedResults?: WorkspaceResultHistoryItem[];
  savedConfigLimit?: number;
  resultHistoryLimit?: number;
  archiveLimit?: number;
  selectedHistoryId: string | null;
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
  canDownloadFullResult: boolean;
  onDownloadFullResultHistory: (item: WorkspaceResultHistoryItem) => void;
  onArchiveHistory?: (item: WorkspaceResultHistoryItem) => Promise<void>;
  onUnarchiveHistory?: (item: WorkspaceResultHistoryItem) => Promise<void>;
  onDeleteHistory?: (item: WorkspaceResultHistoryItem) => Promise<void>;
}) {
  const [draftName, setDraftName] = useState(formatPlanName(activeConfig))

  useEffect(() => {
    setDraftName(formatPlanName(activeConfig))
  }, [activeConfig.desc, activeConfig.layout])

  const saving = busyAction === 'save-current'
  const savedConfigLimitReached = savedConfigs.length >= savedConfigLimit
  const archiveLimitReached = archivedResults.length >= archiveLimit
  const historyLimitReached = resultHistory.length >= resultHistoryLimit

  const submitSave = (event: FormEvent) => {
    event.preventDefault()
    void onSaveCurrent(draftName)
  }

  return (
    <section className="space-y-4">
      <section className="tool-panel overflow-hidden" aria-labelledby="saved-configs-title">
        <div className="tool-panel-header px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_PlansSection_001}</p>
            <h2 id="saved-configs-title" className="mt-1 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_002}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {copy.optimize.pages_tool_optimize_PlansSection_003}</p>
          </div>
          <span className="tool-status tool-status--current">{savedConfigs.length}/{savedConfigLimit}</span>
        </div>
        <form onSubmit={submitSave} className="mt-4 flex w-full min-w-0 flex-col gap-2 sm:flex-row" data-tour-target="optimize-plans-save">
            <label className="min-w-0 flex-1 lg:w-56">
              <span className="sr-only">{copy.optimize.pages_tool_optimize_PlansSection_004}</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                maxLength={40}
                disabled={savedConfigLimitReached}
                aria-describedby={savedConfigLimitReached ? 'saved-config-limit' : undefined}
                className="tool-field"
                placeholder={copy.optimize.pages_tool_optimize_PlansSection_005}
              />
            </label>
            <button
              type="submit"
              disabled={saving || savedConfigLimitReached}
              className="tool-primary-action disabled:cursor-wait"
            >
              {saving ? copy.optimize.pages_tool_optimize_PlansSection_006 : copy.optimize.pages_tool_optimize_PlansSection_007}
            </button>
        </form>
        {savedConfigLimitReached && (
          <p id="saved-config-limit" className="tool-alert tool-alert--warning mt-4" role="status">
            {copy.optimize.pages_tool_optimize_PlansSection_010}
          </p>
        )}
        </div>
        {(notice || error) && (
          <div className={`tool-alert mx-5 mb-5 ${error ? 'tool-alert--error' : 'tool-alert--success'}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
            {error ?? notice}
          </div>
        )}
        <div className="p-5 sm:p-6" data-tour-target="optimize-plans-saved">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_022}</h3>
          </div>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_PlansSection_009}</p>
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
                    <SmallActionButton onClick={() => onUseSavedConfig(item)} disabled={item.read_only || busyAction === `touch:${item.id}`} tone="primary">{copy.optimize.pages_tool_optimize_PlansSection_025}</SmallActionButton>
                    <SmallActionButton onClick={() => void onRenameSavedConfig(item)} disabled={item.read_only || busyAction === `rename:${item.id}`}>{copy.optimize.pages_tool_optimize_PlansSection_026}</SmallActionButton>
                    <SmallActionButton onClick={() => void onDeleteSavedConfig(item)} disabled={item.read_only || busyAction === `delete:${item.id}`} tone="danger">{copy.optimize.pages_tool_optimize_PlansSection_027}</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="tool-panel overflow-hidden" aria-labelledby="result-history-title" data-tour-target="optimize-plans-history">
        <div className="tool-panel-header px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_PlansSection_034}</p>
              <h2 id="result-history-title" className="mt-1 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_PlansSection_028}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_PlansSection_033}</p>
            </div>
            <span className="tool-status">{resultHistory.length}/{resultHistoryLimit}</span>
          </div>
        </div>
        <div className="p-5 sm:p-6">
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
                    <SmallActionButton onClick={() => onViewHistory(item)} tone="primary">{copy.optimize.pages_tool_optimize_PlansSection_030}</SmallActionButton>
                    <SmallActionButton onClick={() => onDownloadHistory(item)} disabled={!isMaaJsonDownloadable(item.result)}>{copy.optimize.pages_tool_optimize_PlansSection_031}</SmallActionButton>
                    {canDownloadFullResult && <SmallActionButton onClick={() => onDownloadFullResultHistory(item)}>{copy.optimize.pages_tool_optimize_PlansSection_035}</SmallActionButton>}
                    <SmallActionButton onClick={() => onUseHistoryConfig(item)} disabled={!item.config}>{copy.optimize.pages_tool_optimize_PlansSection_032}</SmallActionButton>
                    <SmallActionButton onClick={() => void onArchiveHistory(item)} disabled={archiveLimitReached || busyAction === `archive:${item.id}`}>{copy.inventory.archive_action}</SmallActionButton>
                    <SmallActionButton onClick={() => void onDeleteHistory(item)} disabled={busyAction === `delete:${item.id}`} tone="danger">{copy.inventory.delete_result}</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="tool-panel overflow-hidden" aria-labelledby="archived-results-title">
        <div className="tool-panel-header px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="tool-eyebrow">{copy.inventory.archive_title}</p>
              <h2 id="archived-results-title" className="mt-1 text-lg font-semibold text-ink-primary">{copy.inventory.archive_title}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.inventory.archive_description}</p>
            </div>
            <span className="tool-status tool-status--current">{archivedResults.length}/{archiveLimit}</span>
          </div>
          {archiveLimitReached && archiveLimit > 0 && <p className="tool-alert tool-alert--warning mt-4" role="status">{copy.inventory.archive_full}</p>}
        </div>
        <div className="p-5 sm:p-6">
          <div className="space-y-3">
            {archivedResults.length === 0 && <p className="tool-inset px-3 py-3 text-sm text-ink-muted">{copy.inventory.archive_empty}</p>}
            {archivedResults.map((item) => (
              <div key={item.id} className={`tool-inset px-3 py-3 ${selectedHistoryId === item.id ? 'border-brand-500/60 bg-brand-600/10' : ''}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">{formatWorkspaceDate(item.created_at)} · {formatResultSummary(item.result)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <SmallActionButton onClick={() => onViewHistory(item)} tone="primary">{copy.optimize.pages_tool_optimize_PlansSection_030}</SmallActionButton>
                    <SmallActionButton onClick={() => onDownloadHistory(item)} disabled={!isMaaJsonDownloadable(item.result)}>{copy.optimize.pages_tool_optimize_PlansSection_031}</SmallActionButton>
                    {canDownloadFullResult && <SmallActionButton onClick={() => onDownloadFullResultHistory(item)}>{copy.optimize.pages_tool_optimize_PlansSection_035}</SmallActionButton>}
                    <SmallActionButton onClick={() => onUseHistoryConfig(item)} disabled={!item.config}>{copy.optimize.pages_tool_optimize_PlansSection_032}</SmallActionButton>
                    <SmallActionButton onClick={() => void onUnarchiveHistory(item)} disabled={historyLimitReached || busyAction === `unarchive:${item.id}`}>{copy.inventory.unarchive_action}</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {historyLimitReached && archivedResults.length > 0 && <p className="tool-alert tool-alert--warning mt-4" role="status">{copy.inventory.history_full_for_unarchive}</p>}
        </div>
      </section>
    </section>
  )
}
