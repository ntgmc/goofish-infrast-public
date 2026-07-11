import type { AppBuildMeta, LicenseConfig, OrundumEconomy } from './types'

export const SCENARIO_COMPARISON_MAX_SCENARIOS = 24
export const SCENARIO_COMPARISON_VERIFY_PER_COST = 3
export const SCENARIO_PARETO_EPSILON = 0.01
export const SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT = 13

export type ScenarioLayout = '153' | '243' | '333'
export type ScenarioMaaSchedule = 'variable' | '8x3' | '12x2'
export type ScenarioDroneStrategy =
  | 'off'
  | 'auto'
  | 'lmd'
  | 'orundum'
  | 'pure_gold'
  | 'battle_record'
  | 'originium_shard'
export type ScenarioScheduleMode = 'maa' | 'rotation'

export interface ScenarioProductionPlan {
  trading: {
    lmd: number;
    orundum: number;
  };
  manufacturing: {
    pureGold: number;
    battleRecord: number;
    originiumShard: number;
  };
}

export interface ScenarioLayoutFactor {
  layout: ScenarioLayout;
  plans: ScenarioProductionPlan[];
}

export interface ScenarioComparisonFactors {
  layouts: ScenarioLayoutFactor[];
  maaSchedules: ScenarioMaaSchedule[];
  includeRotation: boolean;
  droneStrategies: ScenarioDroneStrategy[];
}

export interface ScenarioSkipSummary {
  code: 'duplicate' | 'missing_product';
  count: number;
  message: string;
  droneStrategy?: ScenarioDroneStrategy;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  config: LicenseConfig;
  layout: ScenarioLayout;
  productionPlan: ScenarioProductionPlan;
  scheduleMode: ScenarioScheduleMode;
  scheduleStrategy: ScenarioMaaSchedule | 'rotation';
  shiftHours: number[];
  operationsPerDay: number;
  variableShiftFallback: boolean;
  droneStrategy: ScenarioDroneStrategy;
}

export interface ScenarioExpansion {
  rawCombinationCount: number;
  variableScenarioCount: number;
  scenarios: ScenarioDefinition[];
  skipped: ScenarioSkipSummary[];
}

export interface ScenarioOrundumMetrics {
  sustainablePerDay: number;
  shortTermPerDay: number;
  hardLmdCostPerDay: number;
  opportunityCostSanityPerDay: number;
  inventoryDepletionDays: number | null;
  bottleneck: OrundumEconomy['bottleneck'];
  case: OrundumEconomy['case'];
  dailySanityBudget: number;
  monthlyCard: boolean;
}

export interface ScenarioMetrics {
  productionSanityPerDay: number;
  totalEfficiency: number;
  lmdPerDay: number;
  orundumPerDay: number;
  battleRecordPerDay: number;
  pureGoldProducedPerDay: number;
  pureGoldConsumedPerDay: number;
  pureGoldNetPerDay: number;
  originiumShardProducedPerDay: number;
  originiumShardConsumedPerDay: number;
  originiumShardNetPerDay: number;
  dronesGeneratedPerDay: number;
  dronesUsedPerDay: number;
  dronesDiscardedPerDay: number;
  orundumEconomy: ScenarioOrundumMetrics | null;
}

export interface ScenarioComparisonPoint extends ScenarioDefinition {
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
  frontierBasis: 'fast_top_3_per_actual_operation_cost_then_exact_selected_shift_pattern';
  warnings: string[];
  buildMeta: AppBuildMeta;
}

const LAYOUT_COUNTS: Record<ScenarioLayout, { trading: number; manufacturing: number }> = {
  '153': { trading: 1, manufacturing: 5 },
  '243': { trading: 2, manufacturing: 4 },
  '333': { trading: 3, manufacturing: 3 },
}

const SCHEDULES: Record<Exclude<ScenarioMaaSchedule, 'variable'>, number[]> = {
  '8x3': [8, 8, 8],
  '12x2': [12, 12],
}

