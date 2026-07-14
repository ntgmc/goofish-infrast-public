import { useEffect, useState, type FormEvent } from 'react'
import type { LicenseConfig, WorkspaceResultHistoryItem, WorkspaceSavedConfig } from '../../../lib/types'
import { formatPlanName, formatResultSummary, formatWorkspaceDate, isMaaJsonDownloadable, type ConfigDiffItem } from '../../../lib/workspace-history'
import { SmallActionButton } from './feedback'

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
            <p className="tool-eyebrow">我的方案</p>
            <h2 className="mt-1 text-lg font-semibold text-ink-primary">方案库与历史结果</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              保存常用配置，回看最近生成结果；离开页面后也能重新下载上次 MAA JSON。
            </p>
          </div>
          <form onSubmit={submitSave} className="flex w-full min-w-0 flex-col gap-2 sm:flex-row lg:w-auto">
            <label className="min-w-0 flex-1 lg:w-56">
              <span className="sr-only">方案名称</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                maxLength={40}
                className="tool-field"
                placeholder="例如：243 刷钱"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="tool-primary-action disabled:cursor-wait"
            >
              {saving ? '保存中...' : '保存当前配置'}
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
              <h3 className="text-base font-semibold text-ink-primary">上次结果</h3>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {latestResult ? `${latestResult.name} · ${formatWorkspaceDate(latestResult.created_at)}` : '还没有生成过排班结果。'}
              </p>
            </div>
            {latestResult && (
              <span className={`tool-status ${latestResult.source === 'applied_suggestions' ? 'tool-status--success' : 'tool-status--current'}`}>
                {latestResult.source === 'applied_suggestions' ? '建议后' : latestResult.source === 'legacy' ? '旧结果' : '生成'}
              </span>
            )}
          </div>
          {latestResult ? (
            <>
              <p className="mt-3 text-sm text-ink-secondary">{formatResultSummary(latestResult.result)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SmallActionButton onClick={() => onViewHistory(latestResult)}>查看</SmallActionButton>
                <SmallActionButton onClick={() => onDownloadHistory(latestResult)} disabled={!isMaaJsonDownloadable(latestResult.result)}>下载 JSON</SmallActionButton>
                <SmallActionButton onClick={() => onUseHistoryConfig(latestResult)} disabled={!latestResult.config}>继续调配置</SmallActionButton>
              </div>
            </>
          ) : (
            <p className="tool-inset mt-4 px-3 py-3 text-sm text-ink-muted">生成一次排班后，这里会保留可回看的上次结果。</p>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <h3 className="text-base font-semibold text-ink-primary">当前方案 vs 上次方案</h3>
          {latestResult ? (
            diffRows.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {diffRows.map((row) => (
                  <div key={row.label} className="tool-inset grid gap-2 px-3 py-3 text-sm md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="font-medium text-ink-primary">{row.label}</span>
                    <span className="min-w-0 text-ink-muted">上次：{row.before}</span>
                    <span className="min-w-0 text-brand-300">当前：{row.after}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tool-alert tool-alert--success mt-4" role="status">当前配置与上次生成配置一致。</p>
            )
          ) : (
            <p className="tool-inset mt-4 px-3 py-3 text-sm text-ink-muted">暂无上次方案可对比。</p>
          )}
        </div>
      </div>

      <div className="grid border-t border-surface-3/60 lg:grid-cols-2">
        <div className="border-b border-surface-3/60 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">已保存配置</h3>
            <span className="text-xs text-ink-muted">{savedConfigs.length}/20</span>
          </div>
          <div className="mt-4 space-y-3">
            {savedConfigs.length === 0 && <p className="tool-inset px-3 py-3 text-sm text-ink-muted">还没有保存配置。</p>}
            {savedConfigs.map((item) => (
              <div key={item.id} className="tool-inset px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatPlanName(item.config)} · 更新 {formatWorkspaceDate(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <SmallActionButton onClick={() => onUseSavedConfig(item)} disabled={item.read_only || busyAction === `touch:${item.id}`}>载入</SmallActionButton>
                    <SmallActionButton onClick={() => void onRenameSavedConfig(item)} disabled={item.read_only || busyAction === `rename:${item.id}`}>改名</SmallActionButton>
                    <SmallActionButton onClick={() => void onDeleteSavedConfig(item)} disabled={item.read_only || busyAction === `delete:${item.id}`} tone="danger">删除</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">历史结果</h3>
            <span className="text-xs text-ink-muted">{resultHistory.length}/10</span>
          </div>
          <div className="mt-4 space-y-3">
            {resultHistory.length === 0 && <p className="tool-inset px-3 py-3 text-sm text-ink-muted">暂无历史结果。</p>}
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
                    <SmallActionButton onClick={() => onViewHistory(item)}>查看</SmallActionButton>
                    <SmallActionButton onClick={() => onDownloadHistory(item)} disabled={!isMaaJsonDownloadable(item.result)}>下载</SmallActionButton>
                    <SmallActionButton onClick={() => onUseHistoryConfig(item)} disabled={!item.config}>继续调</SmallActionButton>
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
