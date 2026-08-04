import { z } from 'zod'
import { copy } from '../copy/index'

const WORKSPACE_OPERATOR_LIMIT = 500
const WORKSPACE_ELITE_OVERRIDE_LIMIT = 500

const boundedString = (max: number) => z.string().min(1).max(max)
const finiteNumber = z.number().finite()
const boundedCountRecord = z.record(
  boundedString(64),
  z.number().int().min(0).max(6),
).superRefine((value, context) => {
  if (Object.keys(value).length > 16) {
    context.addIssue({
      code: 'too_big',
      origin: 'object',
      maximum: 16,
      inclusive: true,
      message: copy.domain.lib_workspace_validation_001,
    })
  }
})

const licenseOperatorShape = {
  id: boundedString(128),
  name: boundedString(80),
  own: z.boolean(),
  elite: z.number().int().min(0).max(2),
  rarity: z.number().int().min(0).max(6),
  level: z.number().int().min(0).max(100).optional(),
  potential: z.number().int().min(0).max(6).optional(),
}

const assertUniqueOperatorIds = (
  operators: Array<{ id: string }>,
  context: z.RefinementCtx,
): void => {
  const ids = new Set<string>()
  for (const [index, operator] of operators.entries()) {
    if (ids.has(operator.id)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: copy.domain.lib_workspace_validation_002,
      })
    }
    ids.add(operator.id)
  }
}

export const licenseOperatorsSchema = z.array(z.strictObject(licenseOperatorShape))
  .min(1)
  .max(WORKSPACE_OPERATOR_LIMIT)
  .superRefine(assertUniqueOperatorIds)

export const extensibleLicenseOperatorsSchema = z.array(z.object(licenseOperatorShape).passthrough())
  .min(1)
  .max(WORKSPACE_OPERATOR_LIMIT)
  .superRefine(assertUniqueOperatorIds)

const optimizerSearchSchema = z.strictObject({
  optimization_mode: boundedString(32).optional(),
  beam: z.boolean().optional(),
  candidate_limit: z.number().int().min(1).max(100_000).optional(),
  beam_width: z.number().int().min(1).max(100_000).optional(),
  trace_search: z.boolean().optional(),
  trace_dynamic_rules: z.boolean().optional(),
  trace_candidates: z.boolean().optional(),
})

const variableShiftScheduleSchema = z.strictObject({
  enable: z.boolean().optional(),
  enabled: z.boolean().optional(),
  max_shifts: z.number().int().min(1).max(24).optional(),
  shift_step_minutes: z.number().int().min(1).max(1_440).optional(),
  min_low_hours: finiteNumber.min(0).max(24).optional(),
  beam_width: z.number().int().min(1).max(100_000).optional(),
  trace_variable_shifts: z.boolean().optional(),
  trace_mood_cycle: z.boolean().optional(),
})

const intermediateInventorySchema = z.strictObject({
  'Originium Shard': finiteNumber.min(0).max(1_000_000_000_000).optional(),
  'Pure Gold': finiteNumber.min(0).max(1_000_000_000_000).optional(),
  'Orirock Cube': finiteNumber.min(0).max(1_000_000_000_000).optional(),
})

const licenseConfigShape = {
  layout: boundedString(32),
  desc: z.string().max(200),
  schedule_mode: boundedString(40).optional(),
  mode: boundedString(40).optional(),
  dormitory_rule: boundedString(40).optional(),
  shift_hours: z.union([
    z.array(finiteNumber.positive().max(24)).min(1).max(6),
    boundedString(80),
  ]).optional(),
  trading_stations_count: z.number().int().min(1).max(5),
  manufacturing_stations_count: z.number().int().min(1).max(5),
  product_requirements: z.strictObject({
    trading_stations: boundedCountRecord,
    manufacturing_stations: boundedCountRecord,
  }),
  Fiammetta: z.strictObject({
    enable: z.boolean(),
    candidate_mode: boundedString(40).optional(),
  }).optional(),
  optimization_mode: boundedString(32).optional(),
  optimizer_search: optimizerSearchSchema.optional(),
  drones: z.strictObject({
    enable: z.boolean(),
    auto: z.boolean().optional(),
    auto_strategy: boundedString(64).optional(),
    auto_target_product: boundedString(64).optional(),
    order: boundedString(16).optional().default('pre'),
    targets: z.array(boundedString(64)).max(20).optional().default([]),
  }).optional(),
  orundum_planning: z.strictObject({
    daily_sanity_budget: finiteNumber.min(0).max(100_000).optional(),
    monthly_card: z.boolean().optional(),
  }).optional(),
  variable_shift_schedule: variableShiftScheduleSchema.optional(),
  intermediate_inventory: intermediateInventorySchema.optional(),
  auto_balance_source: boundedString(40).optional(),
}

export const licenseConfigSchema = z.strictObject(licenseConfigShape)

export const extensibleLicenseConfigSchema = z.object(licenseConfigShape).passthrough()

export const eliteOverridesSchema = z.record(
  boundedString(128),
  z.number().int().min(0).max(2),
).superRefine((value, context) => {
  if (Object.keys(value).length > WORKSPACE_ELITE_OVERRIDE_LIMIT) {
    context.addIssue({
      code: 'too_big',
      origin: 'object',
      maximum: WORKSPACE_ELITE_OVERRIDE_LIMIT,
      inclusive: true,
      message: copy.domain.lib_workspace_validation_003(WORKSPACE_ELITE_OVERRIDE_LIMIT),
    })
  }
})

export const workspaceSavedConfigActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('save'),
    id: boundedString(128).optional(),
    name: boundedString(40),
    config: licenseConfigSchema,
  }),
  z.strictObject({ type: z.literal('rename'), id: boundedString(128), name: boundedString(40) }),
  z.strictObject({ type: z.literal('delete'), id: boundedString(128) }),
  z.strictObject({ type: z.literal('touch'), id: boundedString(128) }),
])
