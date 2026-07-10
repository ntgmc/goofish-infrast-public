import { useEffect, useMemo, useState } from 'react'
import ScheduleProgress from '../../../components/ScheduleProgress'
import { expandScenarioComparison, type ScenarioComparisonPoint } from '../../../lib/scenario-comparison'
import type { LicenseConfig, LicenseOperator } from '../../../lib/types'
import ScenarioFactors from './scenario-lab/ScenarioFactors'
import ScenarioParetoChart from './scenario-lab/ScenarioParetoChart'
import ScenarioResultsTable from './scenario-lab/ScenarioResultsTable'
import { useScenarioComparison } from './scenario-lab/useScenarioComparison'

export default function ScenarioLabSection({
  profileId,
  operators,
  activeConfig,
  onApplyConfig,
}: {
  profileId: string;
  operators: LicenseOperator[];
  activeConfig: LicenseConfig;
  onApplyConfig: (config: LicenseConfig) => void;
}) {
  const { factors, setFactors, result, error, loading, progress, run } = useScenarioComparison({
    profileId,
    operators,
    config: activeConfig,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const expansion = useMemo(() => {
    try {
      return { value: expandScenarioComparison(activeConfig, factors), error: null }
    } catch (caught) {
      return { value: null, error: caught instanceof Error ? caught.message : String(caught) }
    }
  }, [activeConfig, factors])

  useEffect(() => {
    if (!result) return
    const preferred = result.frontierScenarioIds[0] ?? result.points.find((point) => point.status === 'succeeded')?.id ?? null
    setSelectedId((current) => result.points.some((point) => point.id === current) ? current : preferred)
  }, [result])

  const selected = result?.points.find((point) => point.id === selectedId) ?? null
  return (
    <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(340px,0.46fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <div>
          <p className="text-sm font-semibold text-brand-400">组合网格</p>
          <h2 className="mt-1 text-lg font-semibold text-ink-primary">定义比较场景</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">使用当前账号干员和固定非实验参数；结果不会写入排班历史。</p>
        </div>
        <div className="mt-5">
          <ScenarioFactors factors={factors} disabled={loading} onChange={setFactors} />
        </div>
        <div className="mt-5 rounded-lg border border-surface-3 bg-surface-2/55 px-4 py-3 text-sm">
          {expansion.value ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink-secondary">
                原始 {expansion.value.rawCombinationCount} 组 · 跳过 {expansion.value.skipped.reduce((sum, item) => sum + item.count, 0)} 组
              </span>
              <span className="font-semibold tabular-nums text-ink-primary">有效 {expansion.value.scenarios.length}/24 组</span>
            </div>
          ) : <p role="alert" className="text-error">{expansion.error}</p>}
          {expansion.value?.skipped.map((item) => (
            <p key={item.code} className="mt-1 text-xs leading-5 text-ink-muted">{item.message}（{item.count} 组）</p>
          ))}
        </div>
        {error && <div role="alert" className="mt-4 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
        <button
          type="button"
          disabled={loading || !expansion.value}
          onClick={() => void run()}
          className="mt-4 min-h-11 w-full rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/45 focus:ring-offset-2 focus:ring-offset-surface-1 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '场景比较进行中...' : `运行 ${expansion.value?.scenarios.length ?? 0} 个场景`}
        </button>
      </div>

      <div className="min-w-0 space-y-4">
        {progress && <ScheduleProgress progress={progress} variant="focus" />}
        {!result && !progress && (
          <div className="rounded-xl border border-dashed border-surface-3 bg-surface-1/70 px-5 py-12 text-center">
            <p className="text-base font-semibold text-ink-primary">配置组合后运行实验</p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">先快速筛选全部场景，再精确复核每个操作成本档位的前三名。</p>
          </div>
        )}
        {result && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryStat label="有效场景" value={String(result.scenarioCount)} note={`快速成功 ${result.screeningCount}`} />
              <SummaryStat label="精确复核" value={String(result.verifiedCount)} note="每档最多 3 个" />
              <SummaryStat label="Pareto 前沿" value={String(result.frontierScenarioIds.length)} note={result.failedCount > 0 ? `失败 ${result.failedCount} 个` : '无整体失败'} />
            </div>
            <div className="rounded-xl border border-surface-3 bg-surface-1 p-4 sm:p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary">产量与操作成本</h2>
                <p className="mt-1 text-xs leading-5 text-ink-muted">横轴越左换班越少，纵轴越高等效理智越多。前沿仅使用精确复核结果。</p>
              </div>
              <ScenarioParetoChart points={result.points} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            {selected && <SelectedScenario point={selected} onApply={() => onApplyConfig(selected.config)} />}
            {result.warnings.map((warning) => <div key={warning} className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{warning}</div>)}
            <div className="rounded-xl border border-surface-3 bg-surface-1 p-4 sm:p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary">全部场景</h2>
                <p className="mt-1 text-xs leading-5 text-ink-muted">默认优先显示已验证前沿；点击列头排序或选择场景。</p>
              </div>
              <ScenarioResultsTable points={result.points} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function SummaryStat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-xl border border-surface-3 bg-surface-1 p-4"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-ink-primary">{value}</p><p className="mt-1 text-xs text-ink-secondary">{note}</p></div>
}

function SelectedScenario({ point, onApply }: { point: ScenarioComparisonPoint; onApply: () => void }) {
  const value = point.verified ?? point.screening
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-brand-500/25 bg-brand-600/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-brand-300">已选择场景</p>
        <h3 className="mt-1 text-sm font-semibold text-ink-primary">{point.label}</h3>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {value ? `${value.productionSanityPerDay.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 理智/日 · ${point.operationsPerDay} 次换班/日 · ${point.verified ? '精确结果' : '快速结果'}` : point.error}
        </p>
      </div>
      <button type="button" onClick={onApply} disabled={!value} className="min-h-11 shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/45 disabled:bg-surface-3 disabled:text-ink-muted">
        应用到当前配置
      </button>
    </div>
  )
}
