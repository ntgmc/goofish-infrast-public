import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { readPrtsSnapshot } from '../cultivation/catalog'
import { buildCultivationData } from '../cultivation/data'
import { getCultivationStatistics } from '../cultivation/references'
import { getSpecialItemCatalog } from '../cultivation/special-items'
import { requireSiteFeatures } from '../feature-gate'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { getYituliuPricing } from './material-value'
import { decryptSklandCredential, SklandClient, SklandClientError } from './skland-client'
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
    let snapshot
    try { snapshot = await readPrtsSnapshot() }
    catch { return jsonResponse({ error: '作业数据暂不可用，请等待管理员导入后重试。', code: 'prts_data_unavailable' }, 503) }
    const client = new SklandClient(decryptSklandCredential(binding.encrypted_cred))
    const [game, inventory, pricing, community, specialCatalog] = await Promise.all([client.getGamePlayerInfo(binding.uid), client.getCultivatePlayer(binding.uid), getYituliuPricing(), getCultivationStatistics(), getSpecialItemCatalog(snapshot.operators)])
    const response = jsonResponse(buildCultivationData(snapshot, game, inventory, pricing, community, specialCatalog, { ...defaultCultivationQuery, ...body.recommendation }))
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    if (error instanceof RequestInputError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    if (error instanceof SklandClientError) return jsonResponse({ error: error.message, code: error.code }, 502)
    console.error('cultivation planning data failed:', error instanceof Error ? error.name : 'unknown')
    return jsonResponse({ error: '读取养成数据失败，请稍后重试。' }, 502)
  }
}
