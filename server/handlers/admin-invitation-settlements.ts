import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { replayInvitationSettlement } from '../storage/invitation-store'
import { authenticateAdminRequest, requireRootAdminPassword } from './admin-auth'
import { jsonResponse } from './user-auth'

export default async function adminInvitationSettlementsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const authentication = await authenticateAdminRequest(req, {
    capability: 'admin_manage',
    requireRecentLogin: true,
  })
  if (!authentication.ok) return authentication.response
  try {
    const body = await getValidatedJson(req, requestSchemas.adminInvitationSettlement)
    const root = await requireRootAdminPassword(req, body.root_password)
    if (!root.ok) return root.response
    const replayed = await replayInvitationSettlement(
      authentication.username,
      body.invitation_id,
      body.reason,
    )
    if (!replayed) return jsonResponse({ error: '邀请结算不存在或当前状态不可重放。', code: 'settlement_not_replayable' }, 409)
    return jsonResponse({ ok: true, invitation_id: body.invitation_id })
  } catch (error) {
    console.error('admin invitation settlement replay error:', error instanceof Error ? error.name : typeof error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
