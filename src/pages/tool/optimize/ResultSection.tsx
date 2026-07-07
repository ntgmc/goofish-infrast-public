import { lazy, Suspense } from 'react'
import type {
  OptimizeResult,
  UpgradeSuggestion,
  WorkspaceResultHistoryItem,
} from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
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
  suggestions,
  loading,
  progress,
  inlineError,
  onDownloadMAA,
  onApplySuggestions,
  onReset,
}: {
  phase: OptimizePhase;
  historyItem: WorkspaceResultHistoryItem | null;
  currentResult: OptimizeResult | null;
  finalResult: OptimizeResult | null;
  suggestions: UpgradeSuggestion[];
  loading: boolean;
  progress: ScheduleProgressState | null;
  inlineError: { scope: 'generate' | 'apply'; message: string } | null;
  onDownloadMAA: () => void;
  onApplySuggestions: (selectedIds: string[]) => Promise<void>;
  onReset: () => void;
}) {
  return (
    <section className="min-w-0">
      {phase === 'idle' && (
        <div className="rounded-xl border border-dashed border-surface-3 bg-surface-1/70 px-5 py-10 text-center">
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
            onDownload={isMaaJsonDownloadable(historyItem.result) ? onDownloadMAA : undefined}
          />
        </Suspense>
      )}

      {phase === 'suggestions' && currentResult && (
        <Suspense fallback={<ResultFallback />}>
          <ResultPanel
            result={currentResult}
            onDownload={onDownloadMAA}
            suggestionsSlot={suggestions.length > 0 ? (
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
        </Suspense>
      )}

      {phase === 'final' && finalResult && (
        <Suspense fallback={<ResultFallback />}>
          <ResultPanel
            result={finalResult}
            onDownload={onDownloadMAA}
          />
        </Suspense>
      )}
    </section>
  )
}
