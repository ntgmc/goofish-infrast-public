import type { AppBuildMeta, LicenseConfig } from './types'

export const SCENARIO_COMPARISON_MAX_SCENARIOS = 24
export const SCENARIO_COMPARISON_VERIFY_PER_COST = 3
export const SCENARIO_PARETO_EPSILON = 0.01

export type ScenarioLayout = '153' | '243' | '333'
export type ScenarioMaaShiftHours = 6 | 8 | 12
export type ScenarioDroneStrategy = 'off' | 'auto' | 'lmd' | 'pure_gold' | 'battle_record'
export type ScenarioScheduleMode = 'maa' | 'rotation'

export interface ScenarioProductSplit {
  pureGold: number;
  battleRecord: number;
}

export interface ScenarioLayoutFactor {
  layout: ScenarioLayout;
  splits: ScenarioProductSplit[];
}

export interface ScenarioComparisonFactors {
  layouts: ScenarioLayoutFactor[];
  maaShiftHours: ScenarioMaaShiftHours[];
  includeRotation: boolean;
  droneStrategies: ScenarioDroneStrategy[];
}

export interface ScenarioSkipSummary {
  code: 'duplicate' | 'missing_product';
  count: number;
  message: string;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  config: LicenseConfig;
  layout: ScenarioLayout;
  pureGoldLines: number;
  battleRecordLines: number;
  scheduleMode: ScenarioScheduleMode;
  shiftHours: number[];
  operationsPerDay: number;
  droneStrategy: ScenarioDroneStrategy;
}

export interface ScenarioExpansion {
  rawCombinationCount: number;
  scenarios: ScenarioDefinition[];
  skipped: ScenarioSkipSummary[];
}

export interface ScenarioMetrics {
  productionSanityPerDay: number;
  totalEfficiency: number;
  lmdPerDay: number;
  battleRecordPerDay: number;
  pureGoldProducedPerDay: number;
  pureGoldConsumedPerDay: number;
  pureGoldNetPerDay: number;
  dronesGeneratedPerDay: number;
  dronesUsedPerDay: number;
  dronesDiscardedPerDay: number;
}

export interface ScenarioComparisonPoint extends Omit<ScenarioDefinition, 'config'> {
  config: LicenseConfig;
  status: 'succeeded' | 'failed';
  screening?: ScenarioMetrics;
  verified?: ScenarioMetrics;
  isFrontier: boolean;
  error?: string;
}

export interface ScenarioComparisonResult {
  kind: 'scenario_comparison';
  scenarioCount: number;
  screeningCount: number;
  verifiedCount: number;
  failedCount: number;
  rawCombinationCount: number;
  skipped: ScenarioSkipSummary[];
  points: ScenarioComparisonPoint[];
  frontierScenarioIds: string[];
  frontierBasis: 'fast_top_3_per_operation_cost_then_exact';
  warnings: string[];
  buildMeta: AppBuildMeta;
}

const LAYOUT_COUNTS: Record<ScenarioLayout, { trading: number; manufacturing: number }> = {
  '153': { trading: 1, manufacturing: 5 },
  '243': { trading: 2, manufacturing: 4 },
  '333': { trading: 3, manufacturing: 3 },
}

const DRONE_LABELS: Record<ScenarioDroneStrategy, string> = {
  off: '无人机关闭',
  auto: '无人机自动',
  lmd: '无人机加速龙门币',
  pure_gold: '无人机加速赤金',
  battle_record: '无人机加速经验',
}

