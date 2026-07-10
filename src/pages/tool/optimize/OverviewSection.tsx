import type { FreeScheduleEntitlement, LicenseConfig, ReorderCheckResult, WorkspaceResultHistoryItem } from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import { formatResultSummary, formatWorkspaceDate, isMaaJsonDownloadable } from '../../../lib/workspace-history'
import GenerateControlBar, { DashboardMiniStat } from './GenerateControlBar'
import { SmallActionButton } from './feedback'
import type { ValidationState } from './types'

type ReorderCheckViewState = {
  visible: boolean;
  disabledReason: string | null;
  loading: boolean;
  error: string | null;
  result: ReorderCheckResult | null;
  onCheck: () => void;
  onGenerate: () => void;
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
  savedConfigCount,
  resultHistoryCount,
  latestResult,
  freeSchedule,
  reorderCheck,
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
  freeSchedule?: FreeScheduleViewState;
  reorderCheck?: ReorderCheckViewState;
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
        extraDisabledReason={freeSchedule?.generateBlockedReason ?? null}
        onGenerate={onGenerate}
        onReset={onReset}
      />

      {freeSchedule?.visible && (
        <FreeScheduleEntitlementCard state={freeSchedule} />
      )}

      {reorderCheck?.visible && (
        <ReorderCheckCard state={reorderCheck} />
      )}

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
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-400">免费完整排班权益</p>
          <h2 className="mt-1 text-lg font-semibold text-ink-primary">{formatFreeScheduleTitle(entitlement, locked, Boolean(bonusAvailable))}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
            首次生成后 24 小时内最多可修正生成 3 次；确认或次数用完后，只保留重排检测和历史查看。
          </p>
        </div>
        {entitlement?.first_generated_at && !locked && !entitlement.confirmed_at && !entitlement.locked_at && (
          <SmallActionButton onClick={state.onConfirm} disabled={state.confirming}>
            {state.confirming ? '确认中' : '确认使用此方案'}
          </SmallActionButton>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DashboardMiniStat label="剩余修正" value={entitlement?.first_generated_at ? `${remaining}/${entitlement.revision_limit}` : '3/3'} />
        <DashboardMiniStat label="确认期截止" value={windowEndsAt ? formatWorkspaceDate(windowEndsAt) : '首次生成后 24 小时'} />
        <DashboardMiniStat label="额外重排" value={bonusAvailable ? '本月可用 1 次' : '暂无'} />
      </div>

      {state.generateBlockedReason && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
          {state.generateBlockedReason}
        </div>
      )}

      {state.confirmError && (
        <div role="alert" className="mt-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm leading-6 text-error">
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
  if (bonusAvailable) return '强烈建议重排，本月可额外生成 1 次完整免费方案'
  if (!entitlement?.first_generated_at) return '可生成 1 套免费完整个人排班'
  if (locked) return '免费完整排班权益已锁定'
  return '确认期内可修正生成'
}

function ReorderCheckCard({ state }: { state: ReorderCheckViewState }) {
  const result = state.result
  const disabled = state.loading || Boolean(state.disabledReason)
  return (
    <section className="rounded-xl border border-brand-600/25 bg-surface-1 p-5 shadow-sm shadow-brand-950/10 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-400">免费个人排班</p>
          <h2 className="mt-1 text-lg font-semibold text-ink-primary">检测是否需要重排</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
            只返回收益区间、影响设施和关键干员摘要，不展示完整新方案。
          </p>
        </div>
        <button
          type="button"
          onClick={state.onCheck}
          disabled={disabled}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-400 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {state.loading ? '检测中' : '检测是否需要重排'}
        </button>
      </div>

      {state.disabledReason && (
        <div className="mt-4 rounded-lg border border-surface-3 bg-surface-2 px-4 py-3 text-sm leading-6 text-ink-secondary">
          {state.disabledReason}
        </div>
      )}

      {state.error && (
        <div role="alert" className="mt-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm leading-6 text-error">
          {state.error}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className={`rounded-lg border px-4 py-3 ${getRecommendationTone(result.recommendation)}`}>
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
            <DashboardMiniStat label="收益区间" value={result.estimated_gain_range.label} />
            <DashboardMiniStat label="变化房间" value={`${result.changed_room_count}`} />
            <DashboardMiniStat label="当前方案" value={result.current_plan_usable ? '可继续用' : '不建议长期用'} />
            <DashboardMiniStat label="本月剩余" value={`${result.quota.remaining}/${result.quota.limit}`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SummaryBlock
              label="影响设施"
              value={result.affected_facility_types.length > 0
                ? result.affected_facility_types.map(formatFacilityType).join(' / ')
                : '无明显变化'}
            />
            <SummaryBlock
              label="可能受益干员"
              value={result.key_operators.length > 0
                ? result.key_operators.map((operator) => `${operator.name} x${operator.occurrence_count}`).join(' / ')
                : '无新增关键干员'}
            />
          </div>

          {result.reasons.length > 0 && (
            <div className="rounded-lg border border-surface-3 bg-surface-2 px-4 py-3 text-sm leading-6 text-ink-secondary">
              {result.reasons.join(' ')}
            </div>
          )}

          {result.recommendation === 'strongly_recommended' && (
            <div>
              <SmallActionButton onClick={state.onGenerate}>生成完整个人排班</SmallActionButton>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-3 bg-surface-2 px-4 py-3">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-sm leading-6 text-ink-primary">{value}</p>
    </div>
  )
}

function formatRecommendationTitle(recommendation: ReorderCheckResult['recommendation']): string {
  if (recommendation === 'strongly_recommended') return '强烈建议重排'
  if (recommendation === 'recommended') return '建议重排'
  return '无需重排'
}

function formatRecommendationSummary(recommendation: ReorderCheckResult['recommendation']): string {
  if (recommendation === 'strongly_recommended') return '核心贸易/制造组合可能受影响，建议生成完整个人排班。'
  if (recommendation === 'recommended') return '新干员或新练度可能改变部分房间，方便时可以重新生成。'
  return '预计收益提升很小，继续用当前方案即可。'
}

function getRecommendationTone(recommendation: ReorderCheckResult['recommendation']): string {
  if (recommendation === 'strongly_recommended') return 'border-error/40 bg-error/10 text-error'
  if (recommendation === 'recommended') return 'border-warning/40 bg-warning/10 text-warning'
  return 'border-success/40 bg-success/10 text-success'
}

function formatFacilityType(type: string): string {
  const labels: Record<string, string> = {
    trading: '贸易站',
    manufacture: '制造站',
    manufacturing: '制造站',
    power: '发电站',
    meeting: '会客室',
    control: '控制中枢',
    dormitory: '宿舍',
    office: '办公室',
  }
  return labels[type] ?? type
}

function formatReorderQuota(result: ReorderCheckResult): string {
  return `本月剩余 ${result.quota.remaining}/${result.quota.limit} · ${formatWorkspaceDate(result.quota.reset_at)} 重置`
}
