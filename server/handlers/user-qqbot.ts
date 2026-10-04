import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { websiteIntegrationResponse } from '../security/website-integration-auth'
import {
  createQqBotBindingCode, getUserQqBotBinding, QqBotError, setQqBotNotifications, unbindQqBotAccount,
} from '../storage/qqbot-store'
import { requireUserSession } from './user-auth'

export default async function userQqBotHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return websiteIntegrationResponse({ error: '请先登录。' }, 401)
    const available = Buffer.byteLength(process.env.WEBSITE_QQBOT_TOKEN?.trim() ?? '', 'utf8') >= 32
    if (req.method === 'GET') {
      const binding = await getUserQqBotBinding(auth.user.id)
      return websiteIntegrationResponse({
        available,
        binding: binding ? {
          binding_id: binding.id, qq_number: binding.qq_number,
          notifications_enabled: binding.notifications_enabled, bound_at: binding.created_at,
        } : null,
      })
    }
    if (req.method === 'DELETE') {
      await unbindQqBotAccount(auth.user.id)
      return websiteIntegrationResponse({ status: 'unbound' })
    }
    if (req.method === 'POST') {
      if (!available) return unavailable()
      return websiteIntegrationResponse(await createQqBotBindingCode(auth.user.id), 201)
    }
    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.qqBotPreferences)
      if (body.notifications_enabled && !available) return unavailable()
      const binding = await setQqBotNotifications(auth.user.id, body.notifications_enabled)
      return websiteIntegrationResponse({ notifications_enabled: binding.notifications_enabled })
    }
    return websiteIntegrationResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof QqBotError || error instanceof RequestInputError) {
      return websiteIntegrationResponse({ error: error.message, code: error.code }, error.status)
    }
    console.error('QQ Bot account settings failed', { error_type: error instanceof Error ? error.name : typeof error })
    return websiteIntegrationResponse({ error: 'QQ 通知设置暂时不可用，请稍后重试。', code: 'service_unavailable' }, 503)
  }
}

function unavailable(): Response {
  return websiteIntegrationResponse({ error: 'QQ 通知服务尚未开放。', code: 'integration_not_configured' }, 503)
}
