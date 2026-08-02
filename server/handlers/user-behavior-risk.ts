import { ensureBehaviorRiskDeviceCookie, recordAuthenticatedRequestBehaviorEvent } from '../behavior-risk/service'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userBehaviorRiskHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ ok: true }, 204)
  const body = await getValidatedJson(req, requestSchemas.behaviorRiskEngagement)
  const bucket = Math.floor(Date.now() / (5 * 60_000))
  await recordAuthenticatedRequestBehaviorEvent({
    req,
    auth,
    eventType: 'page_view',
    pageCategory: body.page_category,
    eventKey: `page-view:${auth.user.id}:${auth.tokenHash}:${body.page_category}:${bucket}`,
  })
  const deviceCookie = ensureBehaviorRiskDeviceCookie(req)
  return jsonResponse({ ok: true }, 204, deviceCookie ? { 'Set-Cookie': deviceCookie } : undefined)
}
