import { z } from 'zod'
import { requireSiteFeatures } from '../feature-gate'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { getProfileForUser } from '../storage/user-store'
import { activatePersonalValueClock, readPersonalValueClock, verifyPersonalValueClock } from '../storage/value-clock-comparison-store'
import { ValueClockComparisonError } from '../value-clock-comparison'
import { ValueClockError } from '../value-clock-production'
import { resolveProfileAuthorization } from './profile-authorization'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET' || req.method === 'POST') return jsonResponse({ error: '此功能暂不可用。', code: 'feature_unavailable' }, 404)
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
  const gated = await requireSiteFeatures(['base_value_dashboard'])
  if (gated) return gated
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
  try {
    const input = req.method === 'POST' ? await getValidatedJson(req, requestSchemas.valueClockComparison, true) : null
    const profileId = input?.profile_id ?? z.string().trim().min(1).max(128).parse(new URL(req.url).searchParams.get('profile_id'))
    const profile = await getProfileForUser(auth.user.id, profileId)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    const authorization = await resolveProfileAuthorization(profile)
    if (!authorization.ok) return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)
    const value = !input ? await readPersonalValueClock(profileId)
      : input.action === 'activate' ? await activatePersonalValueClock(input)
        : await verifyPersonalValueClock(input, profile.skland_binding?.last_imported_at ?? null)
    return jsonResponse(value, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ValueClockComparisonError) return jsonResponse({ error: error.message, code: error.code }, 409)
    if (error instanceof ValueClockError) return jsonResponse({ error: '排班的心情、容量或库存条件不足，请修正原安排后重新核算。', code: 'comparison_reassessment_required' }, 409)
    if (error instanceof RequestInputError || error instanceof z.ZodError) return jsonResponse({ error: '比较请求无效，请重新选择排班。', code: 'validation_failed' }, 400)
    return jsonResponse({ error: '暂时无法读取原排班设置，请稍后重试。' }, 503)
  }
}
