import { useEffect, useMemo, useState } from 'react'
import ScheduleProgress from '../../../components/ScheduleProgress'
import { expandScenarioComparison, type ScenarioComparisonPoint } from '../../../lib/scenario-comparison'
import type { LicenseConfig, LicenseOperator } from '../../../lib/types'
import ScenarioFactors from './scenario-lab/ScenarioFactors'
import ScenarioParetoChart from './scenario-lab/ScenarioParetoChart'
import ScenarioResultsTable from './scenario-lab/ScenarioResultsTable'
import { useScenarioComparison } from './scenario-lab/useScenarioComparison'
import { copy, CURRENT_LOCALE } from '../../../copy/index'


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
    <section aria-labelledby="scenario-lab-title" className="grid min-w-0 gap-4">
      <div className="tool-panel min-w-0 p-5 sm:p-6">
        <div>
          <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_ScenarioLabSection_001}</p>
          <h2 id="scenario-lab-title" className="mt-1 text-lg font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_002}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_003}</p>
        </div>
        <div className="mt-5">
          <ScenarioFactors factors={factors} disabled={loading} onChange={setFactors} />
        </div>
        <div className="tool-inset mt-5 px-4 py-3 text-sm">
          {expansion.value ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink-secondary">
                {copy.optimize.pages_tool_optimize_ScenarioLabSection_004}{expansion.value.rawCombinationCount} {copy.optimize.pages_tool_optimize_ScenarioLabSection_005}{expansion.value.skipped.reduce((sum, item) => sum + item.count, 0)} {copy.optimize.pages_tool_optimize_ScenarioLabSection_006}</span>
              <span className="font-semibold tabular-nums text-ink-primary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_007}{expansion.value.scenarios.length}{copy.optimize.pages_tool_optimize_ScenarioLabSection_008}</span>
            </div>
          ) : <p role="alert" className="text-error">{expansion.error}</p>}
          {expansion.value?.skipped.map((item) => (
            <p key={item.code} className="mt-1 text-xs leading-5 text-ink-muted">{item.message}（{item.count} {copy.optimize.pages_tool_optimize_ScenarioLabSection_009}</p>
          ))}
        </div>
        {error && <div role="alert" className="tool-alert tool-alert--error mt-4">{error}</div>}
        <button
          type="button"
          disabled={loading || !expansion.value}
          onClick={() => void run()}
          className="tool-primary-action mt-4 w-full"
        >
          {loading ? copy.optimize.pages_tool_optimize_ScenarioLabSection_010 : `${copy.optimize.pages_tool_optimize_ScenarioLabSection_011}${expansion.value?.scenarios.length ?? 0}${copy.optimize.pages_tool_optimize_ScenarioLabSection_012}`}
        </button>
      </div>

      <div className="min-w-0 space-y-4">
        {progress && <ScheduleProgress progress={progress} variant="focus" />}
        {!result && !progress && (
          <div className="tool-panel border-dashed px-5 py-12 text-center">
            <p className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_013}</p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_014}</p>
          </div>
        )}
        {result && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryStat label={copy.optimize.pages_tool_optimize_ScenarioLabSection_015} value={String(result.scenarioCount)} note={`${copy.optimize.pages_tool_optimize_ScenarioLabSection_016}${result.screeningCount}`} />
              <SummaryStat label={copy.optimize.pages_tool_optimize_ScenarioLabSection_017} value={String(result.verifiedCount)} note={copy.optimize.pages_tool_optimize_ScenarioLabSection_018} />
              <SummaryStat label={copy.optimize.pages_tool_optimize_ScenarioLabSection_019} value={String(result.frontierScenarioIds.length)} note={result.failedCount > 0 ? `${copy.optimize.pages_tool_optimize_ScenarioLabSection_020}${result.failedCount}${copy.optimize.pages_tool_optimize_ScenarioLabSection_021}` : copy.optimize.pages_tool_optimize_ScenarioLabSection_022} />
            </div>
            <div className="tool-panel p-4 sm:p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_023}</h2>
                <p className="mt-1 text-xs leading-5 text-ink-muted">{copy.optimize.pages_tool_optimize_ScenarioLabSection_024}</p>
              </div>
              <ScenarioParetoChart points={result.points} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            {selected && <SelectedScenario point={selected} onApply={() => onApplyConfig(selected.config)} />}
            {result.warnings.map((warning) => <div key={warning} className="tool-alert tool-alert--warning" role="status">{warning}</div>)}
            <div className="tool-panel p-4 sm:p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_ScenarioLabSection_025}</h2>
                <p className="mt-1 text-xs leading-5 text-ink-muted">{copy.optimize.pages_tool_optimize_ScenarioLabSection_026}</p>
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
  return <div className="tool-inset p-4"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-ink-primary">{value}</p><p className="mt-1 text-xs text-ink-secondary">{note}</p></div>
}

