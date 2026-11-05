import { requireUserSession } from './user-auth'
import { authenticateWebsiteIntegrationRequest, websiteIntegrationResponse as json } from '../security/website-integration-auth'
import { reservePersistentRateLimit } from '../security/persistent-rate-limit'
import { getRequestClientIp } from '../security/client-ip'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { qqBotVerificationActionSchema, qqBotVerificationProofSchema } from '../../src/lib/qqbot-verification-contracts'
import { actOnQqBotVerification, getUserQqBotVerification, listQqBotMembershipChecks, listUserQqBotActivities, recordQqBotVerification } from '../storage/qqbot-verification-store'
import { QqBotError } from '../storage/qqbot-store'
import { InventoryError } from '../storage/inventory-store'
import { requireSiteFeatures } from '../feature-gate'

export default async function qqBotVerificationsHandler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/integrations/')) {
      const auth = authenticateWebsiteIntegrationRequest(req, 'WEBSITE_QQBOT_TOKEN')
      if (!auth.ok) return auth.response
      const limited = await reserve('qqbot-account', getRequestClientIp(req), 120)
      if (limited) return limited
      if (req.method === 'GET') return json({ schema_version: 1, checks: await listQqBotMembershipChecks() })
      if (req.method === 'POST') {
        const body = await getValidatedJson(req, qqBotVerificationProofSchema, true)
        if (body.action === 'membership') {
          const gate = await requireSiteFeatures(['inventory'])
          if (gate) return gate
        }
        return json({ schema_version: 1, ...await recordQqBotVerification(body) })
      }
      return json({ error: 'Method not allowed' }, 405)
    }
    const auth = await requireUserSession(req)
    if (!auth) return json({ error: '请先登录。' }, 401)
    if (url.pathname.endsWith('/activities')) {
      if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      const gate = await requireSiteFeatures(['inventory'])
      if (gate) return gate
      const group = url.searchParams.get('group_id')
      const campaign = url.searchParams.get('campaign_id')
      if ((group !== null && !/^[1-9][0-9]{0,19}$/.test(group)) || (campaign !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(campaign))) {
        throw new QqBotError('campaign_query_invalid', '群号或活动编号格式不正确。', 400)
      }
      return json({ campaigns: await listUserQqBotActivities(auth.user.id, group, campaign) })
    }
    if (req.method === 'GET') return json({ verification: await getUserQqBotVerification(auth.user.id) })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (Buffer.byteLength(process.env.WEBSITE_QQBOT_TOKEN?.trim() ?? '', 'utf8') < 32) return json({ error: 'QQ 验证服务尚未开放。' }, 503)
    const limited = await reserve('qqbot-web-verification', auth.user.id, 15)
    if (limited) return limited
    const body = await getValidatedJson(req, qqBotVerificationActionSchema, true)
    if (body.action === 'claim' || (body.action === 'start' && body.campaign_id)) {
      const gate = await requireSiteFeatures(['inventory'])
      if (gate) return gate
    }
    // Confirmation may grant a reward, so check its saved purpose rather than trusting browser input.
    if (body.action === 'confirm') {
      const pending = await getUserQqBotVerification(auth.user.id, body.verification_id)
      if (pending?.id === body.verification_id && pending.campaign_id) {
        const gate = await requireSiteFeatures(['inventory'])
        if (gate) return gate
      }
    }
    return json(await actOnQqBotVerification(auth.user.id, body), 200)
  } catch (error) {
    if (error instanceof QqBotError || error instanceof InventoryError || error instanceof RequestInputError) return json({ error: error.message, code: error.code }, error.status)
    console.error('QQ website verification failed', { error_type: error instanceof Error ? error.name : typeof error })
    return json({ error: 'QQ 验证服务暂时不可用，请稍后重试。' }, 503)
  }
}
async function reserve(scope: string, id: string, limit: number) {
  const result = await reservePersistentRateLimit(scope, id, limit, 60_000)
  if (!result.allowed) return json({ error: '请求较多，请稍后重试。', code: 'rate_limited' }, 429, { 'Retry-After': String(result.retryAfterSeconds) })
  result.attempt.retain()
  return null
}
