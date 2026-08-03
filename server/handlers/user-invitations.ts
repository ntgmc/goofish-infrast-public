import { ensureInvitationCode, getInvitationSummary, InvitationCodeError, manageInvitationCode } from '../storage/invitation-store'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userInvitationsHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    if (new URL(req.url).pathname.endsWith('/code')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await getValidatedJson(req, requestSchemas.userInvitationCode)
      if (!['ensure', 'rotate', 'pause', 'resume'].includes(body.action)) {
        return jsonResponse({ error: '邀请码操作无效。' }, 400)
      }
      const result = body.action === 'ensure'
        ? { code: await ensureInvitationCode(auth.user.id), status: 'active' as const }
        : await manageInvitationCode(auth.user.id, body.action)
      return jsonResponse({
        ...result,
        share_url: result.status === 'active' ? `/tool/profiles?invite=${encodeURIComponent(result.code)}` : null,
      })
    }
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    const url = new URL(req.url)
    const rawLimit = url.searchParams.get('limit')
    const limit = rawLimit === null ? undefined : Number(rawLimit)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
      return jsonResponse({ error: '邀请记录数量必须是 1 到 50 之间的整数。', code: 'invalid_limit' }, 400)
    }
    return jsonResponse(await getInvitationSummary(auth.user.id, {
      cursor: url.searchParams.get('cursor'),
      limit,
    }))
  } catch (error) {
    if (error instanceof InvitationCodeError) return jsonResponse({ error: error.message, code: error.code }, 400)
    console.error('user invitations error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
