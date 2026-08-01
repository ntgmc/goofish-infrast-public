import { z } from 'zod'
import type { ScenarioComparisonResult } from '../../../src/lib/scenario-comparison'
import {
  scenarioComparisonFactorsSchema,
  scenarioComparisonResultSchema,
} from '../../../src/lib/scenario-comparison-validation'
export { scenarioComparisonFactorsSchema } from '../../../src/lib/scenario-comparison-validation'
import type { OptimizeResult, ReorderCheckResult } from '../../../src/lib/types'
import {
  extensibleLicenseConfigSchema,
  extensibleLicenseOperatorsSchema,
} from '../../../src/lib/workspace-validation'
import type {
  OptimizationJobPayload,
  OptimizeJobPayload,
  ReorderCheckJobPayload,
  ScenarioComparisonJobPayload,
} from './shared'

const finiteNumber = z.number().finite()
const boundedString = (maximum: number) => z.string().min(1).max(maximum)
const nullableFiniteNumber = finiteNumber.nullable()

const appBuildMetaSchema = z.strictObject({
  frontend_version: boundedString(128),
  backend_version: boundedString(128),
  data_version: boundedString(128),
  generated_at: boundedString(128),
  source_summary: z.string().max(2_000),
  git_sha: z.string().max(128).nullable().optional(),
  build_context: z.string().max(256).optional(),
})

const freeScheduleEntitlementSchema = z.strictObject({
  first_generated_at: z.string().max(128).nullable(),
  revision_count: z.number().int().min(0).max(3),
  revision_limit: z.literal(3),
  revision_window_hours: z.literal(24),
  confirmed_at: z.string().max(128).nullable(),
  locked_at: z.string().max(128).nullable(),
  lock_reason: z.enum(['confirmed', 'revision_limit', 'window_expired']).nullable(),
  strong_reorder_bonus: z.strictObject({
    month: boundedString(16),
    granted_at: boundedString(128),
    used_at: z.string().max(128).nullable(),
  }).nullable(),
})

const optimizeDurationEstimateSchema = z.strictObject({
  estimated_duration_ms: z.number().int().positive().max(24 * 60 * 60_000),
  estimate_bucket: z.enum([
    'maa_fiammetta',
    'maa_fiammetta_with_suggestions',
    'maa_plain',
    'maa_plain_with_suggestions',
    'rotation',
    'rotation_with_suggestions',
    'scenario_comparison',
  ]),
  estimate_source: z.enum(['history_p95', 'fallback_p95']),
  estimate_sample_count: z.number().int().min(0).max(1_000_000),
})

const scheduleUsageContextSchema = z.strictObject({
  status: z.enum(['success', 'failure']).optional(),
  reason_code: boundedString(128).optional(),
  permission: z.string().max(128).optional(),
  profile_id: z.string().max(128).optional(),
  cdk_status: z.string().max(128).optional(),
  source: z.string().max(128).optional(),
  schedule_mode: z.string().max(128).optional(),
  fiammetta_enabled: z.boolean().optional(),
  estimate_bucket: optimizeDurationEstimateSchema.shape.estimate_bucket.optional(),
})

const freeScheduleDecisionSchema = z.strictObject({
  ok: z.literal(true),
  mode: z.enum(['revision', 'strong_reorder_bonus']),
  entitlement: freeScheduleEntitlementSchema,
}).nullable()

