import { computeEffectiveSiteFeatures } from '../../src/lib/site-features'
import { getSiteFeatureSettings } from '../storage/feature-settings-store'
import { jsonResponse } from './user-auth'

export default async function siteFeaturesHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    const settings = await getSiteFeatureSettings()
    return jsonResponse({
      version: settings.version,
      features: computeEffectiveSiteFeatures(settings),
      updated_at: settings.updated_at,
    }, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    console.error('site feature settings error:', error)
    return jsonResponse({ error: '功能状态暂时无法获取。', code: 'feature_settings_unavailable' }, 503, {
      'Cache-Control': 'no-store',
    })
  }
}
