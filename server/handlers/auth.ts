import {
  buildAuthPayload,
  changeUserPassword,
  clearSessionCookie,
  jsonResponse,
  loginUser,
  logoutRequest,
  requestPasswordReset,
  registerUser,
  requireUserSession,
  resetPasswordWithToken,
} from './user-auth'

export default async (req: Request): Promise<Response> => {
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

    if (pathname.endsWith('/forgot-password')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { email?: unknown }
      return jsonResponse(await requestPasswordReset(body.email))
    }

    if (pathname.endsWith('/reset-password')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { token?: unknown; new_password?: unknown }
      const reset = await resetPasswordWithToken(body.token, body.new_password)
      if (!reset.ok) return jsonResponse({ error: reset.message }, reset.status)
      return jsonResponse({ ok: true })
    }

    if (pathname.endsWith('/change-password')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const auth = await requireUserSession(req)
      if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
      const body = await req.json() as { old_password?: unknown; new_password?: unknown }
      const changed = await changeUserPassword(auth.user, body.old_password, body.new_password, auth.tokenHash)
      if (!changed.ok) return jsonResponse({ error: changed.message }, changed.status)
      return jsonResponse(await buildAuthPayload(changed.user))
    }

    if (pathname.endsWith('/me')) {
      if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
      const auth = await requireUserSession(req)
      if (!auth) return jsonResponse({ user: null, profiles: [], active_profile: null, workspace: null, announcement_unread_count: 0 })
      return jsonResponse(await buildAuthPayload(auth.user))
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    console.error('auth error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}
