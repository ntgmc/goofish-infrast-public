import { useEffect, useState, type ReactNode } from 'react'
import { Gem } from 'lucide-react'
import { copy } from '../../copy'
import ProductIcon from '../../components/ProductIcon'
import { AnimatedValue, RevealItem, StaggeredReveal } from '../../components/MotionPrimitives'
import { formatAmount, type PreparedResult } from '../../components/result-panel/formatters'
import { fetchResultHistoryDetail } from '../tool/optimize/optimization-api'
import { calculateProductionSanity } from '../../lib/production-sanity'
import type { OptimizeResult, WorkspaceResultHistorySummary } from '../../lib/types'

const text = copy.v2
const signedAmount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })

export default function ProductionSummary({ result, prepared, sample, profileId, resultId, history, newResult }: {
  result: OptimizeResult
  prepared: PreparedResult
  sample: boolean
  profileId?: string
  resultId?: string
  history: WorkspaceResultHistorySummary[]
  newResult: boolean
}) {
  const ordered = [...history].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
  const index = resultId ? ordered.findIndex((item) => item.id === resultId || item.job_id === resultId) : -1
  const previous = !sample ? ordered[index >= 0 ? index + 1 : newResult ? 0 : ordered.length] : undefined
  const previousId = previous?.id
  const requestKey = profileId && previousId ? `${profileId}:${previousId}` : null
  const [comparison, setComparison] = useState<{ key: string; result?: OptimizeResult; failed?: boolean } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!profileId || !previousId || !requestKey) return
    const controller = new AbortController()
    setComparison(null)
    void fetchResultHistoryDetail(profileId, previousId, controller.signal).then((item) => {
      if (!controller.signal.aborted) setComparison({ key: requestKey, result: item.result })
    }).catch(() => {
      if (!controller.signal.aborted) setComparison({ key: requestKey, failed: true })
    })
    return () => controller.abort()
  }, [profileId, previousId, requestKey, retry])

  const baseline = comparison?.key === requestKey ? comparison : null
  const daily = result.daily_production
  const priorDaily = baseline?.result?.daily_production
  const experience = (prepared.productionStats.manufacturing['Battle Record'] ?? 0) * 1000
  const economy = prepared.orundumEconomy
  const orundum = economy?.short_term_orundum ?? prepared.productionStats.orundum
  const isOrundum = Boolean(economy) || orundum > 0
  const showOrundum = isOrundum && experience === 0
  const goldNet = daily?.net?.['Pure Gold']
  const hasGoldNet = typeof goldNet === 'number' && Number.isFinite(goldNet)
  const burstNote = economy?.case === 'inventory_burst' && economy.inventory_depletion_days !== null
    ? text.inventoryBurstHint(formatAmount(economy.inventory_depletion_days)) : ''
  function change(value: number, before: number | undefined, unit: string) {
    if (!daily || !priorDaily || typeof before !== 'number' || !Number.isFinite(before)) return undefined
    const amount = signedAmount(value - before)
    return amount === '0' ? text.sameAsPrevious : text.changeSincePrevious(`${amount} ${unit}`)
  }

  return <>
    <StaggeredReveal className="v2-metrics">
      <Metric label={text.lmd} value={daily ? formatAmount(prepared.productionStats.lmd) : '—'} unit={text.daily} product="LMD"
        change={change(prepared.productionStats.lmd, priorDaily?.trading?.LMD ?? (priorDaily ? 0 : undefined), `${text.comparison.lmd} ${text.daily}`)} />
      <Metric label={showOrundum ? text.orundum : text.exp} value={daily ? formatAmount(showOrundum ? orundum : experience) : '—'}
        unit={showOrundum ? text.daily : text.expUnit} product={showOrundum ? 'Orundum' : 'Battle Record'}
        hint={showOrundum && economy ? [text.shortTermOrundumHint, burstNote].filter(Boolean).join(' · ') : undefined}
        change={showOrundum
          ? change(orundum, baseline?.result?.orundum_economy?.short_term_orundum ?? priorDaily?.trading?.Orundum ?? (priorDaily ? 0 : undefined), text.orundumUnit)
          : change(experience, priorDaily ? (priorDaily.manufacturing?.['Battle Record'] ?? 0) * 1000 : undefined, text.expUnit)} />
      <Metric label={text.goldNetChange} value={hasGoldNet ? signedAmount(goldNet) : '—'} unit={text.goldUnit} product="Pure Gold"
        hint={hasGoldNet ? goldNet < 0 ? text.goldDeficit : goldNet > 0 ? text.goldSurplus : text.goldBalanced : text.goldNetUnavailable}
        change={hasGoldNet ? change(goldNet, priorDaily?.net?.['Pure Gold'], text.goldUnit) : undefined} />
      {isOrundum ? <Metric label={text.shortTermPulls} value={daily ? (orundum * 30 / 600).toFixed(1) : '—'} unit={text.pullsPer30Days}
        icon={<Gem size={20} />}
        hint={text.shortTermPullsHint(formatAmount(orundum), burstNote || (economy ? text.orundumOutputSustainable : text.orundumDurationUnavailable))} />
        : <Metric label={text.sanity} value={daily ? prepared.productionSanity.value.toFixed(2) : '—'} unit={text.sanityUnit}
          icon={<img src="/assets/products/AP_GAMEPLAY.png" alt="" width={24} height={24} decoding="async" />}
          change={priorDaily ? change(prepared.productionSanity.value, calculateProductionSanity(priorDaily).value, text.sanityUnit) : undefined} />}
    </StaggeredReveal>
    <p className="v2-metrics-note">{text.outputSubtitle}</p>
    {!sample && <p className="v2-metrics-note" aria-live="polite">
      {!previous ? text.noPreviousProduction : !baseline ? text.loadingPreviousProduction : baseline.failed
        ? <>{text.previousProductionFailed} <button type="button" className="v2-text-button" onClick={() => setRetry((value) => value + 1)}>{text.retry}</button></>
        : !daily || !priorDaily ? text.previousProductionUnavailable
          : text.previousProductionBaseline(previous.name, new Date(previous.created_at).toLocaleString('zh-CN'))}
    </p>}
  </>
}

function Metric({ label, value, unit, hint, change, product, icon }: {
  label: string; value: string; unit: string; hint?: string; change?: string; product?: string; icon?: ReactNode
}) {
  return <RevealItem className="v2-metric"><section aria-label={label}>
    <div className="v2-metric-top"><span>{label}</span><span className="v2-metric-icon" aria-hidden="true">{product ? <ProductIcon product={product} size={24} /> : icon}</span></div>
    <p className="v2-metric-value"><AnimatedValue value={value} /><small>{unit}</small></p>
    {hint && <p className="v2-metric-hint">{hint}</p>}
    {change && <p className="v2-metric-change">{change}</p>}
  </section></RevealItem>
}
