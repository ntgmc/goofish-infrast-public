import {
  reserveAdminAuthenticationAttempt,
  reservePasswordChangeAttempt,
  reserveRecoveryAttempt,
  reserveRegistrationAttempt,
  reserveSklandAttempt,
  reserveTokenAttempt,
  reserveUserLoginAttempt,
  type AuthRateLimitDecision,
} from './auth-rate-limit'
import { reservePersistentRateLimit } from './persistent-rate-limit'

const AUTH_WINDOW_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const SKLAND_WINDOW_MS = 5 * 60 * 1000

export type LayeredRateLimitDecision =
  | {
    allowed: true
    attempt: {
      retainFailure: () => void
      refund: () => Promise<void>
    }
  }
  | { allowed: false; retryAfterSeconds: number }

export function reserveUserLoginAttemptLayered(clientIp: string, account: string): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reserveUserLoginAttempt(clientIp, account), 'user-login-account', account, 5, AUTH_WINDOW_MS)
}

export function reserveAdminAuthenticationAttemptLayered(clientIp: string, account: string): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reserveAdminAuthenticationAttempt(clientIp, account), 'admin-auth-account', account, 5, AUTH_WINDOW_MS)
}

export function reserveRegistrationAttemptLayered(clientIp: string, account: string): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reserveRegistrationAttempt(clientIp), 'register-account', account, 3, DAY_MS)
}

export function reserveRecoveryAttemptLayered(clientIp: string, account: string): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reserveRecoveryAttempt(clientIp), 'recovery-account', account, 3, AUTH_WINDOW_MS)
}

export function reserveTokenAttemptLayered(clientIp: string, token: string, namespace = 'auth-token'): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reserveTokenAttempt(clientIp), namespace, token, 5, AUTH_WINDOW_MS)
}

export function reservePasswordChangeAttemptLayered(clientIp: string, userId: string): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reservePasswordChangeAttempt(clientIp), 'password-change-user', userId, 5, AUTH_WINDOW_MS)
}

export function reserveSklandAttemptLayered(clientIp: string, userId: string): Promise<LayeredRateLimitDecision> {
  return reserveLayered(reserveSklandAttempt(clientIp), 'skland-user', userId, 10, SKLAND_WINDOW_MS)
}

async function reserveLayered(
  memoryDecision: AuthRateLimitDecision,
  namespace: string,
  identity: string,
  limit: number,
  windowMs: number,
): Promise<LayeredRateLimitDecision> {
  if (!memoryDecision.allowed) return memoryDecision
  try {
    const persistent = await reservePersistentRateLimit(namespace, identity, limit, windowMs)
    if (!persistent.allowed) {
      memoryDecision.attempt.refund()
      return persistent
    }
    let completed = false
    return {
      allowed: true,
      attempt: {
        retainFailure: () => {
          if (completed) return
          completed = true
          memoryDecision.attempt.retainFailure()
          persistent.attempt.retain()
        },
        refund: async () => {
          if (completed) return
          completed = true
          memoryDecision.attempt.refund()
          await persistent.attempt.refund()
        },
      },
    }
  } catch (error) {
    memoryDecision.attempt.refund()
    throw error
  }
}

