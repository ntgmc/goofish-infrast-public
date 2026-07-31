import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ensureDatabaseSchema } from './storage/schema'
import { query, withTransaction } from './storage/postgres'
import {
  deleteUserAccountInTransaction,
  type UserAccountRecord,
} from './storage/user-store'
import { purgeExpiredPersonalUseDeclarationAcceptances } from './storage/personal-use-declaration-store'
import { sendAccountDeletionCancellationEmail, sendAccountDeletionReceiptEmail } from './handlers/email'
import { recordAccountDeletedBehaviorEvent } from './behavior-risk/service'
import { releaseScheduleBalanceInTransaction } from './storage/balance-store'

const DELETION_DELAY_MS = 7 * 24 * 60 * 60 * 1000
const DELETION_LEASE_MS = 5 * 60 * 1000
const EMAIL_LEASE_MS = 2 * 60 * 1000
const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_DELETION_ATTEMPTS = 8
const MAX_EMAIL_ATTEMPTS = 10
const MAINTENANCE_BATCH_SIZE = 50

type AccountDeletionRequestStatus = 'pending' | 'processing' | 'failed'

type AccountDeletionRequest = {
  id: string
  user_id: string
  cancel_token_hash: string
  scheduled_for: string
  status: AccountDeletionRequestStatus
  attempts: number
  next_attempt_at: string
  lease_token: string | null
  lease_expires_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

type AccountDeletionEmailKind = 'cancellation' | 'receipt'

type AccountDeletionEmailOutbox = {
  id: string
  deletion_request_id: string
  kind: AccountDeletionEmailKind
  recipient_email: string
  payload_json: Record<string, unknown>
  status: 'pending' | 'processing' | 'dead_letter'
  attempts: number
  next_attempt_at: string
  lease_token: string | null
  lease_expires_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  delete_after: string
}

export type AccountDeletionAccepted = {
  scheduledFor: string
  cancellationEmail: 'queued' | 'sent' | 'delayed'
}

type AccountDeletionMaintenanceResult = {
  deletedAccounts: number
  sentEmails: number
}

export async function requestAccountDeletion(
  user: UserAccountRecord,
  now = new Date(),
): Promise<AccountDeletionAccepted> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`account-deletion:${user.id}`])
    const existing = await client.query<AccountDeletionRequest>(
      `select id, user_id, cancel_token_hash, scheduled_for::text, status, attempts,
              next_attempt_at::text, lease_token, lease_expires_at::text, last_error,
              created_at::text, updated_at::text
         from account_deletion_requests
        where user_id = $1
        for update`,
      [user.id],
    )
    const existingRequest = existing.rows[0]
    if (existingRequest) {
      const outbox = await client.query<{ status: AccountDeletionEmailOutbox['status'] }>(
        `select status from account_deletion_email_outbox
          where deletion_request_id = $1 and kind = 'cancellation'`,
        [existingRequest.id],
      )
      return {
        scheduledFor: new Date(existingRequest.scheduled_for).toISOString(),
        cancellationEmail: outbox.rows[0]?.status === 'dead_letter'
          ? 'delayed'
          : outbox.rows[0]
            ? 'queued'
            : 'sent',
      }
    }

    const current = await client.query<{ record_json: UserAccountRecord }>(
      'select record_json from user_accounts where id = $1 for update',
      [user.id],
    )
    const currentUser = current.rows[0]?.record_json
    if (!currentUser || currentUser.status !== 'active') {
      throw new AccountDeletionStateError('当前账号状态不允许申请注销。')
    }

    const token = randomBytes(32).toString('base64url')
    const requestId = randomUUID()
    const updatedAt = now.toISOString()
    const scheduledFor = new Date(now.getTime() + DELETION_DELAY_MS).toISOString()
    const deleteAfter = new Date(now.getTime() + OUTBOX_RETENTION_MS).toISOString()
    const cancelUrl = buildCancellationUrl(token)
    const pendingUser: UserAccountRecord = {
      ...currentUser,
      status: 'pending_deletion',
      updated_at: updatedAt,
    }

    await client.query(
      `insert into account_deletion_requests
        (id, user_id, cancel_token_hash, scheduled_for, status, attempts, next_attempt_at,
         lease_token, lease_expires_at, last_error, created_at, updated_at)
       values ($1, $2, $3, $4, 'pending', 0, $5, null, null, null, $5, $5)`,
      [requestId, user.id, hashToken(token), scheduledFor, updatedAt],
    )
    await client.query(
      `insert into account_deletion_email_outbox
        (id, deletion_request_id, kind, recipient_email, payload_json, status, attempts,
         next_attempt_at, lease_token, lease_expires_at, last_error, created_at, updated_at, delete_after)
       values ($1, $2, 'cancellation', $3, $4::jsonb, 'pending', 0,
               $5, null, null, null, $5, $5, $6)`,
      [randomUUID(), requestId, currentUser.email, JSON.stringify({ cancel_url: cancelUrl }), updatedAt, deleteAfter],
    )
    await client.query(
      `update user_accounts set status = $2, record_json = $3::jsonb, updated_at = $4 where id = $1`,
      [user.id, pendingUser.status, JSON.stringify(pendingUser), updatedAt],
    )
    await client.query('delete from user_sessions where user_id = $1', [user.id])
    await client.query(
      `update user_game_accounts
       set record_json = case when record_json ? 'skland_binding'
         then jsonb_set(record_json, '{skland_binding,encrypted_cred}', '""'::jsonb)
         else record_json end,
         updated_at = $2
       where user_id = $1`,
      [user.id, updatedAt],
    )
    await client.query(
      `update optimize_job_attempts
       set status = 'failed', failure_kind = 'application_error', error_message = '账号已请求注销，任务已取消。',
           finished_at = now(), heartbeat_at = now()
       where status = 'running' and job_id in (
         select id from optimize_jobs
         where billing_user_id = $1
            or profile_id in (select id from user_game_accounts where user_id = $1)
            or owner_key in (
              select owner_prefix || id
                from user_game_accounts
                cross join (values ('profile:'), ('reorder-job:')) as owner(owner_prefix)
               where user_id = $1
            )
       )`,
      [user.id],
    )
    const cancelledJobs = await client.query<{ id: string }>(
      `update optimize_jobs set status = 'failed', error_message = '账号已请求注销，任务已取消。',
         payload_json = payload_json - 'activeProfile', worker_id = null, heartbeat_at = null,
         lock_token = null, lock_expires_at = null,
         finished_at = now(), updated_at = now()
       where (billing_user_id = $1
          or profile_id in (select id from user_game_accounts where user_id = $1)
          or owner_key in (
            select owner_prefix || id
              from user_game_accounts
              cross join (values ('profile:'), ('reorder-job:')) as owner(owner_prefix)
             where user_id = $1
          ))
         and status in ('queued', 'running')
       returning id`,
      [user.id],
    )
    for (const job of cancelledJobs.rows) await releaseScheduleBalanceInTransaction(client, job.id)
    const remainingReservations = await client.query<{ job_id: string }>(
      `select job_id from user_balance_reservations
        where user_id = $1 and status = 'reserved' for update`,
      [user.id],
    )
    for (const reservation of remainingReservations.rows) {
      await releaseScheduleBalanceInTransaction(client, reservation.job_id)
    }

    return { scheduledFor, cancellationEmail: 'queued' }
  })
}

