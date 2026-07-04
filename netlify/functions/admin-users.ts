import type { Context } from '@netlify/functions'
import {
  authenticateAdminRequest,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  requireRootAdminPassword,
} from './admin-auth'
import { jsonResponse } from './license-utils'
import { getUserByEmail, getUserById, listProfilesForUser, listUserAccounts } from '../../server/storage/user-store'
import { resetUserPasswordByAdmin } from './user-auth'

export default async (req: Request, _context: Context): Promise<Response> => {
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
        new_password?: unknown
      }
      if (!(await authenticateAdminRequest(req, body))) {
        return jsonResponse({ error: '管理账号或密码错误。' }, 401)
      }
      if (body.action !== 'reset_password') return jsonResponse({ error: '未知操作。' }, 400)
      const target = typeof body.user_id === 'string' && body.user_id
        ? await getUserById(body.user_id)
        : typeof body.email === 'string' && body.email
          ? await getUserByEmail(body.email.trim().toLowerCase())
          : null
      if (!target) return jsonResponse({ error: '用户不存在。' }, 404)
      const reset = await resetUserPasswordByAdmin(target, body.new_password)
      if (!reset.ok) return jsonResponse({ error: reset.message }, 400)
      return jsonResponse({ ok: true, user: { id: reset.user.id, email: reset.user.email, updated_at: reset.user.updated_at } })
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
