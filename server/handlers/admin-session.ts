import {
  authenticateAdminRequest,
  loginAdminRequest,
  logoutAdminRequest,
} from './admin-auth'
import { jsonResponse } from './license-utils'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.adminSession)
      const login = await loginAdminRequest(req, body.username, body.password)
      if (!login.ok) return login.response
      return jsonResponse(
        {
          user: {
            username: login.username,
            role: login.role,
            capabilities: login.capabilities,
            authenticated_at: login.authenticated_at,
          },
        },
        200,
        {
          'Set-Cookie': login.cookie,
          'Cache-Control': 'no-store',
        },
      )
    }

    if (req.method === 'GET') {
      const authentication = await authenticateAdminRequest(req)
      if (!authentication.ok) return authentication.response
      return jsonResponse(
        {
          user: {
            username: authentication.username,
            role: authentication.role,
            capabilities: authentication.capabilities,
            authenticated_at: authentication.authenticated_at,
          },
        },
        200,
        { 'Cache-Control': 'no-store' },
      )
    }

    if (req.method === 'DELETE') {
      const logout = await logoutAdminRequest(req)
      if (!logout.ok) return logout.response
      return jsonResponse(
        { ok: true },
        200,
        {
          'Set-Cookie': logout.cookie,
          'Cache-Control': 'no-store',
        },
      )
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, { 'Cache-Control': 'no-store' })
  } catch (error) {
    console.error('admin session error:', error instanceof Error ? error.name : 'UnknownError')
    return jsonResponse(
      { error: 'Internal server error' },
      500,
      { 'Cache-Control': 'no-store' },
    )
  }
}
