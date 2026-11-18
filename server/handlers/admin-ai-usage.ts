import { z } from 'zod'
import { getAiUsage, listAiUsage } from '../storage/ai-usage-store'
import { authenticateAdminRequest } from './admin-auth'
import { AdminPaginationError, parseAdminPageRequest } from './admin-pagination'
import { jsonResponse } from './license-utils'

const querySchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['pending', 'succeeded', 'failed']).optional(),
  provider: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(128).optional(),
  user_id: z.string().trim().min(1).max(128).optional(),
})

export default async function adminAiUsageHandler(req: Request): Promise<Response> {
  try {
    const auth = await authenticateAdminRequest(req, 'admin_manage')
    if (!auth.ok) return auth.response
    if (req.method !== 'GET') return jsonResponse({ error: '方法不允许。' }, 405)
    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) return jsonResponse({ error: 'AI 记录筛选参数无效。' }, 400)
    const { id, ...filters } = parsed.data
    if (id) {
      const detail = await getAiUsage(id)
      return detail ? jsonResponse(detail) : jsonResponse({ error: 'AI 调用记录不存在。' }, 404)
    }
    const now = Date.now()
    filters.to ??= new Date(now).toISOString()
    filters.from ??= new Date(now - 30 * 86400000).toISOString()
    const span = Date.parse(filters.to) - Date.parse(filters.from)
    if (span < 0 || span > 366 * 86400000) return jsonResponse({ error: '请选择先后顺序正确且不超过 366 天的时间范围。' }, 400)
    const { page, pageSize } = parseAdminPageRequest(url)
    return jsonResponse(await listAiUsage(page, pageSize, filters))
  } catch (error) {
    if (error instanceof AdminPaginationError) return jsonResponse({ error: error.message }, 400)
    console.error('admin AI usage read failed')
    return jsonResponse({ error: '加载 AI 记录失败，请稍后重试。' }, 500)
  }
}
