import { authenticateAdminRequest } from './admin-auth'
import { getRiskControlSettings, jsonResponse, saveRiskControlSettings } from './license-utils'
import type { RiskControlSettingsPatch } from '../storage/risk-settings-store'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }
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
    const authentication = await authenticateAdminRequest(req)
    if (!authentication.ok) return authentication.response
    return jsonResponse({ settings: await getRiskControlSettings() })
  } catch (error) {
    console.error('admin risk settings get error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handleSave(req: Request): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>
    const authentication = await authenticateAdminRequest(req, body)
    if (!authentication.ok) return authentication.response

    const patch: RiskControlSettingsPatch = {}
    if ('operator_data_risk_enabled' in body) {
      if (typeof body.operator_data_risk_enabled !== 'boolean') {
        return jsonResponse({ error: '干员数据风控开关必须是布尔值。' }, 400)
      }
      patch.operator_data_risk_enabled = body.operator_data_risk_enabled
    }
    if ('device_risk_enabled' in body) {
      if (typeof body.device_risk_enabled !== 'boolean') {
        return jsonResponse({ error: '设备风控开关必须是布尔值。' }, 400)
      }
      patch.device_risk_enabled = body.device_risk_enabled
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ error: '没有需要保存的风控设置。' }, 400)
    }

    const settings = await saveRiskControlSettings(patch)
    return jsonResponse({ settings })
  } catch (error) {
    console.error('admin risk settings save error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
