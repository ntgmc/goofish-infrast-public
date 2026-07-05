import {
  authenticateAdminRequest,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  requireRootAdminPassword,
} from './admin-auth'
import { jsonResponse } from './license-utils'
import {
  deleteSessionsForUser,
  deleteUserAccount,
  getUserByEmail,
  getUserById,
  listProfilesForUser,
  listUserAccounts,
  saveUserAccount,
  type UserAccountRecord,
} from '../storage/user-store'
import { resetUserPasswordByAdmin } from './user-auth'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    if (req.method === 'POST') {
      const body = await req.json() as { root_password?: unknown; username?: unknown; password?: unknown }
      if (!(await requireRootAdminPassword(body.root_password))) {
        return jsonResponse({ error: 'Root 口令错误。' }, 401)
      }
      const created = await createAdminUser(body.username, body.password)
      if (!created.ok) return jsonResponse({ error: created.message }, 400)
      return jsonResponse({
        user: {
          username: created.user.username,
          created_at: created.user.created_at,
          updated_at: created.user.updated_at,
        },
      })
    }

    if (req.method === 'GET') {
      if (!(await authenticateAdminRequest(req))) {
        return jsonResponse({ error: '管理账号或密码错误。' }, 401)
      }
      const appUsers = await Promise.all((await listUserAccounts()).map(async (user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        profile_count: (await listProfilesForUser(user.id)).length,
        created_at: user.created_at,
        updated_at: user.updated_at,
      })))
      return jsonResponse({ users: await listAdminUsers(), app_users: appUsers })
    }

    if (req.method === 'PATCH') {
      const body = await req.json() as {
        admin_user?: unknown
        admin_password?: unknown
        action?: unknown
        user_id?: unknown
        email?: unknown
        confirm_email?: unknown
        new_password?: unknown
      }
      if (!(await authenticateAdminRequest(req, body))) {
        return jsonResponse({ error: '管理账号或密码错误。' }, 401)
      }
      if (
        body.action !== 'reset_password'
        && body.action !== 'freeze_account'
        && body.action !== 'unfreeze_account'
        && body.action !== 'delete_account'
      ) {
        return jsonResponse({ error: '未知操作。' }, 400)
      }
      const target = await findTargetUser(body)
      if (!target) return jsonResponse({ error: '用户不存在。' }, 404)

      if (body.action === 'reset_password') {
        const reset = await resetUserPasswordByAdmin(target, body.new_password)
        if (!reset.ok) return jsonResponse({ error: reset.message }, 400)
        return jsonResponse({ ok: true, user: toAdminAppUser(reset.user) })
      }

      if (body.action === 'freeze_account' || body.action === 'unfreeze_account') {
        const status = body.action === 'freeze_account' ? 'frozen' : 'active'
        const updated = await setUserStatus(target, status)
        if (status !== 'active') await deleteSessionsForUser(target.id)
        return jsonResponse({ ok: true, user: toAdminAppUser(updated) })
      }

      if (body.action === 'delete_account') {
        const confirmedEmail = typeof body.confirm_email === 'string'
          ? body.confirm_email.trim().toLowerCase()
          : ''
        if (confirmedEmail !== target.email) {
          return jsonResponse({ error: '确认邮箱不匹配。' }, 400)
        }
        await deleteUserAccount(target.id)
        return jsonResponse({ ok: true, deleted: true, user: { id: target.id, email: target.email } })
      }

      return jsonResponse({ error: '未知操作。' }, 400)
    }

    if (req.method === 'DELETE') {
      const body = await req.json() as { root_password?: unknown; username?: unknown }
      if (!(await requireRootAdminPassword(body.root_password))) {
        return jsonResponse({ error: 'Root 口令错误。' }, 401)
      }
      const deleted = await deleteAdminUser(body.username)
      if (!deleted.ok) return jsonResponse({ error: deleted.message }, 400)
      return jsonResponse({ deleted: true })
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('admin users error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function findTargetUser(body: { user_id?: unknown; email?: unknown }): Promise<UserAccountRecord | null> {
  if (typeof body.user_id === 'string' && body.user_id) return getUserById(body.user_id)
  if (typeof body.email === 'string' && body.email.trim()) {
    return getUserByEmail(body.email.trim().toLowerCase())
  }
  return null
}

async function setUserStatus(
  user: UserAccountRecord,
  status: UserAccountRecord['status'],
): Promise<UserAccountRecord> {
  const updated: UserAccountRecord = {
    ...user,
    status,
    updated_at: new Date().toISOString(),
  }
  await saveUserAccount(updated)
  return updated
}

function toAdminAppUser(user: UserAccountRecord) {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    updated_at: user.updated_at,
  }
}
