import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { copy } from '../../../copy'
import { expandScenarioComparison, SCENARIO_COMPARISON_MAX_ADDITIONAL_CONFIGS, SCENARIO_LAYOUT_LABELS, type ScenarioComparisonFactors, type ScenarioLayout, type ScenarioProductionPlan } from '../../../lib/scenario-comparison'
import { useScenarioComparison } from '../../tool/optimize/scenario-lab/useScenarioComparison'
import { LAYOUTS, SCHEDULES, DRONES, buildPlan, planLabel, planKey } from '../../tool/optimize/scenario-lab/ScenarioFactors'
import ComparisonResults from './ComparisonResults'
import ScheduleProgress from '../../../components/ScheduleProgress'
import ProductIcon from '../../../components/ProductIcon'
import { PRODUCT_LABELS } from '../../../components/result-panel/labels'
import type { V2Workflow } from '../WorkspaceSections'
import { EmptyState, Notice, SectionTitle } from '../components/WorkspaceUI'
import Link from '../../../components/InternalLink'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { productPolicies } from '../../../lib/product-catalog'

const text = copy.optimize
const ui = copy.v2.comparison

export default function Comparison({ workflow: w, onConfig }: { workflow: V2Workflow; onConfig: () => void }) {
  return w.userCanUseScenarioLab ? <ComparisonWorkspace key={w.profile.id} workflow={w} onConfig={onConfig} /> : <ComparisonPreview />
}

function ComparisonWorkspace({ workflow: w, onConfig }: { workflow: V2Workflow; onConfig: () => void }) {
  const model = useScenarioComparison({ profileId: w.profile.id, operators: w.mergedOperators, config: w.activeConfig, onSettled: w.refreshInventory })
  const expansion = useMemo(() => { try { return { value: expandScenarioComparison(w.activeConfig, model.factors), error: null } } catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : String(caught) } } }, [w.activeConfig, model.factors])
  const skippedCount = expansion.value?.skipped.reduce((sum, item) => sum + item.count, 0) ?? 0
  const quoteUnavailable = w.scenarioQuoteRequired && (!w.scenarioBillingQuote || w.scenarioBillingQuoteLoading || !w.scenarioBillingQuote.sufficient)
  return <div className="v2-comparison-workspace"><section className="v2-experiment-builder"><SectionTitle title={copy.v2.comparison.builderTitle} description={copy.v2.comparison.builderDescription} /><Factors factors={model.factors} disabled={model.loading} onChange={model.setFactors} />
    <div className="v2-experiment-run">
      <div aria-live="polite">{expansion.value ? <strong>{ui.scenarioCount(expansion.value.scenarios.length)}</strong> : <Notice error>{expansion.error}</Notice>}</div>
      <button type="button" className="v2-button v2-button-primary" disabled={model.loading || !expansion.value || quoteUnavailable} onClick={() => void model.run(false, w.scenarioBillingQuote)}>{model.loading ? ui.running : ui.run}</button>
    </div>
    {skippedCount > 0 && <details className="v2-comparison-skips"><summary>{ui.skippedCount(skippedCount)}</summary><ul>{expansion.value?.skipped.map((item) => <li key={`${item.code}:${item.droneStrategy}`}>{ui.skippedItem(item.message, item.count)}</li>)}</ul></details>}
    {w.scenarioQuoteRequired && <Notice>{w.scenarioBillingQuoteLoading ? text.pages_tool_optimize_ScenarioLabSection_055 : w.scenarioBillingQuoteError ?? (w.scenarioBillingQuote?.sufficient === false ? text.pages_tool_optimize_ScenarioLabSection_056 : text.pages_tool_optimize_ScenarioLabSection_057)}{w.scenarioBillingQuoteError && <button className="v2-text-button" onClick={() => void w.refreshScenarioBillingQuote()}>{text.pages_tool_optimize_ScenarioLabSection_058}</button>}</Notice>}
    <Notice error>{model.error}</Notice>
  </section>
  {model.progress && <div className="v2-experiment-progress"><ScheduleProgress progress={model.progress} variant="focus" />{model.canCancel && <button className="v2-button v2-button-secondary" disabled={model.cancelling} onClick={() => { if (window.confirm(text.pages_tool_optimize_ScenarioLabSection_052)) void model.cancel() }}>{model.cancelling ? text.pages_tool_optimize_ScenarioLabSection_053 : text.pages_tool_optimize_ScenarioLabSection_051}</button>}</div>}
  {!model.result && !model.progress && <EmptyState title={copy.v2.comparison.emptyTitle}>{copy.v2.comparison.emptyDescription}</EmptyState>}
  {model.result && <ComparisonResults result={model.result} disabled={w.loading || model.loading || !w.userCanEditConfig} onApply={(config) => { w.handleApplyScenarioConfig(config); onConfig() }} />}
  </div>
}

