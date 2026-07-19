import { authenticateAdminRequest } from './admin-auth'
import {
  getRegistrationSettings,
  saveRegistrationSettings,
  validateRegistrationSettingsPatch,
} from '../storage/registration-settings-store'
import { jsonResponse } from './user-auth'

export default async function adminRegistrationSettingsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') return jsonResponse({ settings: await getRegistrationSettings() })
    if (req.method !== 'PUT') return jsonResponse({ error: 'Method not allowed' }, 405)
    try {
      const patch = validateRegistrationSettingsPatch(await req.json())
      return jsonResponse({ settings: await saveRegistrationSettings(patch) })
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '注册设置无效。' }, 400)
    }
  } catch (error) {
    console.error('admin registration settings error:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
}
