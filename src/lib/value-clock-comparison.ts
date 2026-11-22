import { z } from 'zod'

const id = z.string().trim().min(1).max(128)
export const valueClockComparisonRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('verify'), profile_id: id, current_result_id: id, baseline_result_id: id,
    current_job_id: id, baseline_job_id: id, confirmed_previous_plan: z.literal(true), request_id: id }),
  z.strictObject({ action: z.literal('activate'), profile_id: id, comparison_id: id, revision: z.number().int().nonnegative() }),
])
export type ValueClockComparisonRequest = z.infer<typeof valueClockComparisonRequestSchema>
const date = z.iso.datetime({ offset: true })
export const valueClockComparisonSchema = z.object({
  id, current_result_id: id, baseline_result_id: id, baseline_name: z.string(),
  current_daily_sanity: z.number().finite(), baseline_daily_sanity: z.number().finite(), daily_gain_sanity: z.number().finite(),
  confirmed_at: date.nullable(), ends_at: date.nullable(),
})
export type ValueClockComparison = z.infer<typeof valueClockComparisonSchema>
export const personalValueClockSchema = z.object({
  revision: z.number().int().nonnegative(), comparison_state: z.enum(['not_set', 'active', 'ended']),
  current: z.object({ id, name: z.string(), created_at: date }).nullable(),
  comparison: valueClockComparisonSchema.nullable(),
})
