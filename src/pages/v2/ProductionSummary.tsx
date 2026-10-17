import { useEffect, useState, type ReactNode } from 'react'
import { ComparePreviousIcon as ArrowRightLeft, ConfigIcon as Settings2 } from '../../components/icons'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { copy } from '../../copy'
import ProductIcon from '../../components/ProductIcon'
import { AnimatedValue, RevealItem, StaggeredReveal } from '../../components/MotionPrimitives'
import { formatAmount, formatIntermediateDepletionSummary, type PreparedResult } from '../../components/result-panel/formatters'
import { fetchResultHistoryDetail } from '../tool/optimize/optimization-api'
import { calculateProductionSanity } from '../../lib/production-sanity'
import { describeConfigDiff } from '../../lib/workspace-history'
import type { LicenseConfig, OptimizeResult, WorkspaceResultHistoryItem, WorkspaceResultHistorySummary } from '../../lib/types'

const text = copy.v2
const signedAmount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })

export default function ProductionSummary({ result, prepared, sample, profileId, resultId, resultConfig, history, newResult, onConfigure }: {
  result: OptimizeResult
  prepared: PreparedResult
  sample: boolean
  profileId?: string
  resultId?: string
  resultConfig?: LicenseConfig | null
  history: WorkspaceResultHistorySummary[]
  newResult: boolean
  onConfigure: () => void
}) {
  const ordered = [...history].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
  const index = resultId ? ordered.findIndex((item) => item.id === resultId || item.job_id === resultId) : -1
  const previous = !sample ? ordered[index >= 0 ? index + 1 : newResult ? 0 : ordered.length] : undefined
  const previousId = previous?.id
  const requestKey = profileId && previousId ? `${profileId}:${resultId ?? 'new'}:${previousId}` : null
  const [comparison, setComparison] = useState<{ key: string; item?: WorkspaceResultHistoryItem; config?: LicenseConfig | null; failed?: boolean } | null>(null)
  const [retry, setRetry] = useState(0)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  useEffect(() => {
    if (!profileId || !previousId || !requestKey) return
    const controller = new AbortController()
    setComparison(null)
    const currentConfig = resultConfig !== undefined ? Promise.resolve(resultConfig)
      : resultId ? fetchResultHistoryDetail(profileId, resultId, controller.signal).then((item) => item.config).catch(() => undefined)
        : Promise.resolve(null)
    void Promise.all([fetchResultHistoryDetail(profileId, previousId, controller.signal), currentConfig]).then(([item, config]) => {
      if (!controller.signal.aborted) setComparison({ key: requestKey, item, config })
    }).catch(() => {
      if (!controller.signal.aborted) setComparison({ key: requestKey, failed: true })
    })
    return () => controller.abort()
  }, [profileId, resultId, resultConfig, previousId, requestKey, retry])

  const baseline = comparison?.key === requestKey ? comparison : null
  const daily = result.daily_production
  const priorDaily = baseline?.item?.result.daily_production
  const experience = (prepared.productionStats.manufacturing['Battle Record'] ?? 0) * 1000
  const economy = prepared.orundumEconomy
  const orundum = economy?.short_term_orundum ?? prepared.productionStats.orundum
  const isOrundum = Boolean(economy) || orundum > 0
  const showOrundum = isOrundum && experience === 0
  const goldNet = daily?.net?.['Pure Gold']
  const hasGoldNet = typeof goldNet === 'number' && Number.isFinite(goldNet)
  const goldDays = result.inventory_warnings?.find((item) => item.product === 'Pure Gold')?.days_remaining
    ?? prepared.intermediateDepletion.find((item) => item.product === 'Pure Gold')?.daysRemaining
  const goldInventoryHint = hasGoldNet && goldNet < 0
    ? typeof goldDays !== 'number' || !Number.isFinite(goldDays) ? text.goldInventoryUnknown
      : goldDays <= 0 ? text.goldInventoryDepleted
        : goldDays < 1 ? text.goldInventoryToday
          : text.goldInventoryDuration(String(Math.floor(goldDays)))
    : undefined
  const otherInventory = result.schedule_mode !== 'rotation'
    ? formatIntermediateDepletionSummary(prepared.intermediateDepletion.filter((item) => item.product !== 'Pure Gold' && item.daysRemaining !== null)) : ''
  const burstNote = economy?.case === 'inventory_burst' && economy.inventory_depletion_days !== null
    ? text.inventoryBurstHint(formatAmount(economy.inventory_depletion_days)) : ''
  function change(value: number | undefined, before: number | undefined, unit = '') {
    if (!daily || !priorDaily || typeof value !== 'number' || !Number.isFinite(value) || typeof before !== 'number' || !Number.isFinite(before)) return text.productionChangeUnavailable
    const difference = value - before
    return Math.abs(difference) < 0.005 ? text.sameAsPrevious : `${signedAmount(difference)} ${unit}`.trim()
  }
  const changes = [
    { label: text.lmd, value: prepared.productionStats.lmd, before: priorDaily?.trading?.LMD ?? (priorDaily ? 0 : undefined), unit: `${text.comparison.lmd} ${text.daily}` },
    { label: showOrundum ? text.orundum : text.exp, value: showOrundum ? orundum : experience,
      before: showOrundum ? baseline?.item?.result.orundum_economy?.short_term_orundum ?? priorDaily?.trading?.Orundum ?? (priorDaily ? 0 : undefined)
        : priorDaily ? (priorDaily.manufacturing?.['Battle Record'] ?? 0) * 1000 : undefined,
      unit: showOrundum ? text.orundumUnit : text.expUnit },
    { label: text.goldNetChange, value: goldNet, before: priorDaily?.net?.['Pure Gold'], unit: text.goldUnit },
    ...(!isOrundum ? [{ label: text.sanity, value: prepared.productionSanity.value, before: priorDaily ? calculateProductionSanity(priorDaily).value : undefined, unit: text.sanityUnit }] : []),
  ].map(({ label, value, before, unit }) => ({ label, value: change(value, before, unit), compact: change(value, before) }))
  const configChanges = baseline?.config && baseline.item?.config ? describeConfigDiff(baseline.config, baseline.item.config) : null
  const showChanges = Boolean(daily && priorDaily)
  const goldHint = goldInventoryHint ?? (hasGoldNet ? goldNet > 0 ? text.goldSurplus : text.goldBalanced : text.goldNetUnavailable)

  return <>
    <StaggeredReveal className="v2-metrics">
      <Metric label={text.lmd} value={daily ? formatAmount(prepared.productionStats.lmd) : '—'} unit={text.daily} product="LMD"
        change={showChanges ? changes[0].compact : undefined} />
      <Metric label={showOrundum ? text.orundum : text.exp} value={daily ? formatAmount(showOrundum ? orundum : experience) : '—'}
        unit={showOrundum ? text.daily : text.expUnit} product={showOrundum ? 'Orundum' : 'Battle Record'}
        hint={showOrundum && economy ? [text.shortTermOrundumHint, burstNote].filter(Boolean).join(' · ') : undefined}
        change={showChanges ? changes[1].compact : undefined} />
      <Metric label={text.goldNetChange} value={hasGoldNet ? signedAmount(goldNet) : '—'} unit={text.goldUnit} product="Pure Gold">
        <button type="button" className="v2-text-button v2-metric-inventory" onClick={onConfigure} title={text.adjustProduction}>
          <span>{goldHint}</span><Settings2 size={14} aria-hidden="true" /><span className="sr-only">{text.adjustProduction}</span>
        </button>
      </Metric>
      {isOrundum ? <Metric label={text.shortTermPulls} value={daily ? (orundum * 30 / 600).toFixed(1) : '—'} unit={text.pullsPer30Days}
        icon={<img src="/assets/products/TKT_GACHA.png" alt="" width={24} height={24} decoding="async" />}
        hint={text.shortTermPullsHint(formatAmount(orundum), burstNote || (economy ? text.orundumOutputSustainable : text.orundumDurationUnavailable))} />
        : <Metric label={text.sanity} value={daily ? prepared.productionSanity.value.toFixed(2) : '—'} unit={text.sanityUnit}
          icon={<img src="/assets/products/AP_GAMEPLAY.png" alt="" width={24} height={24} decoding="async" />}
          change={showChanges ? changes[3]?.compact : undefined} />}
    </StaggeredReveal>
    <div className="v2-metrics-meta">
      <p>{text.outputSubtitle}</p>
      {!sample && <button type="button" className="v2-text-button" aria-haspopup="dialog" aria-expanded={comparisonOpen} onClick={() => setComparisonOpen(true)}>
        <ArrowRightLeft size={14} aria-hidden="true" />{text.comparePrevious}
      </button>}
    </div>
    {otherInventory && <p className="v2-metrics-note">{text.intermediateInventory}：{otherInventory}</p>}
    {!sample && <Dialog open={comparisonOpen} onOpenChange={setComparisonOpen}>
      <DialogContent className="v2-drawer v2-drawer-wide" showCloseButton closeLabel={text.close}>
      <div className="v2-drawer-heading">
      <DialogTitle>{text.resultComparison}</DialogTitle>
      <DialogDescription aria-live="polite">
        {!previous ? text.noPreviousProduction : !baseline ? text.loadingPreviousProduction : baseline.failed
          ? <>{text.previousProductionFailed} <button type="button" className="v2-text-button" onClick={() => setRetry((value) => value + 1)}>{text.retry}</button></>
          : text.previousProductionBaseline(previous.name, new Date(previous.created_at).toLocaleString('zh-CN'))}
      </DialogDescription>
      </div>
      {baseline?.item && <div className="v2-drawer-body v2-comparison-columns">
        <section aria-label={text.productionChanges}>
          <h3>{text.productionChanges}</h3>
          {daily && priorDaily ? <dl className="v2-production-changes">{changes.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            : <p className="v2-metrics-note">{text.previousProductionUnavailable}</p>}
        </section>
        <section aria-label={text.resultConfigChanges}>
          <h3>{text.resultConfigChanges}</h3>
          {baseline.config === undefined ? <p className="v2-metrics-note">{text.resultConfigReadFailed} <button type="button" className="v2-text-button" onClick={() => setRetry((value) => value + 1)}>{text.retry}</button></p>
            : configChanges ? configChanges.length ? <dl className="v2-result-config-changes">{configChanges.map((row) => <div key={row.label}>
              <dt>{row.label}</dt><dd><span className="sr-only">{copy.optimize.pages_tool_optimize_ConfigSection_012}</span><span>{row.before}</span><span aria-hidden="true"> → </span><span className="sr-only">{copy.optimize.pages_tool_optimize_ConfigSection_013}</span><strong>{row.after}</strong></dd>
            </div>)}</dl>
              : <p className="v2-metrics-note">{text.resultConfigUnchanged}</p>
              : <p className="v2-metrics-note">{text.resultConfigUnavailable}</p>}
        </section>
      </div>}
      </DialogContent>
    </Dialog>}
  </>
}

function Metric({ label, value, unit, hint, change, product, icon, children }: {
  label: string; value: string; unit: string; hint?: string; change?: string; product?: string; icon?: ReactNode; children?: ReactNode
}) {
  return <RevealItem className="v2-metric"><section aria-label={label}>
    <div className="v2-metric-top"><span>{label}</span><span className="v2-metric-icon" aria-hidden="true">{product ? <ProductIcon product={product} size={24} /> : icon}</span></div>
    <p className="v2-metric-value"><AnimatedValue value={value} /><small>{unit}</small></p>
    {hint && <p className="v2-metric-hint">{hint}</p>}
    {change && <p className="v2-metric-change">{change !== text.sameAsPrevious && <span>{text.changeFromPrevious} </span>}{change}</p>}
    {children}
  </section></RevealItem>
}
