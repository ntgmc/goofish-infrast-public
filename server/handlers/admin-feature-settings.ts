import { computeEffectiveSiteFeatures } from '../../src/lib/site-features'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import {
  getSiteFeatureSettings,
  saveSiteFeatureSettings,
  validateSiteFeatures,
} from '../storage/feature-settings-store'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './user-auth'

export default async function adminFeatureSettingsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') return settingsResponse(await getSiteFeatureSettings())
    if (req.method !== 'PUT') return jsonResponse({ error: 'Method not allowed' }, 405)
    try {
      const body = await getValidatedJson(req, requestSchemas.adminFeatureSettings)
      return settingsResponse(await saveSiteFeatureSettings(validateSiteFeatures(body.features)))
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '功能开关无效。' }, 400)
    }
  } catch (error) {
    console.error('admin feature settings error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function settingsResponse(settings: Awaited<ReturnType<typeof getSiteFeatureSettings>>): Response {
  return jsonResponse({ settings, effective_features: computeEffectiveSiteFeatures(settings) }, 200, {
    'Cache-Control': 'no-store',
  })
}
