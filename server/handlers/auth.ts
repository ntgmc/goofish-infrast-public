import {
  buildAuthPayload,
  changeUserPassword,
  clearSessionCookie,
  jsonResponse,
  loginUser,
  normalizeEmail,
  logoutRequest,
  requestPasswordReset,
  resendEmailVerification,
  registerUser,
  requireUserSession,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from './user-auth'
import { recordUsageEvent } from './usage-stats'
import {
  reservePasswordChangeAttemptLayered,
  reserveRecoveryAttemptLayered,
  reserveRegistrationAttemptLayered,
  reserveTokenAttemptLayered,
  reserveUserLoginAttemptLayered,
} from '../security/layered-auth-rate-limit'
import { getRequestClientIp } from '../security/client-ip'
import { PasswordWorkCapacityError } from '../security/password'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { RateLimitStoreError } from '../security/persistent-rate-limit'
import { authCopy } from '../../src/copy/zh-CN/auth'

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  const pathname = new URL(req.url).pathname
  const startedAt = Date.now()

  try {
    if (pathname.endsWith('/register')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const body = await getValidatedJson(req, requestSchemas.authRegister)
      const registrationLimit = await reserveRegistrationAttemptLayered(
        getRequestClientIp(req),
        normalizeEmail(body.email) ?? 'invalid',
      )
      if (!registrationLimit.allowed) return loginRateLimitResponse(registrationLimit.retryAfterSeconds)
      registrationLimit.attempt.retainFailure()
      const registered = await registerUser(body.email, body.password, body.cdk, req.headers.get('Idempotency-Key'), body.invite_code)
      if (!registered.ok && registered.code === 'registration_accepted') {
        await recordRegister('success', startedAt)
        return registrationAcceptedResponse()
      }
      if (!registered.ok) {
        await recordRegister('failure', startedAt)
        return jsonResponse({ error: registered.message, ...(registered.code && { code: registered.code }) }, registered.status)
      }
      await recordRegister('success', startedAt)
      return registrationAcceptedResponse()
    }

    if (pathname.endsWith('/login')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const body = await getValidatedJson(req, requestSchemas.authLogin)
      const rateLimit = await reserveUserLoginAttemptLayered(
        getRequestClientIp(req),
        normalizeEmail(body.email) ?? 'invalid',
      )
      if (!rateLimit.allowed) return loginRateLimitResponse(rateLimit.retryAfterSeconds)

      let loggedIn: Awaited<ReturnType<typeof loginUser>>
      try {
        loggedIn = await loginUser(body.email, body.password)
      } catch (error) {
        await rateLimit.attempt.refund()
        throw error
      }
      if (!loggedIn.ok) {
        rateLimit.attempt.retainFailure()
        return jsonResponse({ error: loggedIn.message, ...(loggedIn.code && { code: loggedIn.code }) }, loggedIn.status)
      }
      await rateLimit.attempt.refund()
      return jsonResponse(await buildAuthPayload(loggedIn.user), 200, { 'Set-Cookie': loggedIn.cookie })
    }

    if (pathname.endsWith('/logout')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      await logoutRequest(req)
      return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
    }

    if (pathname.endsWith('/forgot-password')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const body = await getValidatedJson(req, requestSchemas.authEmail)
      const recoveryLimit = await reserveRecoveryAttemptLayered(
        getRequestClientIp(req),
        normalizeEmail(body.email) ?? 'invalid',
      )
      if (!recoveryLimit.allowed) return loginRateLimitResponse(recoveryLimit.retryAfterSeconds)
      recoveryLimit.attempt.retainFailure()
      await requestPasswordReset(body.email)
      return recoveryAcceptedResponse()
    }

    if (pathname.endsWith('/reset-password')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const body = await getValidatedJson(req, requestSchemas.authReset)
      const tokenLimit = await reserveTokenAttemptLayered(getRequestClientIp(req), body.token, 'password-reset-token')
      if (!tokenLimit.allowed) return loginRateLimitResponse(tokenLimit.retryAfterSeconds)
      const reset = await resetPasswordWithToken(body.token, body.new_password)
      if (!reset.ok) {
        tokenLimit.attempt.retainFailure()
        return jsonResponse({ error: reset.message }, reset.status)
      }
      await tokenLimit.attempt.refund()
      return jsonResponse({ ok: true })
    }

    if (pathname.endsWith('/verify-email')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const body = await getValidatedJson(req, requestSchemas.authToken)
      const tokenLimit = await reserveTokenAttemptLayered(getRequestClientIp(req), body.token, 'email-verification-token')
      if (!tokenLimit.allowed) return loginRateLimitResponse(tokenLimit.retryAfterSeconds)
      const verified = await verifyEmailWithToken(body.token)
      if (!verified.ok) {
        tokenLimit.attempt.retainFailure()
        return jsonResponse({ error: verified.message }, verified.status)
      }
      await tokenLimit.attempt.refund()
      return jsonResponse(await buildAuthPayload(verified.user), 200, { 'Set-Cookie': verified.cookie })
    }

    if (pathname.endsWith('/resend-verification')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const body = await getValidatedJson(req, requestSchemas.authEmail)
      const recoveryLimit = await reserveRecoveryAttemptLayered(
        getRequestClientIp(req),
        normalizeEmail(body.email) ?? 'invalid',
      )
      if (!recoveryLimit.allowed) return loginRateLimitResponse(recoveryLimit.retryAfterSeconds)
      recoveryLimit.attempt.retainFailure()
      try {
        await resendEmailVerification(body.email)
        return recoveryAcceptedResponse()
      } catch {
        return jsonResponse({ error: authCopy.api_verification_email_send_failed, code: 'verification_email_send_failed' }, 503)
      }
    }

    if (pathname.endsWith('/change-password')) {
      if (req.method !== 'POST') return methodNotAllowedResponse()
      const auth = await requireUserSession(req)
      if (!auth) return jsonResponse({ error: authCopy.api_login_required }, 401)
      const body = await getValidatedJson(req, requestSchemas.authChangePassword)
      const passwordLimit = await reservePasswordChangeAttemptLayered(getRequestClientIp(req), auth.user.id)
      if (!passwordLimit.allowed) return loginRateLimitResponse(passwordLimit.retryAfterSeconds)
      const changed = await changeUserPassword(auth.user, body.old_password, body.new_password, auth.tokenHash)
      if (!changed.ok) {
        passwordLimit.attempt.retainFailure()
        return jsonResponse({ error: changed.message }, changed.status)
      }
      await passwordLimit.attempt.refund()
      return jsonResponse(await buildAuthPayload(changed.user))
    }

    if (pathname.endsWith('/me')) {
      if (req.method !== 'GET') return methodNotAllowedResponse()
      const auth = await requireUserSession(req)
      if (!auth) return jsonResponse({ user: null, profiles: [], active_profile: null, workspace: null, announcement_unread_count: 0 })
      return jsonResponse(await buildAuthPayload(auth.user))
    }

    return jsonResponse({ error: authCopy.api_route_not_found }, 404)
  } catch (error) {
    if (error instanceof RateLimitStoreError) return rateLimitStoreUnavailableResponse()
    if (error instanceof PasswordWorkCapacityError) return passwordCapacityResponse()
    console.error('auth error:', error)
    if (pathname.endsWith('/register')) await recordRegister('failure', startedAt)
    return jsonResponse({ error: authCopy.api_internal_error }, 500)
  }
}

function registrationAcceptedResponse(): Response {
  return jsonResponse({
    accepted: true,
    message: authCopy.api_registration_accepted,
  }, 202)
}

function recoveryAcceptedResponse(): Response {
  return jsonResponse({
    accepted: true,
    message: authCopy.api_recovery_accepted,
  }, 202)
}

function methodNotAllowedResponse(): Response {
  return jsonResponse({ error: authCopy.api_method_not_allowed }, 405)
}

function rateLimitStoreUnavailableResponse(): Response {
  return jsonResponse(
    { error: authCopy.api_service_unavailable },
    503,
    rateLimitHeaders(1),
  )
}

function loginRateLimitResponse(retryAfterSeconds: number): Response {
  return jsonResponse(
    { error: authCopy.api_too_many_attempts },
    429,
    rateLimitHeaders(retryAfterSeconds),
  )
}

function passwordCapacityResponse(): Response {
  return jsonResponse(
    { error: authCopy.api_password_service_busy },
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
