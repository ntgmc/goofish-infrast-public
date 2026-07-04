import type { Context } from '@netlify/functions'
import {
  buildAuthPayload,
  clearSessionCookie,
  jsonResponse,
  loginUser,
  logoutRequest,
  registerUser,
  requireUserSession,
} from './user-auth'

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  const pathname = new URL(req.url).pathname

  try {
    if (pathname.endsWith('/register')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { email?: unknown; password?: unknown; cdk?: unknown }
      const registered = await registerUser(body.email, body.password, body.cdk)
      if (!registered.ok) return jsonResponse({ error: registered.message }, registered.status)
      return jsonResponse(await buildAuthPayload(registered.user), 200, { 'Set-Cookie': registered.cookie })
    }

    if (pathname.endsWith('/login')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { email?: unknown; password?: unknown }
      const loggedIn = await loginUser(body.email, body.password)
      if (!loggedIn.ok) return jsonResponse({ error: loggedIn.message }, loggedIn.status)
      return jsonResponse(await buildAuthPayload(loggedIn.user), 200, { 'Set-Cookie': loggedIn.cookie })
    }

    if (pathname.endsWith('/logout')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      await logoutRequest(req)
      return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
    }

    if (pathname.endsWith('/me')) {
      if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
      const auth = await requireUserSession(req)
      if (!auth) return jsonResponse({ user: null, workspace: null })
      return jsonResponse(await buildAuthPayload(auth.user))
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    console.error('auth error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
