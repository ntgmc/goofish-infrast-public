import { lazy, Suspense, type FormEvent } from 'react'
import type { LicenseOperator, OptimizeResult, UpgradeSuggestion, WorkspaceResultHistoryItem } from '../../../lib/types'
import ScheduleProgress, { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import { isMaaJsonDownloadable } from '../../../lib/workspace-history'
import { ResultFallback } from './feedback'
import type { OptimizePhase } from './types'

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
  inlineError,
  previewProfile,
  upgradeCdk,
  upgradeLoading,
  upgradeError,
  onUpgradeCdkChange,
  onUpgradePreviewProfile,
  onDownloadMAA,
  onApplySuggestions,
  onReset,
}: {
  phase: OptimizePhase;
  historyItem: WorkspaceResultHistoryItem | null;
  currentResult: OptimizeResult | null;
  finalResult: OptimizeResult | null;
  operators: LicenseOperator[];
  suggestions: UpgradeSuggestion[];
  loading: boolean;
  progress: ScheduleProgressState | null;
  inlineError: { scope: 'generate' | 'apply'; message: string } | null;
  previewProfile: boolean;
  upgradeCdk: string;
  upgradeLoading: boolean;
  upgradeError: string | null;
  onUpgradeCdkChange: (value: string) => void;
  onUpgradePreviewProfile: (event: FormEvent) => void;
  onDownloadMAA?: () => void;
  onApplySuggestions: (selectedIds: string[]) => Promise<void>;
  onReset: () => void;
}) {
  return (
    <section className="min-w-0">
      {phase === 'idle' && loading && progress && (
        <ScheduleProgress progress={progress} variant="focus" />
      )}

      {phase === 'idle' && !(loading && progress) && (
        <div className="tool-panel border-dashed px-5 py-10 text-center">
          <p className="text-base font-semibold text-ink-primary">生成后将在这里显示排班结果</p>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            确认总览状态并点击生成，结果会按数据、详情、导入和建议分区展示。
          </p>
        </div>
      )}

      {phase === 'history' && historyItem && (
        <Suspense fallback={<ResultFallback />}>
          <ResultPanel
            result={historyItem.result}
            operators={operators}
            previewLimit={previewProfile ? historyItem.result.preview_limit : undefined}
            onDownload={!previewProfile && onDownloadMAA && isMaaJsonDownloadable(historyItem.result) ? onDownloadMAA : undefined}
          />
          {previewProfile && <PreviewUpgradePanel cdk={upgradeCdk} loading={upgradeLoading} error={upgradeError} onCdkChange={onUpgradeCdkChange} onSubmit={onUpgradePreviewProfile} />}
        </Suspense>
      )}

      {phase === 'suggestions' && currentResult && (
        <Suspense fallback={<ResultFallback />}>
          <ResultPanel
            result={currentResult}
            operators={operators}
            previewLimit={previewProfile ? currentResult.preview_limit : undefined}
            onDownload={!previewProfile ? onDownloadMAA : undefined}
            suggestionsSlot={!previewProfile && suggestions.length > 0 ? (
              <Suspense fallback={<ResultFallback />}>
                <UpgradeSuggestions
                  suggestions={suggestions}
                  onApply={onApplySuggestions}
                  loading={loading}
                  progress={progress?.mode === 'apply' ? progress : null}
                  error={inlineError?.scope === 'apply' ? inlineError.message : null}
                  onReset={onReset}
                  embedded
                />
              </Suspense>
            ) : null}
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
            onDownload={!previewProfile ? onDownloadMAA : undefined}
          />
          {previewProfile && <PreviewUpgradePanel cdk={upgradeCdk} loading={upgradeLoading} error={upgradeError} onCdkChange={onUpgradeCdkChange} onSubmit={onUpgradePreviewProfile} />}
        </Suspense>
      )}
    </section>
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
      <h3 className="text-base font-semibold text-ink-primary">解锁这个账号</h3>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">输入未使用的 CDK 后，当前预览档案会保留干员数据、森空岛绑定、基建配置和历史记录，并解锁完整结果。</p>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={cdk}
          onChange={(event) => onCdkChange(event.currentTarget.value)}
          className="tool-field flex-1 font-mono uppercase tracking-wide"
          placeholder="MAA-XXXX-XXXX-XXXX"
          aria-label="用于解锁的 CDK"
          required
        />
        <button type="submit" disabled={loading} className="tool-primary-action">
          {loading ? '解锁中...' : '使用 CDK 解锁'}
        </button>
      </div>
    </form>
  )
}
