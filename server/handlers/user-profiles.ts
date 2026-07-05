import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  listProfilesForUser,
  saveProfileWorkspace,
  saveUserProfile,
  toPublicProfile,
} from '../storage/user-store'
import { buildAuthPayload, jsonResponse, redeemProfileCdk, requireUserSession, toPublicUser } from './user-auth'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    const pathname = new URL(req.url).pathname

    if (req.method === 'GET') {
      const profiles = await listProfilesForUser(auth.user.id)
      return jsonResponse({
        user: toPublicUser(auth.user),
        profiles: await Promise.all(profiles.map(async (profile) => toPublicProfile(profile, await getProfileWorkspace(profile.id)))),
      })
    }

    if (pathname.endsWith('/redeem')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { cdk?: unknown; display_name?: unknown; note?: unknown }
      const redeemed = await redeemProfileCdk(auth.user, body.cdk, body.display_name, body.note)
      if (!redeemed.ok) return jsonResponse({ error: redeemed.message }, redeemed.status)
      return jsonResponse(await buildAuthPayload(auth.user, redeemed.profile.id))
    }

    if (req.method === 'PATCH') {
      const body = await req.json() as { profile_id?: unknown; display_name?: unknown; note?: unknown }
      if (typeof body.profile_id !== 'string' || !body.profile_id) {
        return jsonResponse({ error: '缺少 profile_id。' }, 400)
      }
      const profile = await getProfileForUser(auth.user.id, body.profile_id)
      if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
      const displayName = normalizeDisplayName(body.display_name)
      const note = normalizeNote(body.note)
      const updated = {
        ...profile,
        display_name: displayName || profile.display_name || '账号',
        note,
        updated_at: new Date().toISOString(),
      }
      await saveUserProfile(updated)
      if (!(await getProfileWorkspace(updated.id))) {
        await saveProfileWorkspace(emptyWorkspace(updated.id))
      }
      return jsonResponse(await buildAuthPayload(auth.user, updated.id))
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('user profiles error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}
