import { createHash } from 'node:crypto'

const AUTH_WINDOW_MS = 15 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000
const MAX_RATE_LIMIT_ENTRIES = 20_000
const CAPACITY_RETRY_AFTER_SECONDS = 60

type RateLimitScope = {
  key: string
  limit: number
  windowMs: number
}

type Reservation = {
  key: string
  id: number
}

type RateLimitEvent = {
  id: number
  expiresAt: number
}

type RateLimitEntry = {
  events: RateLimitEvent[]
}

export type AuthAttempt = {
  retainFailure: () => void
  refund: () => void
}

export type AuthRateLimitDecision =
  | { allowed: true; attempt: AuthAttempt }
  | { allowed: false; retryAfterSeconds: number }

type SlidingWindowRateLimiterOptions = {
  maxEntries?: number
  cleanupIntervalMs?: number
  now?: () => number
}

export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>()
  private readonly maxEntries: number
  private readonly cleanupIntervalMs: number
  private readonly now: () => number
  private lastCleanupAt = 0
  private nextEventId = 1

  constructor(options: SlidingWindowRateLimiterOptions = {}) {
    this.maxEntries = options.maxEntries ?? MAX_RATE_LIMIT_ENTRIES
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS
    this.now = options.now ?? Date.now
  }

  reserve(scopes: RateLimitScope[]): AuthRateLimitDecision {
    const now = this.now()
    this.cleanupIfNeeded(now)
    const uniqueScopes = [...new Map(scopes.map((scope) => [scope.key, scope])).values()]
    let retryAfterSeconds = 0

    for (const scope of uniqueScopes) {
      const entry = this.pruneEntry(scope.key, now)
      if (entry && entry.events.length >= scope.limit) {
        const oldest = entry.events[0]
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.max(1, Math.ceil((oldest.expiresAt - now) / 1000)),
        )
      }
    }
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds }

    const newEntryCount = uniqueScopes.filter((scope) => !this.entries.has(scope.key)).length
    if (this.entries.size + newEntryCount > this.maxEntries) {
      return { allowed: false, retryAfterSeconds: CAPACITY_RETRY_AFTER_SECONDS }
    }

    const reservations: Reservation[] = []
    for (const scope of uniqueScopes) {
      const entry = this.entries.get(scope.key) ?? { events: [] }
      const id = this.nextEventId
      this.nextEventId += 1
      entry.events.push({ id, expiresAt: now + scope.windowMs })
      this.entries.set(scope.key, entry)
      reservations.push({ key: scope.key, id })
    }

    let completed = false
    return {
      allowed: true,
      attempt: {
        retainFailure: () => {
          completed = true
        },
        refund: () => {
          if (completed) return
          completed = true
          for (const reservation of reservations) this.removeReservation(reservation)
        },
      },
    }
  }

  private cleanupIfNeeded(now: number): void {
    if (
      this.entries.size < this.maxEntries
      && now - this.lastCleanupAt < this.cleanupIntervalMs
    ) return
    this.lastCleanupAt = now
    for (const key of this.entries.keys()) this.pruneEntry(key, now)
  }

  private pruneEntry(key: string, now: number): RateLimitEntry | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    entry.events = entry.events.filter((event) => event.expiresAt > now)
    if (entry.events.length === 0) {
      this.entries.delete(key)
      return null
    }
    return entry
  }

  private removeReservation(reservation: Reservation): void {
    const entry = this.entries.get(reservation.key)
    if (!entry) return
    const index = entry.events.findIndex((event) => event.id === reservation.id)
    if (index >= 0) entry.events.splice(index, 1)
    if (entry.events.length === 0) this.entries.delete(reservation.key)
  }
}

const authRateLimiter = new SlidingWindowRateLimiter()

export function reserveUserLoginAttempt(clientIp: string, account: string): AuthRateLimitDecision {
  return authRateLimiter.reserve([
    authScope('user-login-ip', clientIp, 20),
    authScope('user-login-account', account, 5),
  ])
}

export function reserveAdminAuthenticationAttempt(clientIp: string, account: string): AuthRateLimitDecision {
  return authRateLimiter.reserve([
    authScope('admin-auth-ip', clientIp, 30),
    authScope('admin-auth-account', account, 10),
  ])
}

function authScope(namespace: string, identity: string, limit: number): RateLimitScope {
  return {
    key: createHash('sha256').update(`${namespace}\0${identity}`).digest('hex'),
    limit,
    windowMs: AUTH_WINDOW_MS,
  }
}
