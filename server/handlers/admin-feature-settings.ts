import { computeEffectiveSiteFeatures } from '../../src/lib/site-features'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import {
  getSiteFeatureSettings,
  saveSiteFeatureSettings,
} from '../storage/feature-settings-store'
import { SettingsConflictError } from '../storage/settings-conflict'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './user-auth'

export default async function adminFeatureSettingsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  const authentication = await authenticateAdminRequest(req)
  if (!authentication.ok) return authentication.response
  if (req.method === 'GET') return settingsResponse(await getSiteFeatureSettings())
  if (req.method !== 'PUT') return jsonResponse({ error: 'Method not allowed' }, 405)
  const parsed = requestSchemas.adminFeatureSettings.safeParse(
    await getValidatedJson(req, requestSchemas.adminFeatureSettings),
  )
  if (!parsed.success) return invalidSettingsResponse(parsed.error.issues)
  try {
    return settingsResponse(await saveSiteFeatureSettings(parsed.data.features, parsed.data.expected_revision))
  } catch (error) {
    if (error instanceof SettingsConflictError) return settingsConflictResponse()
    throw error
  }
}

function settingsResponse(settings: Awaited<ReturnType<typeof getSiteFeatureSettings>>): Response {
  return jsonResponse({ settings, effective_features: computeEffectiveSiteFeatures(settings) }, 200, {
    'Cache-Control': 'no-store',
  })
}

function invalidSettingsResponse(issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>): Response {
  return jsonResponse({
    error: 'Request body does not match the expected schema.',
    code: 'invalid_request',
    issues: issues.slice(0, 10).map((issue) => ({ path: issue.path.map(String).join('.'), code: issue.code })),
  }, 400)
}

function settingsConflictResponse(): Response {
  return jsonResponse({
    error: '配置已被其他管理员更新，请重新加载后再保存。',
    code: 'settings_conflict',
  }, 409)
}
