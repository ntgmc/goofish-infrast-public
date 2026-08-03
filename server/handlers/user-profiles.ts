import {
  emptyWorkspace,
  getOrCreateDepotValueProfile,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  listProfileWorkspaces,
  listProfilesForUser,
  saveProfileWorkspace,
  toPublicProfile,
  updateUserProfileMetadata,
} from '../storage/user-store'
import {
  buildAuthPayload,
  createOrReusePreviewProfile,
  jsonResponse,
  redeemProfileCdk,
  requireUserSession,
  toPublicUser,
  upgradePreviewProfileWithCdk,
} from './user-auth'
import { getFreePreviewTrial } from '../free-preview-trial'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

export default async (req: Request): Promise<Response> => {

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    const pathname = new URL(req.url).pathname

    if (pathname.endsWith('/depot-value')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const profile = await getOrCreateDepotValueProfile(auth.user)
      return jsonResponse({
        ...(await buildAuthPayload(auth.user, profile.id)),
        depot_profile: toPublicProfile(profile, null),
      })
    }

    if (pathname.endsWith('/preview')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await getValidatedJson(req, requestSchemas.profilePreview)
      const preview = await createOrReusePreviewProfile(auth.user, body.display_name, body.note)
      if (!preview.ok) return jsonResponse({ error: preview.message }, preview.status)
      return jsonResponse(await buildAuthPayload(auth.user, preview.profile.id))
    }

    if (req.method === 'GET') {
      const profiles = (await listProfilesForUser(auth.user.id)).filter((profile) => profile.kind !== 'metered_commercial')
      const workspaces = await listProfileWorkspaces(profiles.map((profile) => profile.id))
      return jsonResponse({
        user: toPublicUser(auth.user),
        profiles: profiles.map((profile) => (
          toPublicProfile(profile, workspaces.get(profile.id) ?? null, getFreePreviewTrial(profile))
        )),
      })
    }

    if (pathname.endsWith('/redeem')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await getValidatedJson(req, requestSchemas.profileRedeem)
      const redeemed = typeof body.profile_id === 'string' && body.profile_id.trim()
        ? await upgradePreviewProfileWithCdk(auth.user, body.profile_id, body.cdk, body.display_name, body.note, req.headers.get('Idempotency-Key'))
        : await redeemProfileCdk(auth.user, body.cdk, body.display_name, body.note, req.headers.get('Idempotency-Key'))
      if (!redeemed.ok) return jsonResponse({ error: redeemed.message }, redeemed.status)
      return jsonResponse(await buildAuthPayload(auth.user, redeemed.profile.id))
    }

    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.profilePatch)
      if (typeof body.profile_id !== 'string' || !body.profile_id) {
        return jsonResponse({ error: '缺少 profile_id。' }, 400)
      }
      const profile = await getProfileForUser(auth.user.id, body.profile_id)
      if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
      if (profile.archived_at) return jsonResponse({ error: '归档档案只能通过商用档案管理页恢复后修改。', code: 'profile_archived' }, 409)
      const metadataPatch: { displayName?: string; note?: string } = {}
      if (body.display_name !== undefined) {
        metadataPatch.displayName = normalizeDisplayName(body.display_name) || profile.display_name || '账号'
      }
      if (body.note !== undefined) metadataPatch.note = normalizeNote(body.note)
      if (metadataPatch.displayName === undefined && metadataPatch.note === undefined) {
        return jsonResponse({ error: '请至少提交一个需要修改的档案字段。' }, 400)
      }
      const updated = await updateUserProfileMetadata(auth.user.id, profile.id, metadataPatch)
      if (!updated) return jsonResponse({ error: '账号档案不存在。' }, 404)
      if (!isDepotValueProfile(updated) && !(await getProfileWorkspace(updated.id))) {
        await saveProfileWorkspace(emptyWorkspace(updated.id))
      }
      return jsonResponse(await buildAuthPayload(auth.user, updated.id))
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('user profiles error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}