export function expandScenarioComparison(
  baseConfig: LicenseConfig,
  factors: ScenarioComparisonFactors,
): ScenarioExpansion {
  validateFactors(factors)
  const scenarios: ScenarioDefinition[] = []
  const seen = new Set<string>()
  const skippedCounts = { duplicate: 0, missing_product: 0 }
  let rawCombinationCount = 0

  for (const layoutFactor of factors.layouts) {
    const counts = LAYOUT_COUNTS[layoutFactor.layout]
    for (const split of layoutFactor.splits) {
      validateSplit(layoutFactor.layout, split, counts.manufacturing)
      for (const shiftHours of factors.maaShiftHours) {
        for (const droneStrategy of factors.droneStrategies) {
          rawCombinationCount += 1
          if (
            (droneStrategy === 'pure_gold' && split.pureGold === 0)
            || (droneStrategy === 'battle_record' && split.battleRecord === 0)
          ) {
            skippedCounts.missing_product += 1
            continue
          }
          addScenario(
            buildScenario(baseConfig, layoutFactor.layout, split, 'maa', shiftHours, droneStrategy),
            scenarios,
            seen,
            skippedCounts,
          )
        }
      }
      if (factors.includeRotation) {
        rawCombinationCount += 1
        addScenario(
          buildScenario(baseConfig, layoutFactor.layout, split, 'rotation', 12, 'off'),
          scenarios,
          seen,
          skippedCounts,
        )
      }
    }
  }

  if (scenarios.length === 0) throw new Error('请至少选择一个能够运行的场景组合。')
  if (scenarios.length > SCENARIO_COMPARISON_MAX_SCENARIOS) {
    throw new Error(`有效场景共 ${scenarios.length} 组，最多允许 ${SCENARIO_COMPARISON_MAX_SCENARIOS} 组。`)
  }

  const skipped: ScenarioSkipSummary[] = []
  if (skippedCounts.missing_product > 0) {
    skipped.push({
      code: 'missing_product',
      count: skippedCounts.missing_product,
      message: '指定无人机目标在对应制造方案中不存在，已跳过。',
    })
  }
  if (skippedCounts.duplicate > 0) {
    skipped.push({ code: 'duplicate', count: skippedCounts.duplicate, message: '重复场景已合并。' })
  }
  return { rawCombinationCount, scenarios, skipped }
}

export function selectVerificationScenarioIds(points: ScenarioComparisonPoint[]): string[] {
  const groups = new Map<number, ScenarioComparisonPoint[]>()
  for (const point of points) {
    if (point.status !== 'succeeded' || !point.screening) continue
    const group = groups.get(point.operationsPerDay) ?? []
    group.push(point)
    groups.set(point.operationsPerDay, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, group]) => group
      .sort((left, right) =>
        (right.screening?.productionSanityPerDay ?? 0) - (left.screening?.productionSanityPerDay ?? 0)
        || left.id.localeCompare(right.id),
      )
      .slice(0, SCENARIO_COMPARISON_VERIFY_PER_COST)
      .map((point) => point.id))
}

export function calculateVerifiedParetoIds(points: ScenarioComparisonPoint[]): string[] {
  const verified = points.filter((point) => point.status === 'succeeded' && point.verified)
  return verified
    .filter((candidate) => !verified.some((other) => other.id !== candidate.id && dominates(other, candidate)))
    .sort((left, right) => left.operationsPerDay - right.operationsPerDay
      || (left.verified?.productionSanityPerDay ?? 0) - (right.verified?.productionSanityPerDay ?? 0)
      || left.id.localeCompare(right.id))
    .map((point) => point.id)
}

function dominates(left: ScenarioComparisonPoint, right: ScenarioComparisonPoint): boolean {
  const leftOutput = left.verified?.productionSanityPerDay ?? Number.NEGATIVE_INFINITY
  const rightOutput = right.verified?.productionSanityPerDay ?? Number.NEGATIVE_INFINITY
  const outputNoWorse = leftOutput + SCENARIO_PARETO_EPSILON >= rightOutput
  const costNoWorse = left.operationsPerDay <= right.operationsPerDay
  const outputStrictlyBetter = leftOutput > rightOutput + SCENARIO_PARETO_EPSILON
  const costStrictlyBetter = left.operationsPerDay < right.operationsPerDay
  return outputNoWorse && costNoWorse && (outputStrictlyBetter || costStrictlyBetter)
}

function validateFactors(factors: ScenarioComparisonFactors): void {
  if (!factors || !Array.isArray(factors.layouts) || !Array.isArray(factors.maaShiftHours) || !Array.isArray(factors.droneStrategies)) {
    throw new Error('场景因子格式不正确。')
  }
  if (factors.layouts.length === 0) throw new Error('请至少选择一个基建布局。')
  if (factors.maaShiftHours.length === 0 && !factors.includeRotation) throw new Error('请至少选择一种排班模式。')
  if (factors.maaShiftHours.length > 0 && factors.droneStrategies.length === 0) throw new Error('MAA 场景至少需要一种无人机策略。')
  for (const layoutFactor of factors.layouts) {
    if (!Object.prototype.hasOwnProperty.call(LAYOUT_COUNTS, layoutFactor.layout) || !Array.isArray(layoutFactor.splits) || layoutFactor.splits.length === 0) {
      throw new Error('布局或赤金/经验拆分不正确。')
    }
  }
  if (factors.maaShiftHours.some((value) => ![6, 8, 12].includes(value))) throw new Error('MAA 换班间隔仅支持 6、8、12 小时。')
  if (factors.droneStrategies.some((value) => !Object.prototype.hasOwnProperty.call(DRONE_LABELS, value))) throw new Error('包含未知的无人机策略。')
}