function Factors({ factors, disabled, onChange }: { factors: ScenarioComparisonFactors; disabled: boolean; onChange: (next: ScenarioComparisonFactors) => void }) {
  const [layoutId, setLayoutId] = useState<ScenarioLayout>('243')
  const [orundum, setOrundum] = useState(0)
  const [shard, setShard] = useState(0)
  const [gold, setGold] = useState(2)
  const layout = LAYOUTS.find((item) => item.id === layoutId)!
  const draft = buildPlan(layout, Math.min(orundum, layout.trading), Math.min(shard, layout.manufacturing), Math.min(gold, layout.manufacturing - Math.min(shard, layout.manufacturing)))
  const count = factors.layouts.reduce((sum, entry) => sum + entry.plans.length, 0)
  const duplicate = factors.layouts.find((entry) => entry.layout === layoutId)?.plans.some((plan) => planKey(plan) === planKey(draft))
  const hasMaa = factors.maaSchedules.length > 0

  return <fieldset className="v2-experiment-factors" disabled={disabled}>
    <legend className="sr-only">{ui.builderTitle}</legend>
    <section className="v2-production-builder">
      <h3>{ui.productionPlans}</h3>
      <div className="v2-production-editor">
        <label className="v2-field"><span>{ui.layout}</span>
          <select className="v2-input" aria-label={ui.layout} value={layoutId} onChange={(event) => setLayoutId(event.target.value as ScenarioLayout)}>
            {LAYOUTS.map((item) => <option key={item.id} value={item.id}>{SCENARIO_LAYOUT_LABELS[item.id]}</option>)}
          </select>
        </label>
        <fieldset className="v2-production-allocation"><legend>{ui.tradingStations}<small>{ui.stationCount(layout.trading)}</small></legend>
          <div>
            <ProductCount product="Orundum" value={draft.trading.orundum} max={layout.trading} onChange={setOrundum} />
            <ProductCount product="LMD" value={draft.trading.lmd} />
          </div>
        </fieldset>
        <fieldset className="v2-production-allocation"><legend>{ui.manufacturingStations}<small>{ui.stationCount(layout.manufacturing)}</small></legend>
          <div>
            <ProductCount product="Originium Shard" value={draft.manufacturing.originiumShard} max={layout.manufacturing} onChange={setShard} />
            <ProductCount product="Pure Gold" value={draft.manufacturing.pureGold} max={layout.manufacturing - draft.manufacturing.originiumShard} onChange={setGold} />
            <ProductCount product="Battle Record" value={draft.manufacturing.battleRecord} />
          </div>
        </fieldset>
      </div>
      <div className="v2-production-add"><p>{ui.allocationHelp}</p>
        <button type="button" className="v2-button v2-button-secondary" disabled={duplicate || count >= SCENARIO_COMPARISON_MAX_ADDITIONAL_CONFIGS} onClick={() => {
          const layouts = factors.layouts.filter((item) => item.layout !== layoutId)
          layouts.push({ layout: layoutId, plans: [...(factors.layouts.find((item) => item.layout === layoutId)?.plans ?? []), draft].sort((a, b) => planKey(a).localeCompare(planKey(b))) })
          onChange({ ...factors, layouts: layouts.sort((a, b) => a.layout.localeCompare(b.layout)) })
        }}><Plus size={16} aria-hidden="true" />{duplicate ? ui.duplicatePlan : count >= SCENARIO_COMPARISON_MAX_ADDITIONAL_CONFIGS ? ui.planLimit : ui.addPlan}</button>
      </div>
      <div className="v2-production-selected">
        <h4>{ui.selectedPlans(count, SCENARIO_COMPARISON_MAX_ADDITIONAL_CONFIGS)}</h4>
        {count === 0 ? <p className="v2-muted">{ui.noPlans}</p> : <ul className="v2-production-plans">
          {factors.layouts.flatMap((entry) => entry.plans.map((plan) => <li key={`${entry.layout}:${planKey(plan)}`}>
            <b>{SCENARIO_LAYOUT_LABELS[entry.layout]}</b><ProductionSummary plan={plan} />
            <button type="button" className="v2-icon-button" aria-label={`${text.pages_tool_optimize_scenario_lab_ScenarioFactors_026}${SCENARIO_LAYOUT_LABELS[entry.layout]} ${planLabel(plan)}`} onClick={() => onChange({ ...factors, layouts: factors.layouts.map((row) => row.layout === entry.layout ? { ...row, plans: row.plans.filter((item) => planKey(item) !== planKey(plan)) } : row).filter((row) => row.plans.length > 0) })}><X size={16} aria-hidden="true" /></button>
          </li>))}
        </ul>}
      </div>
    </section>
    <div className="v2-experiment-options">
      <fieldset><legend>{ui.schedules}<small>{ui.multipleChoice}</small></legend>
        <div className="v2-schedule-choices">
          {SCHEDULES.map((item) => <label className="v2-factor-choice" key={item.id}>
            <input type="checkbox" checked={factors.maaSchedules.includes(item.id)} onChange={() => onChange({ ...factors, maaSchedules: factors.maaSchedules.includes(item.id) ? factors.maaSchedules.filter((id) => id !== item.id) : [...factors.maaSchedules, item.id].sort((a, b) => ['variable', '8x3'].indexOf(a) - ['variable', '8x3'].indexOf(b)) })} />
            <span><strong>{ui.scheduleOptions[item.id].label}</strong><small>{ui.scheduleOptions[item.id].detail}</small></span>
          </label>)}
          <label className="v2-factor-choice"><input type="checkbox" checked={factors.includeRotation} onChange={() => onChange({ ...factors, includeRotation: !factors.includeRotation })} /><span><strong>{ui.scheduleOptions.rotation.label}</strong><small>{ui.scheduleOptions.rotation.detail}</small></span></label>
        </div>
      </fieldset>
      <fieldset disabled={!hasMaa}><legend>{ui.drones}<small>{ui.multipleChoice}</small></legend>
        <div className="v2-drone-choices">
          {DRONES.map((item) => <label className="v2-factor-choice" key={item.id}>
            <input type="checkbox" checked={factors.droneStrategies.includes(item.id)} onChange={() => onChange({ ...factors, droneStrategies: factors.droneStrategies.includes(item.id) ? factors.droneStrategies.filter((id) => id !== item.id) : [...factors.droneStrategies, item.id] })} />
            <span>{item.label}</span>
          </label>)}
        </div>
        <p className="v2-muted">{hasMaa ? ui.dronesHelp : ui.dronesInactive}</p>
      </fieldset>
    </div>
  </fieldset>
}

