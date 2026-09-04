import { z } from 'zod'

const expiryPolicySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('never') }),
  z.strictObject({ mode: z.literal('relative_days'), days: z.number().int().min(1).max(3650) }),
])

const rewardContentSchema = z.strictObject({
  item_code: z.string().min(1).max(128),
  quantity: z.number().int().min(1).max(10000),
  expiry: expiryPolicySchema,
  gift_pack_version_id: z.string().min(1).max(128).optional(),
})

const itemDefinitionSchema = z.object({
  code: z.string().min(1),
  kind: z.enum(['consumable', 'capacity_upgrade', 'gift_pack', 'cosmetic', 'badge', 'license_voucher']),
  effect_code: z.enum([
    'priority_compute', 'scenario_simulation', 'training_diagnosis',
    'additional_recompute', 'plan_capacity', 'history_capacity', 'result_archive_capacity',
    'maa_export_trial', 'open_gift_pack', 'bind_lifetime_profile', 'activate_limited_profile',
  ]).nullable(),
  name: z.string(),
  description: z.string(),
  icon_key: z.string(),
  system_owned: z.boolean(),
  issuance_enabled: z.boolean(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

const giftVersionSchema = z.object({
  id: z.string().min(1),
  item_code: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'retired']),
  contents: z.array(rewardContentSchema),
  created_at: z.string(),
  published_at: z.string().nullable(),
})

const taskConfigSchema = z.object({
  task_code: z.enum(['welcome_inventory', 'bind_skland', 'first_main_schedule']),
  version: z.number().int().positive(),
  enabled: z.boolean(),
  rewards_json: z.array(rewardContentSchema),
  created_at: z.string(),
})

const failedRecipientSchema = z.object({
  user_id: z.string().min(1),
  error_message: z.string().nullable(),
  attempt_count: z.number().int().nonnegative(),
  processed_at: z.string().nullable(),
})

const campaignSchema = z.object({
  id: z.string().min(1),
  item_code: z.string().min(1),
  target_mode: z.enum(['user_ids', 'all_users']),
  status: z.enum([
    'draft', 'queued', 'running', 'paused', 'completed', 'completed_with_failures',
    'cancelled', 'reversing', 'reversed',
  ]),
  recipient_count: z.number().int().nonnegative(),
  granted_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  processing_count: z.number().int().nonnegative(),
  skipped_count: z.number().int().nonnegative(),
  revoked_count: z.number().int().nonnegative(),
  failed_recipients: z.array(failedRecipientSchema),
})

const auditSchema = z.object({
  id: z.string().min(1),
  admin_username: z.string().min(1),
  action: z.string().min(1),
  target_type: z.string().min(1),
  target_id: z.string().min(1),
  reason: z.string().min(1),
  before_json: z.unknown().nullable(),
  after_json: z.unknown().nullable(),
  created_at: z.string(),
})

export const adminInventoryOverviewSchema = z.strictObject({
  definitions: z.array(itemDefinitionSchema),
  gift_pack_versions: z.array(giftVersionSchema),
  tasks: z.array(taskConfigSchema),
  campaigns: z.array(campaignSchema),
  audits: z.array(auditSchema),
  user_count: z.number().int().nonnegative(),
})

export type AdminInventoryOverview = z.infer<typeof adminInventoryOverviewSchema>
export type AdminInventoryCampaign = z.infer<typeof campaignSchema>
export type AdminInventoryGiftVersion = z.infer<typeof giftVersionSchema>
