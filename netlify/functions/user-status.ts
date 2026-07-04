import type { Context } from '@netlify/functions'
import { jsonResponse, requireUserSession, toPublicUser } from './user-auth'

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    if (auth.cdkRecord?.status === 'frozen') {
      return jsonResponse({ error: auth.cdkRecord.freeze_reason || '账号授权已冻结，请联系卖家。' }, 403)
    }
    if (auth.cdkRecord?.status === 'revoked') {
      return jsonResponse({ error: '账号授权已撤销，请联系卖家。' }, 403)
    }
    return jsonResponse({
      user: toPublicUser(auth.user),
      permission: auth.user.permission,
      permission_label: auth.user.permission,
      status: auth.cdkRecord?.status ?? auth.user.status,
      risk_status: 'ok',
    })
  } catch (error) {
    console.error('user status error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
