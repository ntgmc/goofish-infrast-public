import { requireSiteFeatures } from '../feature-gate'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { getSklandSnapshot, publicSklandSnapshot, requireSklandProfile, SklandSnapshotError } from '../skland-snapshot'
import { requireUserSession, jsonResponse } from './user-auth'
import { decryptSklandCredential, SklandClient } from './skland-client'
import { readSklandItemNames } from './skland-game'

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
    const snapshot = await getSklandSnapshot(profile, [], { force: req.method === 'POST' && body.force !== false, wait: req.method === 'POST' })
    const result = publicSklandSnapshot(profile.skland_binding!.uid, snapshot)
    if (result.inventory.items) {
      try {
        const metadata = await new SklandClient(decryptSklandCredential(profile.skland_binding!.encrypted_cred)).getCultivateInfo()
        const names = readSklandItemNames(metadata)
        result.inventory.itemNames = Object.fromEntries(Object.keys(result.inventory.items).map((id) => [id, names[id] ?? id]))
      } catch { /* Inventory quantities remain usable when public item definitions are unavailable. */ }
    }
    const currentProfile = await requireSklandProfile(auth.user.id, body.profile_id)
    if (currentProfile.skland_binding!.uid !== profile.skland_binding!.uid || currentProfile.skland_binding!.encrypted_cred !== profile.skland_binding!.encrypted_cred) {
      throw new SklandSnapshotError('森空岛授权已变更，请重新读取当前账号。', 409, 'skland_binding_changed')
    }
    return jsonResponse(result, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof SklandSnapshotError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, { 'Cache-Control': 'no-store' })
    }
    console.warn('skland snapshot failed:', error instanceof Error ? error.name : 'unknown')
    return jsonResponse({ error: '森空岛数据暂不可用，请稍后重试。', code: 'skland_snapshot_failed' }, 503, { 'Cache-Control': 'no-store' })
  }
}