const optimizeResultSchema: z.ZodType<OptimizeResult> = z.object({
  author: z.string().max(1_000),
  title: z.string().max(1_000),
  description: z.string().max(20_000),
  buildingType: z.number().int().min(0).max(999),
  planTimes: z.string().max(2_000),
  plans: z.array(z.object({
    name: boundedString(1_000),
    description: z.string().max(5_000).optional(),
    schedule_mode: z.string().max(128).optional(),
    shift_hours: finiteNumber.positive().max(24).optional(),
    rooms: z.record(boundedString(128), z.array(z.object({
      operators: z.array(z.string().max(256)).max(200).optional(),
      product: z.string().max(256).optional(),
      efficiency: finiteNumber.optional(),
      final_efficiency: finiteNumber.optional(),
    }).passthrough()).max(100)),
  }).passthrough()).max(100),
  raw_results: z.array(z.object({
    total_efficiency: finiteNumber,
    assignment_detail: z.array(z.object({
      rule: z.string().max(2_000),
      ops: z.array(z.string().max(256)).max(200),
      eff: finiteNumber,
      workplace: z.string().max(256),
      product: z.string().max(256).optional(),
    }).passthrough()).max(5_000),
  }).passthrough()).max(1_000),
  build_meta: appBuildMetaSchema.optional(),
}).passthrough().superRefine(assertJsonSafe) as z.ZodType<OptimizeResult>

const reorderCheckResultSchema: z.ZodType<ReorderCheckResult> = z.object({
  recommendation: z.enum(['no_need', 'recommended', 'strongly_recommended']),
  estimated_gain_range: z.strictObject({
    min: nullableFiniteNumber,
    max: nullableFiniteNumber,
    unit: z.enum(['equivalent_sanity_per_day', 'room_change_only']),
    label: z.string().max(2_000),
  }),
  changed_room_count: z.number().int().min(0).max(100),
  affected_facility_types: z.array(z.string().max(128)).max(100),
  key_operators: z.array(z.strictObject({
    id: z.string().max(128).optional(),
    name: boundedString(256),
    reason: z.enum(['newly_used', 'core_combo_changed']),
    occurrence_count: z.number().int().min(0).max(1_000_000),
  })).max(1_000),
  current_plan_usable: z.boolean(),
  quota: z.strictObject({
    limit: z.literal(2),
    used: z.number().int().min(0),
    remaining: z.number().int().min(0),
    reset_at: boundedString(128),
    timezone: z.literal('Asia/Shanghai'),
  }),
  baseline: z.strictObject({
    history_id: boundedString(128),
    created_at: boundedString(128),
    name: boundedString(1_000),
  }),
  free_schedule_entitlement: freeScheduleEntitlementSchema.optional(),
  reasons: z.array(z.string().max(2_000)).max(1_000),
  build_meta: appBuildMetaSchema.optional(),
}).passthrough().superRefine(assertJsonSafe) as z.ZodType<ReorderCheckResult>

const workspaceHistoryItemSchema = z.strictObject({
  id: boundedString(128),
  name: boundedString(1_000),
  created_at: boundedString(128),
  config: extensibleLicenseConfigSchema.nullable(),
  result: optimizeResultSchema,
  operator_count: z.number().int().min(0).max(500),
  source: z.enum(['generated', 'applied_suggestions', 'legacy']),
})

const schedulePayloadSchema: z.ZodType<OptimizeJobPayload> = z.strictObject({
  version: z.literal(3),
  submittedAt: z.number().int().nonnegative(),
  operators: extensibleLicenseOperatorsSchema,
  effectiveConfig: extensibleLicenseConfigSchema,
  scheduleUsageBase: scheduleUsageContextSchema,
  activeProfileId: z.string().max(128).nullable(),
  isPreviewProfile: z.boolean(),
  isPreviewTrial: z.boolean(),
  freeScheduleDecision: freeScheduleDecisionSchema,
  estimate: optimizeDurationEstimateSchema,
  request: z.strictObject({
    include_upgrade_suggestions: z.boolean(),
    upgrade_suggestions_allowed: z.boolean(),
    history_source: z.enum(['generated', 'applied_suggestions']).optional(),
  }),
  configPermission: z.enum(['recommended', 'growth', 'advanced', 'ultimate', 'metered_advanced', 'admin', 'free_preview']),
  cdkUsageRef: z.strictObject({ code_hash: boundedString(256) }).nullable(),
})