export async function cancelAccountDeletion(token: string, now = new Date()): Promise<boolean> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const result = await client.query<AccountDeletionRequest & { record_json: UserAccountRecord }>(
      `select request.id, request.user_id, request.cancel_token_hash,
              request.scheduled_for::text, request.status, request.attempts,
              request.next_attempt_at::text, request.lease_token,
              request.lease_expires_at::text, request.last_error,
              request.created_at::text, request.updated_at::text,
              account.record_json
         from account_deletion_requests request
         join user_accounts account on account.id = request.user_id
        where request.cancel_token_hash = $1
          and request.status = 'pending'
          and request.scheduled_for > $2
        for update of request, account`,
      [hashToken(token), now.toISOString()],
    )
    const request = result.rows[0]
    if (!request || request.record_json.status !== 'pending_deletion') return false

    const updatedAt = now.toISOString()
    const restored: UserAccountRecord = {
      ...request.record_json,
      status: 'active',
      updated_at: updatedAt,
    }
    const restoredUser = await client.query(
      `update user_accounts
          set status = 'active', record_json = $2::jsonb, updated_at = $3
        where id = $1 and status = 'pending_deletion'`,
      [request.user_id, JSON.stringify(restored), updatedAt],
    )
    if (restoredUser.rowCount !== 1) return false
    await client.query(
      `delete from account_deletion_email_outbox
        where deletion_request_id = $1 and kind = 'cancellation'`,
      [request.id],
    )
    const deleted = await client.query(
      `delete from account_deletion_requests
        where id = $1 and status = 'pending'`,
      [request.id],
    )
    return deleted.rowCount === 1
  })
}

