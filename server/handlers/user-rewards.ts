import { getRewardBalances } from '../storage/invitation-store'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userRewardsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    return jsonResponse({ balances: await getRewardBalances(auth.user.id) })
  } catch (error) {
    console.error('user rewards error:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
}
