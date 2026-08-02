import { jsonResponse, requireUserSession } from './user-auth'
import { issueMeteredScheduleQuote, MeteredBillingQuoteError } from '../storage/metered-billing-store'

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
  try {
    return jsonResponse(await issueMeteredScheduleQuote(auth.user.id, profileId))
  } catch (error) {
    if (error instanceof MeteredBillingQuoteError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    throw error
  }
}
