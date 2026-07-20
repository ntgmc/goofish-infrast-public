import { authenticateAdminRequest } from './admin-auth'
import {
  getInvitationSettings,
  saveInvitationSettings,
  validateInvitationSettingsPatch,
  type InvitationSettingsPatch,
} from '../storage/invitation-store'
import { jsonResponse } from './user-auth'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

export default async function adminInvitationSettingsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') return jsonResponse({ settings: await getInvitationSettings() })
    if (req.method !== 'PUT' && req.method !== 'PATCH') return jsonResponse({ error: 'Method not allowed' }, 405)
    let patch: InvitationSettingsPatch
    try {
      patch = validateInvitationSettingsPatch(await getValidatedJson(req, requestSchemas.adminInvitationSettings))
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '邀请设置无效。' }, 400)
    }
    return jsonResponse({ settings: await saveInvitationSettings(patch) })
  } catch (error) {
    console.error('admin invitation settings error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
