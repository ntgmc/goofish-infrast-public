import type { OptimizeResult } from '../../lib/types'
import {
  formatAmount,
  formatIntermediateDepletionSummary,
  formatOverflowSummary,
  formatProductionBreakdown,
  formatSigned,
  type PreparedResult,
} from './formatters'
import MetricCard from './MetricCard'

export default function ResultMetrics({
  isAnalysis,
  isRotationMode,
  analysisSummary,
  prepared,
}: {
  isAnalysis: boolean;
  isRotationMode: boolean;
  analysisSummary: OptimizeResult['analysis_summary'];
  prepared: PreparedResult;
}) {
  const {
    totalEff,
    rawTotalEff,
    hasDailyProduction,
    rotationStatsNote,
    productionStats,
    productionSanity,
    orundumEconomy,
    intermediateDepletion,
    maaDefaultComparison,
    detailStats,
  } = prepared
  const showProductionMetrics = !isRotationMode || hasDailyProduction
  const showMaaDefaultComparison = Boolean(maaDefaultComparison) && !isAnalysis && !isRotationMode
  const orundumEconomyNote = orundumEconomy
    ? `长期 ${formatAmount(orundumEconomy.sustainable_orundum)}/日 · 固源岩预算 ${formatAmount(orundumEconomy.daily_orirock_supply)}/日 · 龙门币硬成本 ${formatAmount(orundumEconomy.hard_lmd_cost)}/日${orundumEconomy.inventory_depletion_days !== null ? ` · 库存约 ${formatAmount(orundumEconomy.inventory_depletion_days)} 天` : ''}`
    : ''
  const productionSanityNote = showMaaDefaultComparison && maaDefaultComparison
    ? maaDefaultComparison.sanityDeltaNote
    : isRotationMode && rotationStatsNote
      ? `${rotationStatsNote}；${productionSanity.note}`
      : productionSanity.note
  const intermediateDepletionSummary = !isAnalysis && !isRotationMode
    ? formatIntermediateDepletionSummary(intermediateDepletion)
    : ''

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="border-b border-surface-3/60 px-5 py-4 sm:px-6">
        <h3 className="text-base font-semibold text-ink-primary">数据</h3>
      </div>
      {isAnalysis && analysisSummary?.warnings.length ? (
        <div className="mx-5 mt-5 rounded-xl border border-warning/30 bg-warning/10 p-4 sm:mx-6">
          <p className="text-sm font-semibold text-warning">分析提示</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-ink-secondary">
            {analysisSummary.warnings.slice(0, 5).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
        {isAnalysis ? (
          <MetricCard
            label="红脸风险"
            value={String(analysisSummary?.red_face_risk_count ?? 0)}
            suffix="处"
            note={(analysisSummary?.red_face_operator_count ?? 0) > 0
              ? `${analysisSummary?.red_face_operator_count ?? 0} 名干员：${(analysisSummary?.red_face_operators ?? []).slice(0, 4).join('、')}${(analysisSummary?.red_face_operators?.length ?? 0) > 4 ? '等' : ''}`
              : '未发现红脸风险'}
            highlight={(analysisSummary?.red_face_risk_count ?? 0) > 0}
          />
        ) : isRotationMode && !showProductionMetrics ? (
          <MetricCard label="预设队列" value={String(detailStats.planCount)} suffix="组" highlight />
        ) : (
          <MetricCard
            label="预计总效率"
            value={totalEff.toFixed(2)}
            suffix="%"
            note={rotationStatsNote ?? (Math.abs(totalEff - rawTotalEff) >= 0.05 ? `原始房间和 ${rawTotalEff.toFixed(2)}%` : undefined)}
            highlight
          />
        )}
        <MetricCard
          label={isRotationMode && !showProductionMetrics ? '房间预设' : '制造站产量'}
          value={isRotationMode && !showProductionMetrics ? String(detailStats.roomCount) : formatAmount(productionStats.manufacturingTotal)}
          suffix={isRotationMode && !showProductionMetrics ? '间' : '件/日'}
          note={isRotationMode && !showProductionMetrics ? '按每个设施分别录入队列' : formatProductionBreakdown(productionStats.manufacturing)}
        />
        {showProductionMetrics && (
          <>
            <MetricCard
              label="预计日产出"
              value={formatAmount(productionStats.lmd)}
              suffix="龙门币"
              note={`赤金净变动 ${formatSigned(productionStats.goldNet)}${productionStats.orundum > 0 ? `，合成玉 ${formatAmount(productionStats.orundum)}` : ''}`}
            />
            {isAnalysis ? (
              <MetricCard
                label="爆仓概览"
                value={String((analysisSummary?.overflow.trading_rooms ?? 0) + (analysisSummary?.overflow.manufacturing_rooms ?? 0))}
                suffix="房间"
                note={formatOverflowSummary(analysisSummary?.overflow)}
              />
            ) : (
              <MetricCard
                label={orundumEconomy ? '搓玉经济' : '等效理智'}
                value={formatAmount(orundumEconomy?.short_term_orundum ?? productionSanity.value)}
                suffix={orundumEconomy ? '合成玉/日' : '理智'}
                note={orundumEconomy ? orundumEconomyNote : productionSanityNote}
              />
            )}
          </>
        )}
      </div>
      {intermediateDepletionSummary && (
        <div className="border-t border-surface-3/60 px-5 py-3 text-xs leading-5 text-ink-secondary sm:px-6">
          <span className="font-medium text-ink-primary">中间产物库存：</span>{intermediateDepletionSummary}
        </div>
      )}
      {showMaaDefaultComparison && maaDefaultComparison ? (
      <div className="border-t border-surface-3/60 px-5 pb-5 pt-3 text-xs leading-5 text-ink-secondary sm:px-6">
        MAA 默认基准：总效率 {formatAmount(maaDefaultComparison.baselineTotalEfficiency)}%，龙门币 {formatAmount(maaDefaultComparison.baselineLmd)}/日，赤金净变动 {formatSigned(maaDefaultComparison.baselineGoldNet)}/日
        {orundumEconomy && maaDefaultComparison.orundumEconomyDelta
          ? `；搓玉对比：合成玉 ${formatSigned(maaDefaultComparison.orundumEconomyDelta.daily_orundum_gain)}/日，长期 ${formatSigned(maaDefaultComparison.orundumEconomyDelta.sustainable_orundum_gain)}/日，机会成本 ${formatSigned(maaDefaultComparison.orundumEconomyDelta.opportunity_cost_delta)} 理智/日`
          : ''}
        {maaDefaultComparison.warnings.length > 0
          ? `；模拟提示 ${maaDefaultComparison.warnings.slice(0, 3).join('、')}`
            : ''}
        </div>
      ) : null}
    </section>
  )
}
