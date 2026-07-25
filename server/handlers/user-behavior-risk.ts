import { recordAuthenticatedRequestBehaviorEvent } from '../behavior-risk/service'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userBehaviorRiskHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ ok: true }, 204)
  const body = await getValidatedJson(req, requestSchemas.behaviorRiskEngagement)
  await recordAuthenticatedRequestBehaviorEvent({
    req,
    auth,
    eventType: 'page_view',
    pageCategory: body.page_category,
  })
  return jsonResponse({ ok: true }, 204)
}
