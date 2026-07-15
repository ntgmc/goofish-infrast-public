import {
  buildAuthPayload,
  changeUserPassword,
  clearSessionCookie,
  jsonResponse,
  loginUser,
  normalizeEmail,
  logoutRequest,
  requestPasswordReset,
  registerUser,
  requireUserSession,
  resetPasswordWithToken,
} from './user-auth'
import { recordUsageEvent } from './usage-stats'
import { reserveUserLoginAttempt } from '../security/auth-rate-limit'
import { getRequestClientIp } from '../security/client-ip'
import { PasswordWorkCapacityError } from '../security/password'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  const pathname = new URL(req.url).pathname
  const startedAt = Date.now()

  try {
    if (pathname.endsWith('/register')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { email?: unknown; password?: unknown; cdk?: unknown; invite_code?: unknown }
      const registered = await registerUser(body.email, body.password, body.cdk, req.headers.get('Idempotency-Key'), body.invite_code)
      if (!registered.ok) {
        await recordRegister('failure', startedAt)
        return jsonResponse({ error: registered.message, ...(registered.code && { code: registered.code }) }, registered.status)
      }
      await recordRegister('success', startedAt)
      return jsonResponse(await buildAuthPayload(registered.user), 200, { 'Set-Cookie': registered.cookie })
    }

    if (pathname.endsWith('/login')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await req.json() as { email?: unknown; password?: unknown }
      const rateLimit = reserveUserLoginAttempt(
        getRequestClientIp(req),
        normalizeEmail(body.email) ?? 'invalid',
      )
      if (!rateLimit.allowed) return loginRateLimitResponse(rateLimit.retryAfterSeconds)

      let loggedIn: Awaited<ReturnType<typeof loginUser>>
      try {
        loggedIn = await loginUser(body.email, body.password)
      } catch (error) {
        rateLimit.attempt.refund()
        throw error
      }
      if (!loggedIn.ok) {
        rateLimit.attempt.retainFailure()
        return jsonResponse({ error: loggedIn.message }, loggedIn.status)
      }
      rateLimit.attempt.refund()
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
    if (error instanceof PasswordWorkCapacityError) return passwordCapacityResponse()
    console.error('auth error:', error)
    if (pathname.endsWith('/register')) await recordRegister('failure', startedAt)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

function loginRateLimitResponse(retryAfterSeconds: number): Response {
  return jsonResponse(
    { error: 'Too many login attempts. Try again later.' },
    429,
    rateLimitHeaders(retryAfterSeconds),
  )
}

function passwordCapacityResponse(): Response {
  return jsonResponse(
    { error: 'Authentication service is busy. Try again shortly.' },
    429,
    rateLimitHeaders(1),
  )
}

function rateLimitHeaders(retryAfterSeconds: number): Record<string, string> {
  return {
    'Retry-After': String(retryAfterSeconds),
    'Cache-Control': 'no-store',
    'Access-Control-Expose-Headers': 'Retry-After',
  }
}

async function recordRegister(status: 'success' | 'failure', startedAt: number): Promise<void> {
  try {
    await recordUsageEvent('register', {
      status,
      reason_code: status === 'success' ? 'ok' : 'registration_failed',
      duration_ms: Date.now() - startedAt,
      source: 'auth_register',
    })
  } catch (error) {
    console.warn('usage stats register skipped:', error)
  }
}