async function processAccountDeletionMaintenance(
  now = new Date(),
): Promise<AccountDeletionMaintenanceResult> {
  await ensureDatabaseSchema()
  let sentEmails = await processAccountDeletionEmailOutbox(now)
  const deletedAccounts = await processDueAccountDeletions(now)
  sentEmails += await processAccountDeletionEmailOutbox(now)
  await purgeExpiredPersonalUseDeclarationAcceptances(now)
  await query(
    `delete from account_deletion_email_outbox
      where status = 'dead_letter' and delete_after <= $1`,
    [now.toISOString()],
  )
  return { deletedAccounts, sentEmails }
}

export async function processDueAccountDeletions(now = new Date()): Promise<number> {
  await ensureDatabaseSchema()
  let processed = 0
  for (let index = 0; index < MAINTENANCE_BATCH_SIZE; index += 1) {
    const claimed = await claimDueAccountDeletion(now)
    if (!claimed) break
    try {
      const deleted = await finalizeClaimedAccountDeletion(claimed, now)
      if (!deleted) continue
      processed += 1
      try {
        await recordAccountDeletedBehaviorEvent(claimed.user_id, now)
      } catch (error) {
        console.warn('[account-deletion] behavior event recording failed:', safeErrorSummary(error))
      }
    } catch (error) {
      const failed = await releaseAccountDeletionClaim(claimed, error, now)
      const log = failed
        ? '[account-deletion] deletion moved to failed state:'
        : '[account-deletion] deletion scheduled for retry:'
      console.warn(log, safeErrorSummary(error))
    }
  }
  return processed
}

export async function processAccountDeletionEmailOutbox(now = new Date()): Promise<number> {
  await ensureDatabaseSchema()
  let sent = 0
  for (let index = 0; index < MAINTENANCE_BATCH_SIZE; index += 1) {
    const claimed = await claimAccountDeletionEmail(now)
    if (!claimed) break
    try {
      await deliverAccountDeletionEmail(claimed)
      const completed = await query(
        `delete from account_deletion_email_outbox
          where id = $1 and status = 'processing' and lease_token = $2`,
        [claimed.id, claimed.lease_token],
      )
      if (completed.rowCount === 1) sent += 1
    } catch (error) {
      const deadLettered = await releaseAccountDeletionEmailClaim(claimed, error, now)
      const log = deadLettered
        ? '[account-deletion] email moved to dead letter:'
        : '[account-deletion] email scheduled for retry:'
      console.warn(log, safeErrorSummary(error))
    }
  }
  return sent
}

export type AccountDeletionWorkerController = {
  stop: () => void
  waitForIdle: () => Promise<void>
}

export function startAccountDeletionWorker(): AccountDeletionWorkerController {
  let stopped = false
  let running: Promise<void> | null = null
  const run = () => {
    if (stopped || running) return
    running = processAccountDeletionMaintenance()
      .then(() => undefined)
      .catch((error) => console.warn('[account-deletion] maintenance skipped:', safeErrorSummary(error)))
      .finally(() => {
        running = null
      })
  }
  run()
  const timer = setInterval(run, 60_000)
  timer.unref?.()
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
    waitForIdle: async () => {
      if (running) await running
    },
  }
}

