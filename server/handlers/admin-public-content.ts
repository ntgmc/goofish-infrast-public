import { parsePublicContentDraft } from '../../src/lib/public-content'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getPublicContentSettings, savePublicContentSettings } from '../storage/public-content-settings-store'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './user-auth'

export default async function adminPublicContentHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') return settingsResponse(await getPublicContentSettings())
    if (req.method !== 'PUT') return jsonResponse({ error: 'Method not allowed' }, 405)
    try {
      const body = await getValidatedJson(req, requestSchemas.adminPublicContent)
      return settingsResponse(await savePublicContentSettings(parsePublicContentDraft(body)))
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid public content.' }, 400)
    }
  } catch (error) {
    console.error('admin public content error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function settingsResponse(settings: Awaited<ReturnType<typeof getPublicContentSettings>>): Response {
  return jsonResponse({ settings }, 200, { 'Cache-Control': 'no-store' })
}
