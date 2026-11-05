import { z } from 'zod'
import type { QqBotCampaign } from './qqbot-reward-contracts'

const groupId = z.string().regex(/^[1-9][0-9]{0,19}$/)
const campaignId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const qqNumber = z.string().regex(/^[1-9][0-9]{4,11}$/)
export const qqBotVerificationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), qq_number: qqNumber, group_id: groupId, campaign_id: campaignId.nullable() }).strict(),
  z.object({ action: z.literal('confirm'), verification_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('claim'), group_id: groupId, campaign_id: campaignId }).strict(),
])
export const qqBotVerificationProofSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('message'), code: z.string().regex(/^[A-F0-9]{6}-[A-F0-9]{6}$/), qq_number: qqNumber, group_id: groupId, joined_at: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('membership'), verification_id: z.string().uuid(), qq_number: qqNumber, group_id: groupId, joined_at: z.number().int().nonnegative(), member: z.boolean() }).strict(),
])
export type QqBotVerificationAction = z.infer<typeof qqBotVerificationActionSchema>
export type QqBotVerificationProof = z.infer<typeof qqBotVerificationProofSchema>
export type QqBotVerification = {
  id: string; qq_number: string; group_id: string; campaign_id: string | null
  kind: 'message' | 'membership'; status: 'pending' | 'verified' | 'completed' | 'rejected' | 'expired'
  expires_at: string; error_message: string | null
}
export type QqBotActivity = Omit<QqBotCampaign, 'created_by' | 'revision' | 'created_at' | 'updated_at' | 'gift_pack_version_id'> & { item_name: string; icon_key: string; claimed: boolean; claimed_elsewhere: boolean }
export type QqBotActivitiesResponse = { campaigns: QqBotActivity[] }
