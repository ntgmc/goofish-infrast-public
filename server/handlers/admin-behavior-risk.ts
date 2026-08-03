import { authenticateAdminRequest, requireRootAdminPassword } from './admin-auth'
import { jsonResponse } from './license-utils'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import {
  BehaviorRiskReviewError,
  listBehaviorRiskCases,
  reviewBehaviorRiskCase,
} from '../storage/behavior-risk-store'

export default async function adminBehaviorRiskHandler(req: Request): Promise<Response> {
  try {
    const capability = req.method === 'POST' ? 'risk_review' : 'risk_view'
    const authentication = await authenticateAdminRequest(req, capability)
    if (!authentication.ok) return authentication.response
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const status = normalizeStatus(url.searchParams.get('status'))
      if (!status) return jsonResponse({ error: '无效的复核状态。' }, 400)
      const page = parsePositiveInteger(url.searchParams.get('page'), 1)
      const pageSize = parsePositiveInteger(url.searchParams.get('page_size'), 25, 100)
      if (page === null || pageSize === null) return jsonResponse({ error: '分页参数必须是有效范围内的正整数。' }, 400)
      return jsonResponse({
        ...await listBehaviorRiskCases({ status, page, pageSize }),
        capabilities: authentication.capabilities,
      })
    }
    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.adminBehaviorRiskReview)
      if (body.outcome === 'restrict') {
        const root = await requireRootAdminPassword(req, body.root_password)
        if (!root.ok) return root.response
      }
      return jsonResponse(await reviewBehaviorRiskCase({
        caseId: body.case_id,
        outcome: body.outcome,
        note: body.note,
        actions: body.members.map((member) => ({
          userId: member.user_id,
          action: member.action,
          profileId: member.profile_id,
        })),
        adminUsername: authentication.username,
      }))
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof BehaviorRiskReviewError) return jsonResponse({ error: error.message }, error.status)
    console.error('admin behavior risk error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function normalizeStatus(value: string | null): 'pending' | 'dismissed' | 'actioned' | 'all' | null {
  if (value === null || value === '') return 'pending'
  return value === 'pending' || value === 'dismissed' || value === 'actioned' || value === 'all' ? value : null
}

function parsePositiveInteger(value: string | null, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null
}
