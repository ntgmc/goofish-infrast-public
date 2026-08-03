import { authenticateAdminRequest } from './admin-auth'
import {
  getAdminInvitationSettingsOverview,
  saveInvitationSettings,
  validateInvitationSettingsPatch,
  type InvitationSettingsPatch,
} from '../storage/invitation-store'
import { InventoryError } from '../storage/inventory-store'
import { SettingsConflictError } from '../storage/settings-conflict'
import { jsonResponse } from './user-auth'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

export default async function adminInvitationSettingsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req, 'admin_manage')
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') return jsonResponse(await getAdminInvitationSettingsOverview())
    if (req.method !== 'PUT' && req.method !== 'PATCH') return jsonResponse({ error: 'Method not allowed' }, 405)
    let patch: InvitationSettingsPatch
    let expectedRevision: number
    try {
      const body = await getValidatedJson(req, requestSchemas.adminInvitationSettings)
      expectedRevision = body.expected_revision
      const { expected_revision: _expectedRevision, ...patchBody } = body
      patch = validateInvitationSettingsPatch(patchBody)
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '邀请设置无效。' }, 400)
    }
    return jsonResponse({ settings: await saveInvitationSettings(authentication.username, patch, expectedRevision) })
  } catch (error) {
    if (error instanceof SettingsConflictError) {
      return jsonResponse({ error: '配置已被其他管理员更新，请重新加载后再保存。', code: 'settings_conflict' }, 409)
    }
    if (error instanceof InventoryError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('admin invitation settings error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
