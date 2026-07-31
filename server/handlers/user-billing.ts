import { getBalanceSummary } from '../storage/balance-store'
import { getMeteredScheduleQuote, pointsToMinor } from '../../src/lib/metered-billing'
import { getProfileForUser, normalizeProfileKind } from '../storage/user-store'
import { jsonResponse, requireUserSession } from './user-auth'
import { getCommercialLimits } from '../storage/metered-profile-store'

export default async function userBillingHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
  const url = new URL(req.url)
  const profileId = url.searchParams.get('profile_id')?.trim() ?? ''
  if (!profileId || url.searchParams.get('operation') !== 'main_schedule') {
    return jsonResponse({ error: '报价请求必须指定档案和 main_schedule 操作。', code: 'invalid_quote_request' }, 400)
  }
  const profile = await getProfileForUser(auth.user.id, profileId)
  if (!profile) return jsonResponse({ error: '档案不存在。' }, 404)
  const kind = normalizeProfileKind(profile)
  if (kind !== 'metered_personal' && kind !== 'metered_commercial') {
    return jsonResponse({ error: '该档案不是按次计费档案。', code: 'not_metered_profile' }, 409)
  }
  if (profile.archived_at) return jsonResponse({ error: '归档档案不能提交任务。', code: 'profile_archived' }, 409)
  const balance = await getBalanceSummary(auth.user.id)
  if (kind === 'metered_commercial' && !balance.commercial.eligible) {
    return jsonResponse({ error: '商用资格未生效或账户存在待追偿。', code: 'commercial_not_eligible' }, 409)
  }
  if (kind === 'metered_commercial' && (await getCommercialLimits(auth.user.id)).suspended) {
    return jsonResponse({ error: '商用账户已暂停。', code: 'commercial_suspended' }, 409)
  }
  const quote = getMeteredScheduleQuote(kind, balance.lifetime_credited, balance.debt)
  return jsonResponse({
    ...quote,
    available: balance.available,
    sufficient: pointsToMinor(balance.debt) === 0n
      && pointsToMinor(balance.available) >= pointsToMinor(quote.charge),
  })
}