function SelectedScenario({ point, onApply }: { point: ScenarioComparisonPoint; onApply: () => void }) {
  const value = point.verified ?? point.screening
  const economy = value?.orundumEconomy
  return (
    <div className="tool-panel flex flex-col gap-4 border-brand-500/25 bg-brand-600/10 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_ScenarioLabSection_027}</p>
        <h3 className="mt-1 text-sm font-semibold text-ink-primary">{point.label}</h3>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {value ? `${value.productionSanityPerDay.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 1 })}${copy.optimize.pages_tool_optimize_ScenarioLabSection_028}${point.shiftHours.join('-')}${copy.optimize.pages_tool_optimize_ScenarioLabSection_029}${point.operationsPerDay}${copy.optimize.pages_tool_optimize_ScenarioLabSection_030}${point.verified ? copy.optimize.pages_tool_optimize_ScenarioLabSection_031 : copy.optimize.pages_tool_optimize_ScenarioLabSection_032}` : point.error}
        </p>
        {value && point.scheduleStrategy === 'variable' && (
          <p className="mt-1 text-xs leading-5 text-ink-muted">{point.variableShiftFallback ? copy.optimize.pages_tool_optimize_ScenarioLabSection_033 : copy.optimize.pages_tool_optimize_ScenarioLabSection_034}</p>
        )}
        {economy && (
          <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <Detail label={copy.optimize.pages_tool_optimize_ScenarioLabSection_035} value={`${formatNumber(economy.sustainablePerDay)} / ${formatNumber(economy.shortTermPerDay)}`} />
            <Detail label={copy.optimize.pages_tool_optimize_ScenarioLabSection_036} value={`${formatNumber(economy.opportunityCostSanityPerDay)}${copy.optimize.pages_tool_optimize_ScenarioLabSection_037}`} />
            <Detail label={copy.optimize.pages_tool_optimize_ScenarioLabSection_038} value={economy.inventoryDepletionDays == null ? '—' : `${formatNumber(economy.inventoryDepletionDays)}${copy.optimize.pages_tool_optimize_ScenarioLabSection_039}`} />
            <Detail label={copy.optimize.pages_tool_optimize_ScenarioLabSection_040} value={`${economyCaseLabel(economy.case)} · ${bottleneckLabel(economy.bottleneck)}${copy.optimize.pages_tool_optimize_ScenarioLabSection_041}${formatNumber(economy.dailySanityBudget)}${economy.monthlyCard ? copy.optimize.pages_tool_optimize_ScenarioLabSection_042 : ''}`} />
          </dl>
        )}
      </div>
      <button type="button" onClick={onApply} disabled={!value} className="tool-primary-action shrink-0">
        {copy.optimize.pages_tool_optimize_ScenarioLabSection_043}</button>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink-muted">{label}</dt><dd className="mt-0.5 font-medium tabular-nums text-ink-primary">{value}</dd></div>
}

function formatNumber(value: number): string {
  return value.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 1 })
}

function economyCaseLabel(value: NonNullable<NonNullable<ScenarioComparisonPoint['screening']>['orundumEconomy']>['case']): string {
  return ({ capacity_limited: copy.optimize.pages_tool_optimize_ScenarioLabSection_044, budget_limited: copy.optimize.pages_tool_optimize_ScenarioLabSection_045, inventory_burst: copy.optimize.pages_tool_optimize_ScenarioLabSection_046 })[value]
}

function bottleneckLabel(value: NonNullable<NonNullable<ScenarioComparisonPoint['screening']>['orundumEconomy']>['bottleneck']): string {
  return ({ orirock_budget: copy.optimize.pages_tool_optimize_ScenarioLabSection_047, manufacture: copy.optimize.pages_tool_optimize_ScenarioLabSection_048, trading: copy.optimize.pages_tool_optimize_ScenarioLabSection_049, inventory: copy.optimize.pages_tool_optimize_ScenarioLabSection_050 })[value]
}
