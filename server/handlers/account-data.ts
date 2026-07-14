import { cancelAccountDeletion, requestAccountDeletion } from '../account-data-lifecycle'
import { getDepotValueSampleStore } from '../storage/depot-value-sample-store'
import { getProfileForUser, getProfileWorkspace, getUserById, listProfilesForUser, saveUserProfile } from '../storage/user-store'
import { query } from '../storage/postgres'
import { clearSessionCookie, jsonResponse, normalizeEmail, requireUserSession, type AuthContext } from './user-auth'
import { verifyPasswordHash } from '../security/password'

export default async function accountDataHandler(req: Request): Promise<Response> {
  const pathname = new URL(req.url).pathname
  if (pathname.endsWith('/cancel')) return handleCancellation(req)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
  if (pathname.endsWith('/export')) return exportData(auth.user.id)
  if (pathname.endsWith('/delete-request')) return requestDeletion(req, auth)
  if (pathname.endsWith('/credential/clear')) return clearCredential(req, auth.user.id)
  if (pathname.endsWith('/skland/unlink')) return unlinkSkland(req, auth.user.id)
  if (pathname.endsWith('/depot-sample/revoke')) return revokeDepotSample(req, auth.user.id)
  return jsonResponse({ error: 'API route not found' }, 404)
}

async function exportData(userId: string): Promise<Response> {
  const profiles = await listProfilesForUser(userId)
  const profileIds = profiles.map((profile) => profile.id)
  const [user, workspaces, usage, jobs, samples, deletion] = await Promise.all([
    getUserById(userId),
    Promise.all(profiles.map((profile) => getProfileWorkspace(profile.id))),
    query<{ record_json: unknown }>('select record_json from usage_events where user_id = $1 or profile_id = any($2)', [userId, profileIds]),
    query<{ id: string; status: string; source: string; result_json: unknown; created_at: string; updated_at: string }>('select id, status, source, result_json, created_at, updated_at from optimize_jobs where profile_id = any($1)', [profileIds]),
    query<{ sample_json: unknown; sampled_at: string }>('select sample_json, sampled_at from depot_value_samples where contributor_profile_id = any($1)', [profileIds]),
    query<{ scheduled_for: string; created_at: string }>('select scheduled_for, created_at from account_deletion_requests where user_id = $1', [userId]),
  ])
  const safeProfiles = profiles.map((profile) => {
    const { skland_binding, skland_pending_binding, ...rest } = profile
    return {
      ...rest,
      skland_binding: skland_binding ? { ...skland_binding, encrypted_cred: undefined } : null,
      skland_pending_binding: skland_pending_binding ? { ...skland_pending_binding, encrypted_cred: undefined } : null,
    }
  })
  const publicUser = user ? { id: user.id, email: user.email, permission: user.permission, status: user.status, created_at: user.created_at, updated_at: user.updated_at } : null
  return new Response(JSON.stringify({ version: 1, exported_at: new Date().toISOString(), user: publicUser, profiles: safeProfiles, workspaces, usage_events: usage.rows.map((row) => row.record_json), optimize_jobs: jobs.rows, depot_samples: samples.rows, deletion_request: deletion.rows[0] ?? null }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="maa-personal-data.json"', 'Cache-Control': 'no-store' },
  })
}

async function requestDeletion(req: Request, auth: AuthContext) {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await req.json() as { email?: unknown; password?: unknown }
  if (normalizeEmail(body.email) !== auth.user.email || typeof body.password !== 'string' || !(await verifyPasswordHash(body.password, auth.user)).verified) {
    return jsonResponse({ error: '邮箱或当前密码不正确。' }, 400)
  }
  const request = await requestAccountDeletion(auth.user)
  return jsonResponse({ ok: true, scheduled_for: request.scheduledFor }, 202, { 'Set-Cookie': clearSessionCookie() })
}

async function clearCredential(req: Request, userId: string): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await req.json() as { profile_id?: unknown }
  const profile = typeof body.profile_id === 'string' ? await getProfileForUser(userId, body.profile_id) : null
  if (!profile?.skland_binding) return jsonResponse({ error: '森空岛绑定不存在。' }, 404)
  await saveUserProfile({ ...profile, skland_binding: { ...profile.skland_binding, encrypted_cred: '', credential_status: 'invalid', credential_invalid_at: new Date().toISOString() }, updated_at: new Date().toISOString() })
  return jsonResponse({ ok: true })
}

async function unlinkSkland(req: Request, userId: string): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await req.json() as { profile_id?: unknown }
  const profile = typeof body.profile_id === 'string' ? await getProfileForUser(userId, body.profile_id) : null
  if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
  await saveUserProfile({ ...profile, skland_binding: null, skland_pending_binding: null, updated_at: new Date().toISOString() })
  return jsonResponse({ ok: true })
}

async function revokeDepotSample(req: Request, userId: string): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await req.json() as { profile_id?: unknown }
  const profile = typeof body.profile_id === 'string' ? await getProfileForUser(userId, body.profile_id) : null
  if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
  const store = getDepotValueSampleStore()
  if (!store) return jsonResponse({ error: '样本库不可用。' }, 503)
  await store.deleteForProfile(profile.id)
  return jsonResponse({ ok: true })
}

async function handleCancellation(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await req.json() as { token?: unknown }
  if (typeof body.token !== 'string' || !(await cancelAccountDeletion(body.token))) return jsonResponse({ error: '注销撤销链接无效或已过期。' }, 400)
  return jsonResponse({ ok: true })
}
