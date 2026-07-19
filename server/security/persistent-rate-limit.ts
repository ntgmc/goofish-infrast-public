import { createHash } from 'node:crypto'
import { ensureDatabaseSchema } from '../storage/schema'
import { hasDatabaseUrl, query } from '../storage/postgres'

type RateLimitBucketRow = {
  window_started_at: string
  expires_at: Date | string
  attempt_count: number
}

export type PersistentRateLimitAttempt = {
  retain: () => void
  refund: () => Promise<void>
}

export type PersistentRateLimitDecision =
  | { allowed: true; attempt: PersistentRateLimitAttempt }
  | { allowed: false; retryAfterSeconds: number }

export class RateLimitStoreError extends Error {
  constructor() {
    super('Rate limit store is unavailable')
    this.name = 'RateLimitStoreError'
  }
}

let schemaReady: Promise<void> | null = null
let cleanupCounter = 0

export async function reservePersistentRateLimit(
  namespace: string,
  identity: string,
  limit: number,
  windowMs: number,
): Promise<PersistentRateLimitDecision> {
  if (!hasDatabaseUrl()) {
    if (process.env.NODE_ENV === 'production') throw new RateLimitStoreError()
    return allowWithoutPersistence()
  }

  const keyHash = createHash('sha256').update(`${namespace}\0${identity}`).digest('hex')
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
  try {
    await ensureSchema()
    const result = await query<RateLimitBucketRow>(
      `insert into security_rate_limit_buckets
         (key_hash, window_started_at, expires_at, attempt_count, updated_at)
       values ($1, now(), now() + ($2 * interval '1 second'), 1, now())
       on conflict (key_hash) do update set
         window_started_at = case
           when security_rate_limit_buckets.expires_at <= now() then now()
           else security_rate_limit_buckets.window_started_at
         end,
         expires_at = case
           when security_rate_limit_buckets.expires_at <= now() then now() + ($2 * interval '1 second')
           else security_rate_limit_buckets.expires_at
         end,
         attempt_count = case
           when security_rate_limit_buckets.expires_at <= now() then 1
           else security_rate_limit_buckets.attempt_count + 1
         end,
         updated_at = now()
       returning window_started_at::text as window_started_at, expires_at, attempt_count`,
      [keyHash, windowSeconds],
    )
    const bucket = result.rows[0]
    if (!bucket) throw new RateLimitStoreError()
    void cleanupExpiredBuckets()

    const expiresAt = new Date(bucket.expires_at).getTime()
    if (bucket.attempt_count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
      }
    }

    const windowStartedAt = bucket.window_started_at
    let completed = false
    return {
      allowed: true,
      attempt: {
        retain: () => {
          completed = true
        },
        refund: async () => {
          if (completed) return
          completed = true
          await query(
            `update security_rate_limit_buckets
             set attempt_count = greatest(0, attempt_count - 1), updated_at = now()
             where key_hash = $1 and window_started_at = $2::timestamptz`,
            [keyHash, windowStartedAt],
          )
        },
      },
    }
  } catch (error) {
    if (error instanceof RateLimitStoreError) throw error
    throw new RateLimitStoreError()
  }
}

function allowWithoutPersistence(): PersistentRateLimitDecision {
  return {
    allowed: true,
    attempt: {
      retain: () => undefined,
      refund: async () => undefined,
    },
  }
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}

async function cleanupExpiredBuckets(): Promise<void> {
  cleanupCounter += 1
  if (cleanupCounter % 100 !== 0) return
  try {
    await query(
      `delete from security_rate_limit_buckets
       where key_hash in (
         select key_hash from security_rate_limit_buckets
         where expires_at <= now()
         order by expires_at asc
         limit 500
       )`,
    )
  } catch {
    // Cleanup is best-effort; reservation failures still fail closed above.
  }
}
