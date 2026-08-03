import type { OnboardingTaskCode } from '../../src/lib/inventory-contracts'
import {
  adminGrantItem,
  configureOnboardingTask,
  createCustomGiftPack,
  createDistributionCampaign,
  createGiftPackDraft,
  getAdminInventoryOverview,
  isAllUsersDistributionCampaign,
  processInventoryCampaignBatch,
  publishGiftPackVersion,
  retryFailedCampaignRecipients,
  retireGiftPackVersion,
  revokeGrant,
  updateCampaignStatus,
  updateItemPresentation,
} from '../storage/admin-inventory-store'
import { InventoryError } from '../storage/inventory-store'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { authenticateAdminRequest, requireRootAdminPassword } from './admin-auth'
import { jsonResponse } from './license-utils'

export default async function adminItemsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req, {
      capability: 'admin_manage',
      requireRecentLogin: req.method !== 'GET',
    })
    if (!authentication.ok) return authentication.response
    const path = new URL(req.url).pathname

    if (req.method === 'GET') return jsonResponse(await getAdminInventoryOverview())

    if (path === '/api/admin/items') {
      const body = await getValidatedJson(req, requestSchemas.adminItems)
      if (body.action === 'create_gift_pack') {
        return jsonResponse(await createCustomGiftPack(authentication.username, {
          ...body,
          idempotencyKey: body.idempotency_key,
        }), 201)
      }
      if (body.action === 'create_gift_pack_version') {
        return jsonResponse(await createGiftPackDraft(authentication.username, body.item_code, body.contents, body.idempotency_key), 201)
      }
      if (body.action === 'publish_gift_pack_version') {
        await publishGiftPackVersion(authentication.username, requireValue(body.version_id, '缺少礼包版本。'))
        return jsonResponse({ ok: true })
      }
      if (body.action === 'retire_gift_pack_version') {
        await retireGiftPackVersion(authentication.username, requireValue(body.version_id, '缺少礼包版本。'))
        return jsonResponse({ ok: true })
      }
      if (body.action === 'update_item') {
        await updateItemPresentation(authentication.username, requireValue(body.item_code, '缺少道具代码。'), body)
        return jsonResponse({ ok: true })
      }
      if (body.action === 'configure_onboarding_task') {
        await configureOnboardingTask(authentication.username, body.task_code as OnboardingTaskCode, body.enabled, body.rewards)
        return jsonResponse({ ok: true })
      }
      return jsonResponse({ error: '未知道具管理操作。' }, 400)
    }

    if (path === '/api/admin/inventory') {
      const body = await getValidatedJson(req, requestSchemas.adminInventory)
      if (body.action === 'grant') {
        const grantId = await adminGrantItem(authentication.username, {
          userId: body.user_id,
          itemCode: body.item_code,
          quantity: body.quantity,
          validityDays: body.validity_days,
          giftPackVersionId: body.gift_pack_version_id,
          reason: body.reason,
          idempotencyKey: body.idempotency_key,
        })
        return jsonResponse({ ok: true, grant_id: grantId }, 201)
      }
      if (body.action === 'revoke_grant') {
        return jsonResponse(await revokeGrant(authentication.username, body.grant_id, body.reason))
      }
      if (body.action === 'create_campaign') {
        if (body.target_mode === 'all_users') {
          if (body.confirmation !== 'DISTRIBUTE TO ALL USERS') return jsonResponse({ error: '全站发放确认文本不正确。' }, 400)
          const root = await requireRootAdminPassword(req, body.root_password)
          if (!root.ok) return root.response
        }
        const campaign = await createDistributionCampaign(authentication.username, {
          itemCode: body.item_code,
          giftPackVersionId: body.gift_pack_version_id,
          quantity: body.quantity,
          validityDays: body.validity_days,
          targetMode: body.target_mode,
          userIds: body.user_ids,
          reason: body.reason,
          idempotencyKey: body.idempotency_key,
        })
        return jsonResponse(campaign, 201)
      }
      if (body.action === 'pause_campaign' || body.action === 'resume_campaign' || body.action === 'cancel_campaign' || body.action === 'reverse_campaign') {
        if (body.action === 'reverse_campaign' && await isAllUsersDistributionCampaign(body.campaign_id)) {
          const root = await requireRootAdminPassword(req, body.root_password)
          if (!root.ok) return root.response
        }
        const action = body.action.replace('_campaign', '') as 'pause' | 'resume' | 'cancel' | 'reverse'
        await updateCampaignStatus(authentication.username, body.campaign_id, action, body.reason)
        return jsonResponse({ ok: true })
      }
      if (body.action === 'retry_campaign_failures') {
        return jsonResponse({ ok: true, retried: await retryFailedCampaignRecipients(authentication.username, body.campaign_id, body.reason) })
      }
      if (body.action === 'process_campaigns') {
        return jsonResponse({ ok: true, processed: await processInventoryCampaignBatch(100) })
      }
      return jsonResponse({ error: '未知库存管理操作。' }, 400)
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    if (error instanceof InventoryError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('admin items error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new InventoryError('value_required', message, 400)
  return value
}
