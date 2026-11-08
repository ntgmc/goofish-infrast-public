import { z } from 'zod'
import { ADMIN_AUDIT_SOURCES } from '../../src/lib/admin-audit-contracts'
import { getAdminOperationAudit, listAdminOperationAudits } from '../storage/admin-operation-audit-store'
import { authenticateAdminRequest } from './admin-auth'
import { AdminPaginationError, parseAdminPageRequest } from './admin-pagination'
import { jsonResponse } from './license-utils'

const filterText = z.string().trim().min(1).max(256).optional()
const querySchema = z.object({
  actor: z.string().trim().min(1).max(32).optional(),
  action: filterText,
  target_type: filterText,
  target_id: filterText,
  request_id: filterText,
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(ADMIN_AUDIT_SOURCES).optional(),
  id: filterText,
  related_source: z.enum(ADMIN_AUDIT_SOURCES).optional(),
  related_id: filterText,
}).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), '开始时间不能晚于结束时间。')
  .refine((value) => Boolean(value.source) === Boolean(value.id), '记录来源和 ID 必须同时提供。')
  .refine((value) => Boolean(value.related_source) === Boolean(value.related_id), '关联记录来源和 ID 必须同时提供。')

export default async function adminOperationAuditHandler(req: Request): Promise<Response> {
  try {
    const authentication = await authenticateAdminRequest(req, 'sensitive_data_view')
    if (!authentication.ok) return authentication.response
    if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) return jsonResponse({ error: '审计筛选参数无效，请检查时间范围和字段长度。' }, 400)
    const { source, id, ...filters } = parsed.data
    const { page, pageSize } = parseAdminPageRequest(url)
    if (source && id) {
      const item = await getAdminOperationAudit(source, id)
      return item ? jsonResponse({ item }) : jsonResponse({ error: '操作审计记录不存在或已超过保留期限。' }, 404)
    }
    return jsonResponse(await listAdminOperationAudits(page, pageSize, filters))
  } catch (error) {
    if (error instanceof AdminPaginationError) return jsonResponse({ error: error.message }, 400)
    console.error('admin operation audit error:', error)
    return jsonResponse({ error: '加载操作审计失败，请稍后重试。' }, 500)
  }
}
