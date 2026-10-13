import { randomUUID } from 'node:crypto'
import { feedbackCopy as text } from '../../src/copy/zh-CN/feedback'
import { updateFeedback, FeedbackError } from '../storage/feedback-store'
import { getRequestClientIp } from '../security/client-ip'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError, validateAndStoreJsonBody } from '../security/request-validation'
import { authenticateAdminRequest } from './admin-auth'
import { AdminPaginationError } from './admin-pagination'
import { readFeedback } from './feedback-read'
import { jsonResponse } from './license-utils'

export default async function adminFeedbackHandler(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req, req.method === 'PATCH' ? 'user_manage' : 'user_view')
  if (!authentication.ok) return authentication.response
  if (!['GET', 'PATCH'].includes(req.method)) return respond({ error: 'Method not allowed' }, 405)
  try {
    if (req.method === 'GET') return await readFeedback(req, null)
    await validateAndStoreJsonBody(req, requestSchemas.adminFeedbackUpdate, 'standard')
    const body = await getValidatedJson(req, requestSchemas.adminFeedbackUpdate, true)
    await updateFeedback(body, {
      username: authentication.username,
      audit: {
        actorUsername: authentication.username, action: 'feedback.follow_up', targetType: 'feedback', targetId: body.feedback_id,
        reason: body.reason, requestId: req.headers.get('x-request-id')?.trim() || randomUUID(), clientIp: getRequestClientIp(req),
      },
    })
    return respond({ id: body.feedback_id })
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof FeedbackError) return respond({ error: error.message, code: error.code }, error.status)
    if (error instanceof AdminPaginationError) return respond({ error: error.message }, 400)
    console.error('admin feedback error:', error instanceof Error ? error.name : 'UnknownError')
    return respond({ error: req.method === 'GET' ? text.loadFailed : text.saveFailed }, 500)
  }
}

function respond(body: unknown, status = 200): Response {
  return jsonResponse(body, status, { 'Cache-Control': 'no-store' })
}
