import { z } from 'zod'

export const qqBotCampaignInputSchema = z.strictObject({
  group_id: z.string().regex(/^[1-9][0-9]{0,19}$/),
  campaign_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  item_code: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  quantity: z.number().int().min(1).max(10000),
  validity_days: z.number().int().min(0).max(3650),
  min_join_days: z.number().int().min(0).max(36500),
  joined_before: z.string().datetime().nullable(),
  ends_at: z.string().datetime().nullable(),
})

export const qqBotCampaignSchema = qqBotCampaignInputSchema.extend({
  gift_pack_version_id: z.string().min(1).max(128).nullable(),
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  created_by: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export type QqBotCampaignInput = z.infer<typeof qqBotCampaignInputSchema>
export type QqBotCampaign = z.infer<typeof qqBotCampaignSchema>
