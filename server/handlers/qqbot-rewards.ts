import { getRequestClientIp } from '../security/client-ip'
import { reservePersistentRateLimit } from '../security/persistent-rate-limit'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { authenticateWebsiteIntegrationRequest, websiteIntegrationResponse } from '../security/website-integration-auth'
import { getQqBotAccount, QqBotError } from '../storage/qqbot-store'
import { deliverQqBotReward, listQqBotRewardItems, listQqBotCampaigns } from '../storage/qqbot-reward-store'
import { InventoryError } from '../storage/inventory-store'
import { requireSiteFeatures } from '../feature-gate'

export default async function qqBotRewardsHandler(req: Request): Promise<Response> {
  const authentication = authenticateWebsiteIntegrationRequest(req, 'WEBSITE_QQBOT_TOKEN')
  if (!authentication.ok) return authentication.response
  try {
    const rateLimit = await reservePersistentRateLimit('qqbot-account', getRequestClientIp(req), 120, 60_000)
    if (!rateLimit.allowed) return websiteIntegrationResponse({ code: 'rate_limited', error: 'Too many requests' }, 429, {
      'Retry-After': String(rateLimit.retryAfterSeconds),
    })
    rateLimit.attempt.retain()
    const url = new URL(req.url)
    if (url.pathname.endsWith('/member-account') && req.method === 'GET') {
      const qq = url.searchParams.get('qq_number') ?? ''
      if (!/^[1-9][0-9]{4,11}$/.test(qq)) throw new QqBotError('qq_number_invalid', 'QQ number is invalid', 400)
      const { user } = await getQqBotAccount(qq)
      return websiteIntegrationResponse({ schema_version: 1, user_id: user.id })
    }
    const gate = await requireSiteFeatures(['inventory'])
    if (gate) return gate
    if (url.pathname.endsWith('/reward-campaigns') && req.method === 'GET') {
      const groupId = url.searchParams.get('group_id') ?? ''
      const campaignId = url.searchParams.get('campaign_id')
      if (!/^[1-9][0-9]{0,19}$/.test(groupId) || (campaignId !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(campaignId))) {
        throw new QqBotError('campaign_query_invalid', '群号或活动编号格式不正确。', 400)
      }
      return websiteIntegrationResponse({ schema_version: 1, campaigns: await listQqBotCampaigns(groupId, campaignId) })
    }
    if (url.pathname.endsWith('/reward-items') && req.method === 'GET') {
      return websiteIntegrationResponse({ schema_version: 1, items: await listQqBotRewardItems() })
    }
    if (url.pathname.endsWith('/rewards') && req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.qqBotReward, true)
      return websiteIntegrationResponse(await deliverQqBotReward(body), 201)
    }
    return websiteIntegrationResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof QqBotError || error instanceof InventoryError || error instanceof RequestInputError) {
      return websiteIntegrationResponse({ error: error.message, code: error.code }, error.status)
    }
    console.error('QQ Bot reward operation failed', { error_type: error instanceof Error ? error.name : typeof error })
    return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
  }
}
