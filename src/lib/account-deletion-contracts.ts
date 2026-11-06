import { z } from 'zod'

export const ACCOUNT_DELETION_REASONS = [
  'no_longer_needed',
  'results_unsatisfactory',
  'difficult_to_use',
  'price',
  'privacy',
  'other',
  'prefer_not_to_say',
] as const
export const ACCOUNT_DELETION_DETAIL_MAX_LENGTH = 500

export const accountDeletionSurveySchema = z.strictObject({
  reason: z.enum(ACCOUNT_DELETION_REASONS),
  reason_detail: z.string().trim().max(ACCOUNT_DELETION_DETAIL_MAX_LENGTH).default(''),
})

export type AccountDeletionSurvey = z.infer<typeof accountDeletionSurveySchema>
