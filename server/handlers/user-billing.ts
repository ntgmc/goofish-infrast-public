import { jsonResponse, requireUserSession } from './user-auth'
import { issueMeteredScheduleQuote, MeteredBillingQuoteError } from '../storage/metered-billing-store'
import type { MeteredBillingOperation } from '../../src/lib/metered-billing'

export default async function userBillingHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
  const url = new URL(req.url)
  const profileId = url.searchParams.get('profile_id')?.trim() ?? ''
  const operation = url.searchParams.get('operation') as MeteredBillingOperation | null
  if (!profileId || !operation || !['main_schedule', 'incremental_recompute', 'scenario_comparison'].includes(operation)) {
    return jsonResponse({ error: '报价请求必须指定档案和有效操作。', code: 'invalid_quote_request' }, 400)
  }
  try {
    return jsonResponse(await issueMeteredScheduleQuote(auth.user.id, profileId, operation))
  } catch (error) {
    if (error instanceof MeteredBillingQuoteError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    throw error
  }
}