const DRONE_LABELS: Record<ScenarioDroneStrategy, string> = {
  off: '无人机关闭',
  auto: '无人机自动',
  lmd: '无人机加速龙门币',
  orundum: '无人机加速合成玉',
  pure_gold: '无人机加速赤金',
  battle_record: '无人机加速经验',
  originium_shard: '无人机加速源石碎片',
}

export function expandScenarioComparison(
  baseConfig: LicenseConfig,
  factors: ScenarioComparisonFactors,
): ScenarioExpansion {
  validateFactors(factors)
  const scenarios: ScenarioDefinition[] = []
  const seen = new Set<string>()
  const skippedTargets = new Map<ScenarioDroneStrategy, number>()
  let duplicateCount = 0
  let rawCombinationCount = 0
  let variableScenarioCount = 0

  for (const layoutFactor of factors.layouts) {
    const counts = LAYOUT_COUNTS[layoutFactor.layout]
    for (const plan of layoutFactor.plans) {
      validateProductionPlan(layoutFactor.layout, plan, counts)
      for (const schedule of factors.maaSchedules) {
        for (const droneStrategy of factors.droneStrategies) {
          rawCombinationCount += 1
          if (!hasDroneTarget(plan, droneStrategy)) {
            skippedTargets.set(droneStrategy, (skippedTargets.get(droneStrategy) ?? 0) + 1)
            continue
          }
          const scenario = buildScenario(baseConfig, layoutFactor.layout, plan, schedule, droneStrategy)
          const added = addScenario(scenario, scenarios, seen)
          if (schedule === 'variable') variableScenarioCount += added
          duplicateCount += 1 - added
        }
      }
      if (factors.includeRotation) {
        rawCombinationCount += 1
        duplicateCount += 1 - addScenario(
          buildScenario(baseConfig, layoutFactor.layout, plan, 'rotation', 'off'),
          scenarios,
          seen,
        )
      }
    }
  }

  if (scenarios.length === 0) throw new Error('请至少选择一个能够运行的场景组合。')
  if (scenarios.length > SCENARIO_COMPARISON_MAX_SCENARIOS) {
    throw new Error(`有效场景共 ${scenarios.length} 组，最多允许 ${SCENARIO_COMPARISON_MAX_SCENARIOS} 组。`)
  }

  const skipped: ScenarioSkipSummary[] = [...skippedTargets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([droneStrategy, count]) => ({
      code: 'missing_product' as const,
      count,
      droneStrategy,
      message: `${DRONE_LABELS[droneStrategy]}的目标产线在对应生产方案中不存在，已跳过。`,
    }))
  if (duplicateCount > 0) {
    skipped.push({ code: 'duplicate', count: duplicateCount, message: '重复场景已合并。' })
  }
  return { rawCombinationCount, variableScenarioCount, scenarios, skipped }
}

