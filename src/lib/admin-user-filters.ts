import { z } from 'zod'
import { copy } from '../copy'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() > 0 && parsed.toISOString().slice(0, 10) === value
}, copy.admin.user_filter_date_invalid).or(z.literal('')).default('')

export const adminUserFiltersSchema = z.object({
  status: z.enum(['all', 'active', 'frozen', 'revoked', 'pending_deletion']).default('all'),
  permission: z.enum(['all', 'recommended', 'growth', 'advanced', 'ultimate']).default('all'),
  profile_kind: z.enum(['all', 'cdk', 'free_preview', 'metered_personal', 'metered_commercial', 'depot_value', 'none']).default('all'),
  email_verified: z.enum(['all', 'yes', 'no']).default('all'),
  activity: z.enum(['all', 'seen', 'never']).default('all'),
  registered_from: date,
  registered_to: date,
  last_seen_from: date,
  last_seen_to: date,
  sort: z.enum(['registered_desc', 'registered_asc', 'last_seen_desc', 'last_seen_asc']).default('registered_desc'),
}).refine((value) => !value.registered_from || !value.registered_to || value.registered_from <= value.registered_to, copy.admin.user_filter_registered_range_invalid)
  .refine((value) => !value.last_seen_from || !value.last_seen_to || value.last_seen_from <= value.last_seen_to, copy.admin.user_filter_last_seen_range_invalid)
  .refine((value) => value.activity !== 'never' || (!value.last_seen_from && !value.last_seen_to), copy.admin.user_filter_activity_range_conflict)

export type AdminUserFilters = z.infer<typeof adminUserFiltersSchema>
export const DEFAULT_ADMIN_USER_FILTERS: AdminUserFilters = adminUserFiltersSchema.parse({})