function ProductCount({ product, value, max = 0, onChange }: { product: string; value: number; max?: number; onChange?: (value: number) => void }) {
  const label = ui.productCount(PRODUCT_LABELS[product])
  return <div className="v2-product-count">
    <span><ProductIcon product={product} size={24} />{PRODUCT_LABELS[product]}</span>
    {onChange ? <select className="v2-input" aria-label={label} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{ui.stationCount(i)}</option>)}
    </select> : <output aria-label={label}><strong>{ui.stationCount(value)}</strong><small>{ui.automatic}</small></output>}
  </div>
}

function ProductionSummary({ plan }: { plan: ScenarioProductionPlan }) {
  return <div className="v2-production-summary">{([
    ['LMD', plan.trading.lmd], ['Orundum', plan.trading.orundum],
    ['Pure Gold', plan.manufacturing.pureGold], ['Battle Record', plan.manufacturing.battleRecord], ['Originium Shard', plan.manufacturing.originiumShard],
  ] as const).filter(([, count]) => count > 0).map(([product, count]) => <span key={product}><ProductIcon product={product} size={20} />{PRODUCT_LABELS[product]}<b>×{count}</b></span>)}</div>
}

function ComparisonPreview() {
  const { features } = useSiteFeatures()
  return <div className="v2-comparison-preview"><SectionTitle title={text.paid_preview.lab_title} description={text.paid_preview.lab_description} /><fieldset disabled className="v2-preview-fields"><legend>{text.paid_preview.readonly}</legend><label className="v2-field"><span>{text.paid_preview.baseline}</span><input className="v2-input" value={text.paid_preview.baseline} readOnly /></label><label className="v2-field"><span>{text.paid_preview.alternative}</span><select className="v2-input"><option>{text.paid_preview.add}</option></select></label><button className="v2-button v2-button-secondary">{text.paid_preview.run}</button></fieldset><Notice>{text.paid_preview.pending}</Notice><p>{text.paid_preview.lab_detail}</p><p>{text.paid_preview.quotas(productPolicies.metered_billing.scenario_quotas.month, productPolicies.metered_billing.scenario_quotas.half_year, productPolicies.metered_billing.scenario_quotas.year)}</p>{features.pricing && <Link className="v2-text-button" to="/pricing">{text.paid_preview.compare}</Link>}</div>
}