const scenarioPayloadSchema: z.ZodType<ScenarioComparisonJobPayload> = z.strictObject({
  version: z.literal(3),
  kind: z.literal('scenario_comparison'),
  submittedAt: z.number().int().nonnegative(),
  operators: extensibleLicenseOperatorsSchema,
  effectiveConfig: extensibleLicenseConfigSchema,
  activeProfileId: boundedString(128),
  factors: scenarioComparisonFactorsSchema,
  estimate: optimizeDurationEstimateSchema,
})

const reorderPayloadSchema: z.ZodType<ReorderCheckJobPayload> = z.strictObject({
  version: z.literal(3),
  kind: z.literal('reorder_check'),
  submittedAt: z.number().int().nonnegative(),
  operators: extensibleLicenseOperatorsSchema,
  effectiveConfig: extensibleLicenseConfigSchema,
  activeProfileId: boundedString(128),
  isPreviewTrial: z.boolean(),
  baseline: workspaceHistoryItemSchema,
  estimate: optimizeDurationEstimateSchema,
})

export const optimizationJobPayloadSchema: z.ZodType<OptimizationJobPayload> = z.union([
  scenarioPayloadSchema,
  reorderPayloadSchema,
  schedulePayloadSchema,
])

export function parseOptimizationJobResult(
  payload: OptimizationJobPayload,
  value: unknown,
): OptimizeResult | ScenarioComparisonResult | ReorderCheckResult {
  if ('kind' in payload && payload.kind === 'scenario_comparison') return scenarioComparisonResultSchema.parse(value)
  if ('kind' in payload && payload.kind === 'reorder_check') {
    const result = reorderCheckResultSchema.parse(value)
    if (result.baseline.history_id !== payload.baseline.id
      || result.baseline.created_at !== payload.baseline.created_at
      || result.baseline.name !== payload.baseline.name) {
      throw new Error('换班结果基线与任务冻结基线不一致。')
    }
    if (result.estimated_gain_range.min !== null
      && result.estimated_gain_range.max !== null
      && result.estimated_gain_range.min > result.estimated_gain_range.max) {
      throw new Error('换班结果收益区间上下界无效。')
    }
    if (result.quota.used + result.quota.remaining !== result.quota.limit) {
      throw new Error('换班结果额度字段不一致。')
    }
    if (result.recommendation === 'strongly_recommended'
      && result.reasons.length === 0
      && result.changed_room_count === 0
      && result.key_operators.length === 0) {
      throw new Error('强烈建议换班的结果缺少推荐证据。')
    }
    return result
  }
  return optimizeResultSchema.parse(value)
}

function assertJsonSafe(value: unknown, context: z.RefinementCtx): void {
  const pending: Array<{ value: unknown; path: PropertyKey[]; depth: number }> = [{ value, path: [], depth: 0 }]
  const seen = new WeakSet<object>()
  let visited = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    visited += 1
    if (visited > 250_000 || current.depth > 64) {
      context.addIssue({ code: 'custom', path: current.path, message: '结果结构过大或嵌套过深。' })
      return
    }
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) context.addIssue({ code: 'custom', path: current.path, message: '结果数值必须是有限数。' })
      continue
    }
    if (typeof current.value !== 'object') {
      context.addIssue({ code: 'custom', path: current.path, message: '结果必须可安全序列化为 JSON。' })
      continue
    }
    if (seen.has(current.value)) {
      context.addIssue({ code: 'custom', path: current.path, message: '结果不能包含循环引用。' })
      continue
    }
    seen.add(current.value)
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => pending.push({ value: item, path: [...current.path, index], depth: current.depth + 1 }))
      continue
    }
    const prototype = Object.getPrototypeOf(current.value)
    if (prototype !== Object.prototype && prototype !== null) {
      context.addIssue({ code: 'custom', path: current.path, message: '结果只能包含普通 JSON 对象。' })
      continue
    }
    for (const [key, item] of Object.entries(current.value)) {
      if (item === undefined) continue
      pending.push({ value: item, path: [...current.path, key], depth: current.depth + 1 })
    }
  }
}
