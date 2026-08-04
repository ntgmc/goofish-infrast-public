import { z } from 'zod'
import { copy } from '../copy/index'
import { appBuildMetaSchema } from './app-build-meta-validation'
import type {
  ScenarioComparisonFactors,
  ScenarioComparisonResult,
  ScenarioMetrics,
  ScenarioProductionPlan,
} from './scenario-comparison'
import { extensibleLicenseConfigSchema } from './workspace-validation'

const finiteNumber = z.number().finite()
const boundedString = (maximum: number) => z.string().min(1).max(maximum)
const MAX_RAW_SCENARIO_COMBINATIONS = 256
const scenarioDroneStrategySchema = z.enum([
  'off',
  'auto',
  'lmd',
  'orundum',
  'pure_gold',
  'battle_record',
  'originium_shard',
])

const scenarioProductionPlanSchema: z.ZodType<ScenarioProductionPlan> = z.strictObject({
  trading: z.strictObject({
    lmd: z.number().int().min(0).max(5),
    orundum: z.number().int().min(0).max(5),
  }),
  manufacturing: z.strictObject({
    pureGold: z.number().int().min(0).max(5),
    battleRecord: z.number().int().min(0).max(5),
    originiumShard: z.number().int().min(0).max(5),
  }),
})

const scenarioLayoutFactorSchema = z.strictObject({
  layout: z.enum(['153', '243', '333']),
  plans: z.array(scenarioProductionPlanSchema).min(1).max(24),
})

export const scenarioComparisonFactorsSchema: z.ZodType<ScenarioComparisonFactors> = z.strictObject({
  layouts: z.array(scenarioLayoutFactorSchema).min(1).max(3),
  maaSchedules: z.array(z.enum(['variable', '8x3'])).min(1).max(2),
  includeRotation: z.boolean(),
  droneStrategies: z.array(scenarioDroneStrategySchema).min(1).max(7),
}).superRefine((factors, context) => {
  assertUnique(factors.layouts.map((entry) => entry.layout), ['layouts'], copy.domain.lib_scenario_comparison_validation_001, context)
  assertUnique(factors.maaSchedules, ['maaSchedules'], copy.domain.lib_scenario_comparison_validation_002, context)
  assertUnique(factors.droneStrategies, ['droneStrategies'], copy.domain.lib_scenario_comparison_validation_003, context)
  factors.layouts.forEach((entry, layoutIndex) => {
    assertUnique(
      entry.plans.map((plan) => JSON.stringify(plan)),
      ['layouts', layoutIndex, 'plans'],
      copy.domain.lib_scenario_comparison_validation_004,
      context,
    )
  })
  const planCount = factors.layouts.reduce((sum, entry) => sum + entry.plans.length, 0)
  const scheduleCount = factors.maaSchedules.length + (factors.includeRotation ? 1 : 0)
  const rawCombinationCount = planCount * scheduleCount * factors.droneStrategies.length
  if (rawCombinationCount > MAX_RAW_SCENARIO_COMBINATIONS) {
    context.addIssue({
      code: 'custom',
      message: copy.domain.lib_scenario_comparison_validation_005(MAX_RAW_SCENARIO_COMBINATIONS),
    })
  }
}) as z.ZodType<ScenarioComparisonFactors>

const scenarioOrundumMetricsSchema = z.strictObject({
  sustainablePerDay: finiteNumber,
  shortTermPerDay: finiteNumber,
  hardLmdCostPerDay: finiteNumber,
  opportunityCostSanityPerDay: finiteNumber,
  inventoryDepletionDays: finiteNumber.nullable(),
  bottleneck: z.enum(['orirock_budget', 'manufacture', 'trading', 'inventory']),
  case: z.enum(['capacity_limited', 'budget_limited', 'inventory_burst']),
  dailySanityBudget: finiteNumber,
  monthlyCard: z.boolean(),
})

const scenarioMetricsSchema: z.ZodType<ScenarioMetrics> = z.strictObject({
  productionSanityPerDay: finiteNumber,
  totalEfficiency: finiteNumber,
  lmdPerDay: finiteNumber,
  orundumPerDay: finiteNumber,
  battleRecordPerDay: finiteNumber,
  pureGoldProducedPerDay: finiteNumber,
  pureGoldConsumedPerDay: finiteNumber,
  pureGoldNetPerDay: finiteNumber,
  originiumShardProducedPerDay: finiteNumber,
  originiumShardConsumedPerDay: finiteNumber,
  originiumShardNetPerDay: finiteNumber,
  dronesGeneratedPerDay: finiteNumber,
  dronesUsedPerDay: finiteNumber,
  dronesDiscardedPerDay: finiteNumber,
  orundumEconomy: scenarioOrundumMetricsSchema.nullable(),
})