export function getAccountDeletionConfigurationHealth(
  environment: { DEPOT_SAMPLE_HASH_SECRET?: string } = process.env,
): { ok: boolean } {
  return { ok: Boolean(environment.DEPOT_SAMPLE_HASH_SECRET?.trim()) }
}

export class AccountDeletionStateError extends Error {
  readonly code = 'account_deletion_state_conflict'
  readonly status = 409

  constructor(message: string) {
    super(message)
    this.name = 'AccountDeletionStateError'
  }
}

async function claimDueAccountDeletion(now: Date): Promise<AccountDeletionRequest | null> {
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + DELETION_LEASE_MS).toISOString()
  const result = await withTransaction((client) => client.query<AccountDeletionRequest>(
    `with expired as (
       update account_deletion_requests
          set status = 'failed', lease_token = null, lease_expires_at = null,
              last_error = coalesce(last_error, 'Worker lease expired after the final attempt'),
              updated_at = $1
        where status = 'processing' and lease_expires_at <= $1 and attempts >= $2
        returning id
     ), candidate as (
       select id
         from account_deletion_requests
        where attempts < $2
          and (
            (status = 'pending' and scheduled_for <= $1 and next_attempt_at <= $1)
            or (status = 'processing' and lease_expires_at <= $1)
          )
        order by scheduled_for asc, created_at asc
        for update skip locked
        limit 1
     )
     update account_deletion_requests request
        set status = 'processing', attempts = request.attempts + 1,
            lease_token = $3, lease_expires_at = $4, updated_at = $1
       from candidate
      where request.id = candidate.id
      returning request.id, request.user_id, request.cancel_token_hash,
                request.scheduled_for::text, request.status, request.attempts,
                request.next_attempt_at::text, request.lease_token,
                request.lease_expires_at::text, request.last_error,
                request.created_at::text, request.updated_at::text`,
    [now.toISOString(), MAX_DELETION_ATTEMPTS, leaseToken, leaseExpiresAt],
  ))
  return result.rows[0] ?? null
}

async function finalizeClaimedAccountDeletion(
  claimed: AccountDeletionRequest,
  now: Date,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const locked = await client.query<AccountDeletionRequest & { email: string }>(
      `select request.id, request.user_id, request.cancel_token_hash,
              request.scheduled_for::text, request.status, request.attempts,
              request.next_attempt_at::text, request.lease_token,
              request.lease_expires_at::text, request.last_error,
              request.created_at::text, request.updated_at::text,
              account.email
         from account_deletion_requests request
         join user_accounts account on account.id = request.user_id
        where request.id = $1 and request.status = 'processing' and request.lease_token = $2
        for update of request, account`,
      [claimed.id, claimed.lease_token],
    )
    const request = locked.rows[0]
    if (!request) return false

    const timestamp = now.toISOString()
    await client.query(
      `delete from account_deletion_email_outbox
        where deletion_request_id = $1 and kind = 'cancellation'`,
      [request.id],
    )
    await client.query(
      `insert into account_deletion_email_outbox
        (id, deletion_request_id, kind, recipient_email, payload_json, status, attempts,
         next_attempt_at, lease_token, lease_expires_at, last_error, created_at, updated_at, delete_after)
       values ($1, $2, 'receipt', $3, $4::jsonb, 'pending', 0,
               $5, null, null, null, $5, $5, $6)
       on conflict (deletion_request_id, kind) do nothing`,
      [
        randomUUID(),
        request.id,
        request.email,
        JSON.stringify({ receipt_id: request.id }),
        timestamp,
        new Date(now.getTime() + OUTBOX_RETENTION_MS).toISOString(),
      ],
    )
    await deleteUserAccountInTransaction(client, request.user_id)
    return true
  })
}

async function releaseAccountDeletionClaim(
  claimed: AccountDeletionRequest,
  error: unknown,
  now: Date,
): Promise<boolean> {
  const failed = claimed.attempts >= MAX_DELETION_ATTEMPTS
  const nextAttemptAt = new Date(now.getTime() + retryDelayMs(claimed.attempts)).toISOString()
  const result = await query(
    `update account_deletion_requests
        set status = $3, next_attempt_at = $4, lease_token = null, lease_expires_at = null,
            last_error = $5, updated_at = $6
      where id = $1 and status = 'processing' and lease_token = $2`,
    [
      claimed.id,
      claimed.lease_token,
      failed ? 'failed' : 'pending',
      nextAttemptAt,
      safeErrorSummary(error),
      now.toISOString(),
    ],
  )
  return failed && result.rowCount === 1
}

