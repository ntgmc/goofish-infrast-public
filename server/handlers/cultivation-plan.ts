import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { CultivationReadError, readCultivationPlan } from '../cultivation/worker-client'
import { requireSiteFeatures } from '../feature-gate'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { decryptSklandCredential } from './skland-client'
import { requireUserSession, jsonResponse } from './user-auth'

export default async function cultivationPlanHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
  const gated = await requireSiteFeatures(['tools', 'skland'])
  if (gated) return gated
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const body = await getValidatedJson(req, requestSchemas.cultivationPlan, true)
    const profile = auth.profiles.find((row) => row.id === body.profile_id)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    if (profile.status !== 'active' || profile.archived_at) return jsonResponse({ error: '当前档案不可用。' }, 403)
    const binding = profile.skland_binding
    if (!binding?.encrypted_cred) return jsonResponse({ error: '请先在档案中绑定森空岛，再导入练度和材料。' }, 400)
    const data = await readCultivationPlan({ credential: decryptSklandCredential(binding.encrypted_cred), uid: binding.uid,
      query: { ...defaultCultivationQuery, ...body.recommendation } }, req.signal)
    return new Response(data, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof RequestInputError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    if (error instanceof CultivationReadError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('cultivation planning data failed:', error instanceof Error ? error.name : 'unknown')
    return jsonResponse({ error: '读取养成数据失败，请稍后重试。' }, 502)
  }
}
