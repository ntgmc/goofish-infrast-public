import { randomUUID } from 'node:crypto'
import { adminAiSettingsUpdateSchema } from '../../src/lib/ai-settings'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { AiSettingsValidationError, getAdminAiSettings, saveAdminAiSettings } from '../storage/ai-settings-store'
import { SettingsConflictError } from '../storage/settings-conflict'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './user-auth'

export default async function adminAiSettingsHandler(req: Request): Promise<Response> {
  const auth = await authenticateAdminRequest(req, 'admin_manage')
  if (!auth.ok) return auth.response
  try {
    if (req.method === 'PUT') {
      const update = await getValidatedJson(req, adminAiSettingsUpdateSchema, true)
      await saveAdminAiSettings(update, auth.username, req.headers.get('x-request-id')?.trim() || randomUUID())
    } else if (req.method !== 'GET') return jsonResponse({ error: '方法不允许。' }, 405)
    return jsonResponse(await getAdminAiSettings(), 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof SettingsConflictError) return jsonResponse({ error: '配置已被其他管理员更新，请重新载入后保存。', code: 'settings_conflict' }, 409)
    if (error instanceof AiSettingsValidationError) return jsonResponse({ error: error.message, issues: error.issues }, 400)
    if (error instanceof RequestInputError) return jsonResponse({ error: '请检查 AI 设置中的必填项、数值范围和 API 地址。', code: error.code }, error.status)
    // Neither credential values nor provider error bodies belong in application logs.
    return jsonResponse({ error: 'AI 设置保存或读取失败，请稍后重试。' }, 503)
  }
}
