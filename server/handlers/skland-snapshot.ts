import { requireSiteFeatures } from '../feature-gate'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { getSklandSnapshot, publicSklandSnapshot, requireSklandProfile, SklandSnapshotError } from '../skland-snapshot'
import { requireUserSession, jsonResponse } from './user-auth'

export default async function sklandSnapshotHandler(req: Request): Promise<Response> {
  const refresh = new URL(req.url).pathname.endsWith('/refresh')
  if (req.method !== (refresh ? 'POST' : 'GET')) return jsonResponse({ error: '方法不允许。' }, 405)
  const gated = await requireSiteFeatures(['login', 'profiles', 'skland'])
  if (gated) return gated
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const body = req.method === 'POST' ? await getValidatedJson(req, requestSchemas.sklandSnapshotRefresh, true)
      : { profile_id: new URL(req.url).searchParams.get('profile_id') ?? '', force: false }
    const profile = await requireSklandProfile(auth.user.id, body.profile_id)
    const snapshot = await getSklandSnapshot(profile, ['inventory'], { force: req.method === 'POST' && body.force !== false, wait: req.method === 'POST' })
    return jsonResponse(publicSklandSnapshot(profile.skland_binding!.uid, snapshot), 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof SklandSnapshotError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, { 'Cache-Control': 'no-store' })
    }
    console.warn('skland snapshot failed:', error instanceof Error ? error.name : 'unknown')
    return jsonResponse({ error: '森空岛数据暂不可用，请稍后重试。', code: 'skland_snapshot_failed' }, 503, { 'Cache-Control': 'no-store' })
  }
}
