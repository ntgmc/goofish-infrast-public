import type { LicenseConfig, WorkspaceResultHistoryItem } from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import { formatResultSummary, formatWorkspaceDate, isMaaJsonDownloadable } from '../../../lib/workspace-history'
import GenerateControlBar, { DashboardMiniStat } from './GenerateControlBar'
import { SmallActionButton } from './feedback'
import type { ValidationState } from './types'

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
  savedConfigCount,
  resultHistoryCount,
  latestResult,
  onGenerate,
  onReset,
  onOpenPlans,
  onOpenConfig,
  onOpenResult,
  onViewHistory,
  onUseHistoryConfig,
  onDownloadHistory,
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
  savedConfigCount: number;
  resultHistoryCount: number;
  latestResult: WorkspaceResultHistoryItem | null;
  onGenerate: () => void;
  onReset: () => void;
  onOpenPlans: () => void;
  onOpenConfig: () => void;
  onOpenResult: () => void;
  onViewHistory: (item: WorkspaceResultHistoryItem) => void;
  onUseHistoryConfig: (item: WorkspaceResultHistoryItem) => void;
  onDownloadHistory: (item: WorkspaceResultHistoryItem) => void;
}) {
  return (
    <div className="space-y-4">
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
        onGenerate={onGenerate}
        onReset={onReset}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
          <p className="text-sm font-semibold text-brand-400">工作台状态</p>
          <h2 className="mt-1 text-lg font-semibold text-ink-primary">当前排班准备情况</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <DashboardMiniStat label="已保存方案" value={`${savedConfigCount}/20`} />
            <DashboardMiniStat label="历史结果" value={`${resultHistoryCount}/10`} />
            <DashboardMiniStat label="结果状态" value={resultIsCurrent ? '最新' : hasResult ? '需检查' : '待生成'} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenConfig}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
            >
              调整配置
            </button>
            <button
              type="button"
              onClick={onOpenPlans}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
            >
              管理方案
            </button>
            <button
              type="button"
              onClick={onOpenResult}
              disabled={!hasResult}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-muted"
            >
              查看结果
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-400">最近结果</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-primary">
                {latestResult ? latestResult.name : '还没有生成过排班结果'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {latestResult
                  ? `${formatWorkspaceDate(latestResult.created_at)} · ${formatResultSummary(latestResult.result)}`
                  : '生成后会自动写入历史结果，并在这里提供查看和下载入口。'}
              </p>
            </div>
            {latestResult && (
              <span className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-semibold text-brand-300">
                {latestResult.source === 'applied_suggestions' ? '建议后' : latestResult.source === 'legacy' ? '旧结果' : '生成'}
              </span>
            )}
          </div>
          {latestResult ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <SmallActionButton onClick={() => onViewHistory(latestResult)}>查看</SmallActionButton>
              <SmallActionButton onClick={() => onDownloadHistory(latestResult)} disabled={!isMaaJsonDownloadable(latestResult.result)}>下载 JSON</SmallActionButton>
              <SmallActionButton onClick={() => onUseHistoryConfig(latestResult)} disabled={!latestResult.config}>继续调配置</SmallActionButton>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