export function selectVerificationScenarioIds(points: ScenarioComparisonPoint[]): string[] {
  const groups = new Map<number, ScenarioComparisonPoint[]>()
  for (const point of points) {
    if (point.status !== 'succeeded' || !point.screening || point.operationsPerDay <= 0) continue
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

export function freezeVariableScenarioConfig(
  config: LicenseConfig,
  shiftHours: number[],
  description: string,
): LicenseConfig {
  const next = JSON.parse(JSON.stringify(config)) as LicenseConfig
  next.schedule_mode = 'maa'
  next.shift_hours = [...shiftHours]
  next.desc = `${description} · 自动非固定选定 ${formatShiftHours(shiftHours)}`
  next.variable_shift_schedule = {
    ...(next.variable_shift_schedule ?? {}),
    enable: false,
    enabled: false,
  }
  return next
}

export function formatShiftHours(hours: number[]): string {
  return hours.map((value) => `${Number(value.toFixed(2))}h`).join('-')
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
  assertExactKeys(factors, ['layouts', 'maaSchedules', 'includeRotation', 'droneStrategies'], '场景因子')
  if (!factors || !Array.isArray(factors.layouts) || !Array.isArray(factors.maaSchedules) || !Array.isArray(factors.droneStrategies)) {
    throw new Error('场景因子格式不正确。')
  }
  if (typeof factors.includeRotation !== 'boolean') throw new Error('游戏内轮换因子必须是布尔值。')
  if (factors.layouts.length === 0) throw new Error('请至少选择一个基建布局和生产方案。')
  if (factors.maaSchedules.length === 0 && !factors.includeRotation) throw new Error('请至少选择一种排班模式。')
  if (factors.maaSchedules.length > 0 && factors.droneStrategies.length === 0) throw new Error('MAA 场景至少需要一种无人机策略。')
  for (const layoutFactor of factors.layouts) {
    assertExactKeys(layoutFactor, ['layout', 'plans'], '布局因子')
    if (!Object.prototype.hasOwnProperty.call(LAYOUT_COUNTS, layoutFactor.layout)
      || !Array.isArray(layoutFactor.plans)
      || layoutFactor.plans.length === 0) {
      throw new Error('布局或生产方案格式不正确。')
    }
  }
  if (factors.maaSchedules.some((value) => !['variable', '8x3', '12x2'].includes(value))) {
    throw new Error('MAA 排班仅支持自动非固定、8×3 和 12×2。')
  }
  if (factors.droneStrategies.some((value) => !Object.prototype.hasOwnProperty.call(DRONE_LABELS, value))) {
    throw new Error('包含未知的无人机策略。')
  }
}

function validateProductionPlan(
  layout: ScenarioLayout,
  plan: ScenarioProductionPlan,
  counts: { trading: number; manufacturing: number },
): void {
  assertExactKeys(plan, ['trading', 'manufacturing'], `${layout} 生产方案`)
  assertExactKeys(plan?.trading, ['lmd', 'orundum'], `${layout} 贸易方案`)
  assertExactKeys(plan?.manufacturing, ['pureGold', 'battleRecord', 'originiumShard'], `${layout} 制造方案`)
  const values = [
    plan?.trading?.lmd,
    plan?.trading?.orundum,
    plan?.manufacturing?.pureGold,
    plan?.manufacturing?.battleRecord,
    plan?.manufacturing?.originiumShard,
  ]
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(`${layout} 的贸易与制造线数必须是非负整数。`)
  }
  if (plan.trading.lmd + plan.trading.orundum !== counts.trading) {
    throw new Error(`${layout} 的贸易线数合计必须为 ${counts.trading}。`)
  }
  if (plan.manufacturing.pureGold + plan.manufacturing.battleRecord + plan.manufacturing.originiumShard !== counts.manufacturing) {
    throw new Error(`${layout} 的制造线数合计必须为 ${counts.manufacturing}。`)
  }
}

function assertExactKeys(value: unknown, allowed: string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确。`)
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`${label}包含未知字段：${unknown.sort().join('、')}。`)
}

function addScenario(
  scenario: ScenarioDefinition,
  scenarios: ScenarioDefinition[],
  seen: Set<string>,
): 0 | 1 {
  if (seen.has(scenario.id)) return 0
  seen.add(scenario.id)
  scenarios.push(scenario)
  return 1
}

function buildScenario(
  baseConfig: LicenseConfig,
  layout: ScenarioLayout,
  plan: ScenarioProductionPlan,
  scheduleStrategy: ScenarioMaaSchedule | 'rotation',
  droneStrategy: ScenarioDroneStrategy,
): ScenarioDefinition {
  const counts = LAYOUT_COUNTS[layout]
  const scheduleMode: ScenarioScheduleMode = scheduleStrategy === 'rotation' ? 'rotation' : 'maa'
  const shifts = scheduleStrategy === 'rotation'
    ? [12, 12]
    : scheduleStrategy === 'variable'
      ? [8, 8, 8]
      : [...SCHEDULES[scheduleStrategy]]
  const config = JSON.parse(JSON.stringify(baseConfig)) as LicenseConfig
  config.layout = `${counts.trading}-${counts.manufacturing}-3`
  config.desc = scenarioDescription(layout, plan, scheduleStrategy)
  config.trading_stations_count = counts.trading
  config.manufacturing_stations_count = counts.manufacturing
  config.product_requirements = {
    trading_stations: compactCounts({ LMD: plan.trading.lmd, Orundum: plan.trading.orundum }),
    manufacturing_stations: compactCounts({
      'Pure Gold': plan.manufacturing.pureGold,
      'Battle Record': plan.manufacturing.battleRecord,
      'Originium Shard': plan.manufacturing.originiumShard,
    }),
  }
  config.schedule_mode = scheduleStrategy === 'variable' ? 'variable' : scheduleMode
  config.shift_hours = shifts
  delete config.auto_balance_source
  if (scheduleStrategy === 'variable') {
    config.variable_shift_schedule = {
      enable: true,
      max_shifts: 4,
      shift_step_minutes: 60,
      min_low_hours: 3,
      beam_width: 4,
      trace_variable_shifts: false,
      trace_mood_cycle: false,
    }
  } else {
    delete config.variable_shift_schedule
  }
  if (scheduleMode === 'rotation') {
    config.Fiammetta = { enable: false }
    config.drones = { enable: false, auto: false, order: 'pre', targets: [] }
  } else {
    config.drones = buildDroneConfig(droneStrategy)
  }

  const planId = `t${plan.trading.lmd}-${plan.trading.orundum}-m${plan.manufacturing.pureGold}-${plan.manufacturing.battleRecord}-${plan.manufacturing.originiumShard}`
  const id = `${layout}-${planId}-${scheduleStrategy}-${droneStrategy}`
  return {
    id,
    label: `${productionPlanLabel(layout, plan)} · ${scheduleLabel(scheduleStrategy)} · ${DRONE_LABELS[droneStrategy]}`,
    config,
    layout,
    productionPlan: JSON.parse(JSON.stringify(plan)) as ScenarioProductionPlan,
    scheduleMode,
    scheduleStrategy,
    shiftHours: shifts,
    operationsPerDay: scheduleStrategy === 'variable' ? 0 : shifts.length,
    variableShiftFallback: false,
    droneStrategy,
  }
}

function hasDroneTarget(plan: ScenarioProductionPlan, strategy: ScenarioDroneStrategy): boolean {
  if (strategy === 'off' || strategy === 'auto') return true
  return ({
    lmd: plan.trading.lmd,
    orundum: plan.trading.orundum,
    pure_gold: plan.manufacturing.pureGold,
    battle_record: plan.manufacturing.battleRecord,
    originium_shard: plan.manufacturing.originiumShard,
  })[strategy] > 0
}

function buildDroneConfig(strategy: ScenarioDroneStrategy): NonNullable<LicenseConfig['drones']> {
  if (strategy === 'off') return { enable: false, auto: false, order: 'pre', targets: [] }
  if (strategy === 'auto') return { enable: true, auto: true, order: 'pre', targets: [] }
  const product = ({
    lmd: 'LMD',
    orundum: 'Orundum',
    pure_gold: 'Pure Gold',
    battle_record: 'Battle Record',
    originium_shard: 'Originium Shard',
  } as const)[strategy]
  return { enable: true, auto: false, order: 'pre', targets: [product] }
}

function compactCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0))
}

function productionPlanLabel(layout: ScenarioLayout, plan: ScenarioProductionPlan): string {
  return `${layout} 贸币${plan.trading.lmd}/玉${plan.trading.orundum} · 制赤${plan.manufacturing.pureGold}/经${plan.manufacturing.battleRecord}/碎${plan.manufacturing.originiumShard}`
}

function scenarioDescription(
  layout: ScenarioLayout,
  plan: ScenarioProductionPlan,
  strategy: ScenarioMaaSchedule | 'rotation',
): string {
  return `${productionPlanLabel(layout, plan)} · ${scheduleLabel(strategy)}`
}

function scheduleLabel(strategy: ScenarioMaaSchedule | 'rotation'): string {
  if (strategy === 'variable') return 'MAA 自动非固定'
  if (strategy === '8x3') return 'MAA 8h×3'
  if (strategy === '12x2') return 'MAA 12h×2'
  return '轮换 12h×2'
}
