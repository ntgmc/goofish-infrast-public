import { ensureInvitationCode, getInvitationSummary, InvitationCodeError } from '../storage/invitation-store'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userInvitationsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    if (new URL(req.url).pathname.endsWith('/code')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const code = await ensureInvitationCode(auth.user.id)
      return jsonResponse({ code, share_url: `/tool/profiles?invite=${encodeURIComponent(code)}` })
    }
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    return jsonResponse(await getInvitationSummary(auth.user.id))
  } catch (error) {
    if (error instanceof InvitationCodeError) return jsonResponse({ error: error.message, code: error.code }, 400)
    console.error('user invitations error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