const scenarioSkipSchema = z.strictObject({
  code: z.enum(['duplicate', 'missing_product']),
  count: z.number().int().min(0).max(1_000_000),
  message: z.string().max(2_000),
  droneStrategy: scenarioDroneStrategySchema.optional(),
})

export const scenarioComparisonResultSchema: z.ZodType<ScenarioComparisonResult> = z.object({
  kind: z.literal('scenario_comparison'),
  scenarioCount: z.number().int().min(0).max(24),
  screeningCount: z.number().int().min(0).max(24),
  verifiedCount: z.number().int().min(0).max(24),
  failedCount: z.number().int().min(0).max(24),
  rawCombinationCount: z.number().int().min(0).max(MAX_RAW_SCENARIO_COMBINATIONS),
  skipped: z.array(scenarioSkipSchema).max(MAX_RAW_SCENARIO_COMBINATIONS),
  points: z.array(z.object({
    id: boundedString(256),
    label: boundedString(1_000),
    config: extensibleLicenseConfigSchema,
    layout: z.enum(['153', '243', '333']),
    productionPlan: scenarioProductionPlanSchema,
    scheduleMode: z.enum(['maa', 'rotation']),
    scheduleStrategy: z.enum(['variable', '8x3', 'rotation']),
    shiftHours: z.array(finiteNumber.positive().max(24)).min(1).max(24),
    operationsPerDay: finiteNumber.min(2).max(4),
    variableShiftFallback: z.boolean(),
    droneStrategy: scenarioDroneStrategySchema,
    status: z.enum(['succeeded', 'failed']),
    screening: scenarioMetricsSchema.optional(),
    verified: scenarioMetricsSchema.optional(),
    isFrontier: z.boolean(),
    error: z.string().max(4_000).optional(),
  }).passthrough()).max(24),
  frontierScenarioIds: z.array(z.string().max(256)).max(24),
  frontierBasis: z.literal('fast_top_3_per_actual_operation_cost_then_layout_aware_verification'),
  warnings: z.array(z.string().max(4_000)).max(100),
  buildMeta: appBuildMetaSchema,
}).passthrough().superRefine((result, context) => {
  const pointIds = result.points.map((point) => point.id)
  assertUnique(pointIds, ['points'], copy.domain.lib_scenario_comparison_validation_006, context)
  assertUnique(result.frontierScenarioIds, ['frontierScenarioIds'], copy.domain.lib_scenario_comparison_validation_007, context)
  const screeningCount = result.points.filter((point) => point.screening).length
  const verifiedCount = result.points.filter((point) => point.verified).length
  const failedCount = result.points.filter((point) => point.status === 'failed').length
  const expectedCounts = [
    ['scenarioCount', result.points.length, result.scenarioCount],
    ['screeningCount', screeningCount, result.screeningCount],
    ['verifiedCount', verifiedCount, result.verifiedCount],
    ['failedCount', failedCount, result.failedCount],
  ] as const
  for (const [field, expected, actual] of expectedCounts) {
    if (expected !== actual) context.addIssue({ code: 'custom', path: [field], message: copy.domain.lib_scenario_comparison_validation_008(field) })
  }
  const frontierFromPoints = new Set(result.points.filter((point) => point.isFrontier).map((point) => point.id))
  const frontierFromSummary = new Set(result.frontierScenarioIds)
  if (frontierFromPoints.size !== frontierFromSummary.size
    || [...frontierFromPoints].some((id) => !frontierFromSummary.has(id))) {
    context.addIssue({ code: 'custom', path: ['frontierScenarioIds'], message: copy.domain.lib_scenario_comparison_validation_009 })
  }
  result.points.forEach((point, index) => {
    if (point.status === 'succeeded' && !point.screening && !point.verified) {
      context.addIssue({ code: 'custom', path: ['points', index], message: copy.domain.lib_scenario_comparison_validation_010 })
    }
    if (point.isFrontier && (point.status !== 'succeeded' || !point.verified)) {
      context.addIssue({ code: 'custom', path: ['points', index, 'isFrontier'], message: copy.domain.lib_scenario_comparison_validation_011 })
    }
  })
}) as z.ZodType<ScenarioComparisonResult>

function assertUnique(
  values: string[],
  path: PropertyKey[],
  message: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path, message })
}