async function claimAccountDeletionEmail(now: Date): Promise<AccountDeletionEmailOutbox | null> {
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + EMAIL_LEASE_MS).toISOString()
  const result = await withTransaction((client) => client.query<AccountDeletionEmailOutbox>(
    `with expired as (
       update account_deletion_email_outbox
          set status = 'dead_letter', lease_token = null, lease_expires_at = null,
              last_error = coalesce(last_error, 'Worker lease expired after the final attempt'),
              updated_at = $1
        where status = 'processing' and lease_expires_at <= $1 and attempts >= $2
        returning id
     ), candidate as (
       select id
         from account_deletion_email_outbox
        where attempts < $2
          and (
            (status = 'pending' and next_attempt_at <= $1)
            or (status = 'processing' and lease_expires_at <= $1)
          )
        order by next_attempt_at asc, created_at asc
        for update skip locked
        limit 1
     )
     update account_deletion_email_outbox outbox
        set status = 'processing', attempts = outbox.attempts + 1,
            lease_token = $3, lease_expires_at = $4, updated_at = $1
       from candidate
      where outbox.id = candidate.id
      returning outbox.id, outbox.deletion_request_id, outbox.kind,
                outbox.recipient_email, outbox.payload_json, outbox.status, outbox.attempts,
                outbox.next_attempt_at::text, outbox.lease_token,
                outbox.lease_expires_at::text, outbox.last_error,
                outbox.created_at::text, outbox.updated_at::text, outbox.delete_after::text`,
    [now.toISOString(), MAX_EMAIL_ATTEMPTS, leaseToken, leaseExpiresAt],
  ))
  return result.rows[0] ?? null
}

async function deliverAccountDeletionEmail(outbox: AccountDeletionEmailOutbox): Promise<void> {
  if (outbox.kind === 'cancellation') {
    const cancelUrl = outbox.payload_json.cancel_url
    if (typeof cancelUrl !== 'string' || !cancelUrl) throw new Error('Cancellation email payload is invalid')
    await sendAccountDeletionCancellationEmail(outbox.recipient_email, cancelUrl)
    return
  }
  const receiptId = outbox.payload_json.receipt_id
  if (typeof receiptId !== 'string' || !receiptId) throw new Error('Receipt email payload is invalid')
  await sendAccountDeletionReceiptEmail(outbox.recipient_email, receiptId)
}

async function releaseAccountDeletionEmailClaim(
  claimed: AccountDeletionEmailOutbox,
  error: unknown,
  now: Date,
): Promise<boolean> {
  const deadLettered = claimed.attempts >= MAX_EMAIL_ATTEMPTS
  const nextAttemptAt = new Date(now.getTime() + retryDelayMs(claimed.attempts)).toISOString()
  const result = await query(
    `update account_deletion_email_outbox
        set status = $3, next_attempt_at = $4, lease_token = null, lease_expires_at = null,
            last_error = $5, updated_at = $6
      where id = $1 and status = 'processing' and lease_token = $2`,
    [
      claimed.id,
      claimed.lease_token,
      deadLettered ? 'dead_letter' : 'pending',
      nextAttemptAt,
      safeErrorSummary(error),
      now.toISOString(),
    ],
  )
  return deadLettered && result.rowCount === 1
}

function retryDelayMs(attempt: number): number {
  return Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempt - 1))
}

function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 500)
  return `${error.name}: ${error.message}`.slice(0, 500)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function buildCancellationUrl(token: string): string {
  const baseUrl = process.env.PUBLIC_APP_URL?.trim()
  if (!baseUrl) throw new Error('PUBLIC_APP_URL not configured')
  const url = new URL('/cancel-account-deletion', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  url.searchParams.set('token', token)
  return url.toString()
}
