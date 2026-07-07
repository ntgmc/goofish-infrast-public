import { getProfileForUser, isDepotValueProfile, isFreePreviewProfile } from '../storage/user-store'
import { getCdkRecordStore } from './license-utils'
import { jsonResponse, requireUserSession, toPublicUser } from './user-auth'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const profileId = new URL(req.url).searchParams.get('profile_id')
    const profile = profileId ? await getProfileForUser(auth.user.id, profileId) : auth.activeProfile
    if (!profile) return jsonResponse({ error: '请先兑换或选择 CDK 档案。' }, 404)
    if (isFreePreviewProfile(profile)) {
      return jsonResponse({
        user: toPublicUser(auth.user),
        permission: profile.permission,
        permission_label: '免费预览',
        status: profile.status,
        risk_status: 'ok',
      })
    }
    if (isDepotValueProfile(profile) || !profile.cdk_key) return jsonResponse({ error: '仓库分析档案没有 CDK 授权状态。' }, 403)
    const cdkRecord = await (await getCdkRecordStore()).get(profile.cdk_key)
    if (profile.status === 'frozen' || cdkRecord?.status === 'frozen') {
      return jsonResponse({ error: cdkRecord?.freeze_reason || '账号授权已冻结，请联系卖家。' }, 403)
    }
    if (profile.status === 'revoked' || cdkRecord?.status === 'revoked') {
      return jsonResponse({ error: '账号授权已撤销，请联系卖家。' }, 403)
    }
    return jsonResponse({
      user: toPublicUser(auth.user),
      permission: profile.permission,
      permission_label: profile.permission,
      status: cdkRecord?.status ?? profile.status,
      risk_status: 'ok',
    })
  } catch (error) {
    console.error('user status error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
