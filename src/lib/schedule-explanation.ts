import { z } from 'zod'

export const scheduleExplanationStateSchema = z.object({
  explanation: z.object({ text: z.string().min(1).max(4000), created_at: z.iso.datetime() }).nullable(),
  pending: z.boolean(),
  available: z.boolean(),
  reason: z.enum(['disabled', 'quota', 'budget', 'daily_limit', 'busy']).nullable(),
  quota: z.object({ kind: z.enum(['trial', 'monthly']), limit: z.number().int().nonnegative(), remaining: z.number().int().nonnegative(), resets_at: z.iso.datetime().nullable() }),
  provider: z.string().nullable(),
})

export type ScheduleExplanationState = z.infer<typeof scheduleExplanationStateSchema>
