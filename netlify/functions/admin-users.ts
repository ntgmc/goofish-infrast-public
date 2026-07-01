import type { Context } from '@netlify/functions'
import { authenticateAdminRequest, createAdminUser, deleteAdminUser, listAdminUsers, requireRootAdminPassword } from './admin-auth'
import { jsonResponse } from './license-utils'

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
      return jsonResponse({ users: await listAdminUsers() })
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
