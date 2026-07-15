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
import { copy } from '../../copy/index'


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
    ? `${copy.domain.components_result_panel_ResultMetrics_001}${formatAmount(orundumEconomy.sustainable_orundum)}${copy.domain.components_result_panel_ResultMetrics_002}${formatAmount(orundumEconomy.daily_orirock_supply)}${copy.domain.components_result_panel_ResultMetrics_003}${formatAmount(orundumEconomy.hard_lmd_cost)}${copy.domain.components_result_panel_ResultMetrics_004}${orundumEconomy.inventory_depletion_days !== null ? `${copy.domain.components_result_panel_ResultMetrics_005}${formatAmount(orundumEconomy.inventory_depletion_days)}${copy.domain.components_result_panel_ResultMetrics_006}` : ''}`
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
    <section className="tool-panel overflow-hidden">
      <div className="tool-panel-header px-5 py-4 sm:px-6">
        <p className="tool-eyebrow">{copy.domain.components_result_panel_ResultMetrics_007}</p>
        <h3 className="text-base font-semibold text-ink-primary">{copy.domain.components_result_panel_ResultMetrics_008}</h3>
      </div>
      {isAnalysis && analysisSummary?.warnings.length ? (
        <div className="tool-alert tool-alert--warning mx-5 mt-5 sm:mx-6">
          <p className="text-sm font-semibold text-warning">{copy.domain.components_result_panel_ResultMetrics_009}</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-ink-secondary">
            {analysisSummary.warnings.slice(0, 5).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
        {isAnalysis ? (
          <MetricCard
            label={copy.domain.components_result_panel_ResultMetrics_010}
            value={String(analysisSummary?.red_face_risk_count ?? 0)}
            suffix={copy.domain.components_result_panel_ResultMetrics_011}
            note={(analysisSummary?.red_face_operator_count ?? 0) > 0
              ? `${analysisSummary?.red_face_operator_count ?? 0}${copy.domain.components_result_panel_ResultMetrics_012}${(analysisSummary?.red_face_operators ?? []).slice(0, 4).join('、')}${(analysisSummary?.red_face_operators?.length ?? 0) > 4 ? copy.domain.components_result_panel_ResultMetrics_013 : ''}`
              : copy.domain.components_result_panel_ResultMetrics_014}
            highlight={(analysisSummary?.red_face_risk_count ?? 0) > 0}
          />
        ) : isRotationMode && !showProductionMetrics ? (
          <MetricCard label={copy.domain.components_result_panel_ResultMetrics_015} value={String(detailStats.planCount)} suffix={copy.domain.components_result_panel_ResultMetrics_016} highlight />
        ) : (
          <MetricCard
            label={copy.domain.components_result_panel_ResultMetrics_017}
            value={totalEff.toFixed(2)}
            suffix="%"
            note={rotationStatsNote ?? (Math.abs(totalEff - rawTotalEff) >= 0.05 ? `${copy.domain.components_result_panel_ResultMetrics_018}${rawTotalEff.toFixed(2)}%` : undefined)}
            highlight
          />
        )}
        <MetricCard
          label={isRotationMode && !showProductionMetrics ? copy.domain.components_result_panel_ResultMetrics_019 : copy.domain.components_result_panel_ResultMetrics_020}
          value={isRotationMode && !showProductionMetrics ? String(detailStats.roomCount) : formatAmount(productionStats.manufacturingTotal)}
          suffix={isRotationMode && !showProductionMetrics ? copy.domain.components_result_panel_ResultMetrics_021 : copy.domain.components_result_panel_ResultMetrics_022}
          note={isRotationMode && !showProductionMetrics ? copy.domain.components_result_panel_ResultMetrics_023 : formatProductionBreakdown(productionStats.manufacturing)}
        />
        {showProductionMetrics && (
          <>
            <MetricCard
              label={copy.domain.components_result_panel_ResultMetrics_024}
              value={formatAmount(productionStats.lmd)}
              suffix={copy.domain.components_result_panel_ResultMetrics_025}
              note={`${copy.domain.components_result_panel_ResultMetrics_026}${formatSigned(productionStats.goldNet)}${productionStats.orundum > 0 ? `${copy.domain.components_result_panel_ResultMetrics_027}${formatAmount(productionStats.orundum)}` : ''}`}
            />
            {isAnalysis ? (
              <MetricCard
                label={copy.domain.components_result_panel_ResultMetrics_028}
                value={String((analysisSummary?.overflow.trading_rooms ?? 0) + (analysisSummary?.overflow.manufacturing_rooms ?? 0))}
                suffix={copy.domain.components_result_panel_ResultMetrics_029}
                note={formatOverflowSummary(analysisSummary?.overflow)}
              />
            ) : (
              <MetricCard
                label={orundumEconomy ? copy.domain.components_result_panel_ResultMetrics_030 : copy.domain.components_result_panel_ResultMetrics_031}
                value={formatAmount(orundumEconomy?.short_term_orundum ?? productionSanity.value)}
                suffix={orundumEconomy ? copy.domain.components_result_panel_ResultMetrics_032 : copy.domain.components_result_panel_ResultMetrics_033}
                note={orundumEconomy ? orundumEconomyNote : productionSanityNote}
              />
            )}
          </>
        )}
      </div>
      {intermediateDepletionSummary && (
        <div className="border-t border-surface-3/60 px-5 py-3 text-xs leading-5 text-ink-secondary sm:px-6">
          <span className="font-medium text-ink-primary">{copy.domain.components_result_panel_ResultMetrics_034}</span>{intermediateDepletionSummary}
        </div>
      )}
      {showMaaDefaultComparison && maaDefaultComparison ? (
      <div className="border-t border-surface-3/60 px-5 pb-5 pt-3 text-xs leading-5 text-ink-secondary sm:px-6">
        {copy.domain.components_result_panel_ResultMetrics_035}{formatAmount(maaDefaultComparison.baselineTotalEfficiency)}{copy.domain.components_result_panel_ResultMetrics_036}{formatAmount(maaDefaultComparison.baselineLmd)}{copy.domain.components_result_panel_ResultMetrics_037}{formatSigned(maaDefaultComparison.baselineGoldNet)}{copy.domain.components_result_panel_ResultMetrics_038}{orundumEconomy && maaDefaultComparison.orundumEconomyDelta
          ? `${copy.domain.components_result_panel_ResultMetrics_039}${formatSigned(maaDefaultComparison.orundumEconomyDelta.daily_orundum_gain)}${copy.domain.components_result_panel_ResultMetrics_040}${formatSigned(maaDefaultComparison.orundumEconomyDelta.sustainable_orundum_gain)}${copy.domain.components_result_panel_ResultMetrics_041}${formatSigned(maaDefaultComparison.orundumEconomyDelta.opportunity_cost_delta)}${copy.domain.components_result_panel_ResultMetrics_042}`
          : ''}
        {maaDefaultComparison.warnings.length > 0
          ? `${copy.domain.components_result_panel_ResultMetrics_043}${maaDefaultComparison.warnings.slice(0, 3).join('、')}`
            : ''}
        </div>
      ) : null}
    </section>
  )
}
