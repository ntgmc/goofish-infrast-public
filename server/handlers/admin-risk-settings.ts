import { randomUUID } from 'node:crypto'
import { authenticateAdminRequest, requireRootAdminPassword } from './admin-auth'
import { getRiskControlSettings, jsonResponse, saveRiskControlSettings } from './license-utils'
import type { RiskControlSettingsPatch } from '../storage/risk-settings-store'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { SettingsConflictError } from '../storage/settings-conflict'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    return handleGet(req)
  }
  if (req.method === 'PUT' || req.method === 'PATCH') {
    return handleSave(req)
  }
  return jsonResponse({ error: 'Method not allowed' }, 405)
}

async function handleGet(req: Request): Promise<Response> {
  try {
    const authentication = await authenticateAdminRequest(req, 'risk_view')
    if (!authentication.ok) return authentication.response
    return jsonResponse({
      settings: {
        ...await getRiskControlSettings(),
        can_configure: authentication.capabilities.includes('risk_config'),
      },
      capabilities: authentication.capabilities,
    })
  } catch (error) {
    console.error('admin risk settings get error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function handleSave(req: Request): Promise<Response> {
  try {
    const authentication = await authenticateAdminRequest(req, 'risk_config')
    if (!authentication.ok) return authentication.response
    const body = await getValidatedJson(req, requestSchemas.adminRiskSettings)

    if (!body.operator_data_risk_enabled) {
      const root = await requireRootAdminPassword(req, body.root_password)
      if (!root.ok) return root.response
    }
    const patch: RiskControlSettingsPatch = { operator_data_risk_enabled: body.operator_data_risk_enabled }
    const requestId = req.headers.get('x-request-id')?.trim() || randomUUID()
    const settings = await saveRiskControlSettings({
      patch,
      expectedRevision: body.expected_revision,
      adminUsername: authentication.username,
      reason: body.reason,
      requestId,
    })
    return jsonResponse({ settings: { ...settings, can_configure: true } })
  } catch (error) {
    if (error instanceof SettingsConflictError) {
      return jsonResponse({
        error: '风控设置已被其他管理员更新，请刷新后重试。',
        settings: { ...await getRiskControlSettings(), can_configure: true },
      }, 409)
    }
    console.error('admin risk settings save error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
