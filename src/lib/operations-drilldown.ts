import { z } from 'zod'
import { copy } from '../copy'
import { adminPath } from './app-routes'
import { isOperationsDate, operationsDate, type OperationsOverview } from './operations-overview'

export const operationsCohortLabels = copy.admin.operations_cohorts
export type OperationsCohort = keyof typeof operationsCohortLabels

export const operationsDrilldownSchema = z.object({
  cohort: z.enum(Object.keys(operationsCohortLabels) as [OperationsCohort, ...OperationsCohort[]]),
  from: z.string().refine(isOperationsDate), to: z.string().refine(isOperationsDate),
  observed_at: z.iso.datetime({ offset: true }),
  reason: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).optional(),
}).refine((value) => Number.isFinite(Date.parse(value.observed_at))
  && value.from <= value.to && value.to <= operationsDate(new Date(value.observed_at))
  && Date.parse(value.to) - Date.parse(value.from) < 90 * 86_400_000
  && (!value.reason || value.cohort === 'failed'), copy.admin.operations_filter_invalid)
export type OperationsDrilldown = z.infer<typeof operationsDrilldownSchema>

export function operationsUsersPath(data: OperationsOverview, cohort: OperationsCohort, reason?: string): string {
  const params = new URLSearchParams({ cohort, from: data.current.from, to: data.current.to, observed_at: data.generated_at })
  if (reason) params.set('reason', reason)
  return `${adminPath('users')}?${params}`
}

export interface OperationsUserProgress {
  stage: 'no_profile' | 'no_generation' | 'activated' | 'observing' | 'used'
  failure_reason: string | null
  failure_at: string | null
}

export interface OperationsTodos {
  generated_at: string
  feedback_unassigned: number | null
  feedback_reply: number | null
  risk_pending: number | null
  abnormal_jobs: number | null
}

export const operationsFailureLabels: Record<string, string> = copy.admin.operations_failure_labels
