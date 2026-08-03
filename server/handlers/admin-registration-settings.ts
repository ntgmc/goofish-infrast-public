import { authenticateAdminRequest } from './admin-auth'
import {
  getRegistrationSettings,
  RegistrationSettingsValidationError,
  saveRegistrationSettings,
  validateRegistrationSettingsPatch,
} from '../storage/registration-settings-store'
import { jsonResponse } from './user-auth'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getBrevoEmailStats } from '../storage/brevo-email-store'
import { refreshBrevoOfficialQuotaIfStale } from '../brevo-quota'

export default async function adminRegistrationSettingsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const authentication = await authenticateAdminRequest(req, 'admin_manage')
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') {
      const settings = await getRegistrationSettings()
      await refreshBrevoOfficialQuotaIfStale(new Date(), true)
      const emailStats = await getBrevoEmailStats()
      return jsonResponse({ settings, email_stats: emailStats })
    }
    if (req.method !== 'PUT') return jsonResponse({ error: 'Method not allowed' }, 405)
    try {
      const patch = validateRegistrationSettingsPatch(await getValidatedJson(req, requestSchemas.adminRegistrationSettings))
      const settings = await saveRegistrationSettings(patch)
      await refreshBrevoOfficialQuotaIfStale()
      return jsonResponse({ settings, email_stats: await getBrevoEmailStats() })
    } catch (error) {
      if (error instanceof RegistrationSettingsValidationError) {
        return jsonResponse({
          error: '注册设置无效。',
          code: error.code,
          issues: error.issues,
        }, 400)
      }
      throw error
    }
  } catch (error) {
    console.error('admin registration settings error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
