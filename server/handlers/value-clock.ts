import { requireSiteFeatures } from '../feature-gate'
import { getPublicValueClock } from '../storage/value-clock-store'
import { jsonResponse } from './user-auth'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed.' }, 405)
  const gated = await requireSiteFeatures(['base_value_dashboard'])
  if (gated) return gated
  const view = new URL(req.url).searchParams.get('view')
  if (view === 'gain') return jsonResponse({ error: '此统计视图暂不可用。', code: 'feature_unavailable' }, 404)
  if (view && view !== 'production') return jsonResponse({ error: '此统计视图暂不可用。', code: 'view_invalid' }, 400)
  return jsonResponse(await getPublicValueClock(), 200, { 'Cache-Control': 'no-store' })
}
