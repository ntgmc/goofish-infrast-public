import { getProfileForUser, isDepotValueProfile, isFreePreviewProfile } from '../storage/user-store'
import { getPermissionProfile } from '../../src/lib/product-catalog'
import { jsonResponse, requireUserSession, toPublicUser } from './user-auth'
import { resolveProfileAuthorization } from './profile-authorization'

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const profileId = new URL(req.url).searchParams.get('profile_id')
    if (profileId !== null && (!profileId.trim() || profileId.length > 128)) {
      return jsonResponse({ error: '请先选择游戏账号。', code: 'profile_id_invalid' }, 400)
    }
    const profile = profileId ? await getProfileForUser(auth.user.id, profileId) : auth.activeProfile
    if (!profile) return jsonResponse({ error: '请先兑换或选择 CDK 档案。' }, 404)
    if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案没有 CDK 授权状态。' }, 403)
    const authorization = await resolveProfileAuthorization(profile)
    if (!authorization.ok) return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)
    return jsonResponse({
      user: toPublicUser(auth.user),
      permission: authorization.permission,
      permission_label: isFreePreviewProfile(profile) ? '免费预览' : getPermissionProfile(authorization.permission).label,
      status: authorization.cdkRecord?.status ?? profile.status,
      risk_status: 'ok',
    })
  } catch (error) {
    console.error('user status error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
