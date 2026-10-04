import { getRequestClientIp } from '../security/client-ip'
import { reservePersistentRateLimit } from '../security/persistent-rate-limit'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { authenticateWebsiteIntegrationRequest, websiteIntegrationResponse } from '../security/website-integration-auth'
import {
  acknowledgeQqBotNotification, bindQqBotAccount, getQqBotAccount, listQqBotScheduleNotifications,
  QqBotError, setQqBotNotifications, unbindQqBotAccount,
} from '../storage/qqbot-store'
import { listProfilesForUser } from '../storage/user-store'
import { requireSiteFeatures } from '../feature-gate'
import { handleUserResultsRequest } from './user-results'

const BASE = '/api/integrations/qqbot'

export default async function qqBotAccountHandler(req: Request): Promise<Response> {
  const authentication = authenticateWebsiteIntegrationRequest(req, 'WEBSITE_QQBOT_TOKEN')
  if (!authentication.ok) return authentication.response
  const url = new URL(req.url)
  const path = url.pathname
  try {
    const rateLimit = await reservePersistentRateLimit('qqbot-account', getRequestClientIp(req), 120, 60_000)
    if (!rateLimit.allowed) return websiteIntegrationResponse(
      { error: 'Too many requests', code: 'rate_limited' }, 429, { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    )
    rateLimit.attempt.retain()

    if (path === `${BASE}/binding` && req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.qqBotBinding, true)
      const binding = await bindQqBotAccount(body.qq_number, body.binding_code)
      return websiteIntegrationResponse({ schema_version: 1, binding_id: binding.id, notifications_enabled: false }, 201)
    }
    if (path === `${BASE}/notifications` && req.method === 'GET') {
      const rawLimit = url.searchParams.get('limit') ?? '50'
      if (!/^(?:[1-9]|[1-9]\d|100)$/.test(rawLimit)) throw new QqBotError('invalid_limit', '通知数量必须为 1 到 100。', 400)
      return websiteIntegrationResponse({ schema_version: 1, ...await listQqBotScheduleNotifications(Number(rawLimit), url.searchParams.get('cursor')) })
    }
    if (path === `${BASE}/notifications/ack` && req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.qqBotNotificationAck, true)
      await acknowledgeQqBotNotification(body.qq_number, body.notification_id)
      return websiteIntegrationResponse({ schema_version: 1, status: 'acknowledged' })
    }
    if (path === `${BASE}/account` && req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.qqBotAccountPreferences, true)
      const { user, binding: currentBinding } = await getQqBotAccount(body.qq_number)
      const binding = await setQqBotNotifications(user.id, body.notifications_enabled, currentBinding.id)
      return websiteIntegrationResponse({ schema_version: 1, binding_id: binding.id, notifications_enabled: binding.notifications_enabled })
    }
    if (path === `${BASE}/binding` && req.method === 'DELETE') {
      const body = await getValidatedJson(req, requestSchemas.qqBotRegistrationInvitation, true)
      const { user, binding: currentBinding } = await getQqBotAccount(body.qq_number)
      await unbindQqBotAccount(user.id, currentBinding.id)
      return websiteIntegrationResponse({ schema_version: 1, status: 'unbound' })
    }
    if (path === `${BASE}/maa-export` && req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.qqBotMaaExport, true)
      const { user, binding } = await getQqBotAccount(body.qq_number)
      if (body.binding_id !== binding.id) throw new QqBotError('binding_changed', 'QQ 绑定已变化，请重新查询。', 409)
      if (body.automatic && !binding.notifications_enabled) throw new QqBotError('notifications_disabled', 'QQ 通知已关闭。', 403)
      const gate = await requireSiteFeatures(['profiles', 'inventory'])
      if (gate) return gate
      return await forwardResultRequest(req, '/api/user/maa-export', {
        profile_id: body.profile_id, result_id: body.result_id,
        idempotency_key: `qqbot:${binding.id}:${body.idempotency_key}`, use_coupon: body.automatic ? undefined : body.use_coupon,
      }, user)
    }
    if (req.method === 'GET' && (path === `${BASE}/account` || path === `${BASE}/results`)) {
      const qqNumber = url.searchParams.get('qq_number') ?? ''
      if (!/^[1-9][0-9]{4,11}$/.test(qqNumber)) throw new QqBotError('qq_number_invalid', 'QQ number is invalid', 400)
      const { binding, user } = await getQqBotAccount(qqNumber)
      const gate = await requireSiteFeatures(['profiles'])
      if (gate) return gate
      if (path === `${BASE}/account`) {
        const profiles = await listProfilesForUser(user.id)
        return websiteIntegrationResponse({
          schema_version: 1, binding_id: binding.id, notifications_enabled: binding.notifications_enabled,
          profiles: profiles.filter((profile) => !profile.archived_at && profile.kind !== 'depot_value').map((profile) => ({
            id: profile.id, display_name: profile.display_name, status: profile.status,
          })),
        })
      }
      const target = new URL('/api/user/results', req.url)
      for (const key of ['profile_id', 'scope', 'cursor', 'limit']) {
        const value = url.searchParams.get(key)
        if (value !== null) target.searchParams.set(key, value)
      }
      if (!target.searchParams.has('scope')) target.searchParams.set('scope', 'active')
      return noStore(await handleUserResultsRequest(new Request(target, { headers: requestHeaders(req) }), async () => ({ user, tokenHash: null })))
    }
    return websiteIntegrationResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof QqBotError || error instanceof RequestInputError) {
      return websiteIntegrationResponse({ error: error.message, code: error.code }, error.status)
    }
    console.error('QQ Bot account operation failed', { error_type: error instanceof Error ? error.name : typeof error })
    return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
  }
}

async function forwardResultRequest(
  req: Request, path: string, body: unknown, user: Awaited<ReturnType<typeof getQqBotAccount>>['user'],
): Promise<Response> {
  const headers = requestHeaders(req)
  headers.set('Content-Type', 'application/json')
  return noStore(await handleUserResultsRequest(new Request(new URL(path, req.url), {
    method: 'POST', headers, body: JSON.stringify(body),
  }), async () => ({ user, tokenHash: null })))
}

function requestHeaders(req: Request): Headers {
  const headers = new Headers(req.headers)
  headers.delete('Authorization')
  headers.delete('Cookie')
  headers.delete('Idempotency-Key')
  headers.delete('Content-Length')
  return headers
}

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