function validateSplit(layout: ScenarioLayout, split: ScenarioProductSplit, manufacturingCount: number): void {
  if (!Number.isInteger(split.pureGold) || !Number.isInteger(split.battleRecord)
    || split.pureGold < 0 || split.battleRecord < 0
    || split.pureGold + split.battleRecord !== manufacturingCount) {
    throw new Error(`${layout} 的赤金/经验生产线拆分必须是合计 ${manufacturingCount} 的非负整数。`)
  }
}

function addScenario(
  scenario: ScenarioDefinition,
  scenarios: ScenarioDefinition[],
  seen: Set<string>,
  skippedCounts: { duplicate: number; missing_product: number },
): void {
  if (seen.has(scenario.id)) {
    skippedCounts.duplicate += 1
    return
  }
  seen.add(scenario.id)
  scenarios.push(scenario)
}

function buildScenario(
  baseConfig: LicenseConfig,
  layout: ScenarioLayout,
  split: ScenarioProductSplit,
  scheduleMode: ScenarioScheduleMode,
  shiftHours: ScenarioMaaShiftHours,
  droneStrategy: ScenarioDroneStrategy,
): ScenarioDefinition {
  const counts = LAYOUT_COUNTS[layout]
  const shifts = scheduleMode === 'rotation' ? [12, 12] : Array.from({ length: 24 / shiftHours }, () => shiftHours)
  const config = JSON.parse(JSON.stringify(baseConfig)) as LicenseConfig
  config.layout = `${counts.trading}-${counts.manufacturing}-3`
  config.desc = `${layout} · 赤金${split.pureGold}/经验${split.battleRecord} · ${scheduleMode === 'rotation' ? '游戏内轮换' : `${shiftHours}小时换班`}`
  config.trading_stations_count = counts.trading
  config.manufacturing_stations_count = counts.manufacturing
  config.product_requirements = {
    trading_stations: { LMD: counts.trading },
    manufacturing_stations: {
      ...(split.pureGold > 0 ? { 'Pure Gold': split.pureGold } : {}),
      ...(split.battleRecord > 0 ? { 'Battle Record': split.battleRecord } : {}),
    },
  }
  config.schedule_mode = scheduleMode
  config.shift_hours = shifts
  delete config.orundum_planning
  delete config.auto_balance_source
  if (scheduleMode === 'rotation') {
    config.Fiammetta = { enable: false }
    config.drones = { enable: false, auto: false, order: 'pre', targets: [] }
  } else {
    config.drones = buildDroneConfig(droneStrategy)
  }

  const id = `${layout}-g${split.pureGold}-e${split.battleRecord}-${scheduleMode === 'rotation' ? 'rotation' : `maa-${shiftHours}`}-${droneStrategy}`
  const scheduleLabel = scheduleMode === 'rotation' ? '轮换12h×2' : `MAA ${shiftHours}h×${24 / shiftHours}`
  return {
    id,
    label: `${layout} 赤金${split.pureGold}/经验${split.battleRecord} · ${scheduleLabel} · ${DRONE_LABELS[droneStrategy]}`,
    config,
    layout,
    pureGoldLines: split.pureGold,
    battleRecordLines: split.battleRecord,
    scheduleMode,
    shiftHours: shifts,
    operationsPerDay: shifts.length,
    droneStrategy,
  }
}

function buildDroneConfig(strategy: ScenarioDroneStrategy): NonNullable<LicenseConfig['drones']> {
  if (strategy === 'off') return { enable: false, auto: false, order: 'pre', targets: [] }
  if (strategy === 'auto') return { enable: true, auto: true, order: 'pre', targets: [] }
  const product = strategy === 'lmd' ? 'LMD' : strategy === 'pure_gold' ? 'Pure Gold' : 'Battle Record'
  return { enable: true, auto: false, order: 'pre', targets: [product] }
}
