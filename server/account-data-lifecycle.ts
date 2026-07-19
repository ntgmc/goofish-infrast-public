import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ensureDatabaseSchema } from './storage/schema'
import { getPool, query } from './storage/postgres'
import { deleteUserAccount, getUserById, type UserAccountRecord } from './storage/user-store'
import { sendAccountDeletionCancellationEmail, sendAccountDeletionReceiptEmail } from './handlers/email'

const DELETION_DELAY_MS = 7 * 24 * 60 * 60 * 1000

type AccountDeletionRequest = {
  id: string
  user_id: string
  cancel_token_hash: string
  scheduled_for: string
  created_at: string
}

export async function requestAccountDeletion(user: UserAccountRecord): Promise<{ scheduledFor: string }> {
  await ensureDatabaseSchema()
  const token = randomBytes(32).toString('base64url')
  const scheduledFor = new Date(Date.now() + DELETION_DELAY_MS).toISOString()
  const cancelUrl = buildCancellationUrl(token)
  await sendAccountDeletionCancellationEmail(user.email, cancelUrl)
  const updatedAt = new Date().toISOString()
  const pendingUser: UserAccountRecord = { ...user, status: 'pending_deletion', updated_at: updatedAt }
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into account_deletion_requests (id, user_id, cancel_token_hash, scheduled_for, created_at)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), user.id, hashToken(token), scheduledFor, updatedAt],
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
         where profile_id in (select id from user_game_accounts where user_id = $1)
            or owner_key in (select 'profile:' || id from user_game_accounts where user_id = $1)
       )`,
      [user.id],
    )
    await client.query(
      `update optimize_jobs set status = 'failed', error_message = '账号已请求注销，任务已取消。',
         payload_json = payload_json - 'activeProfile', worker_id = null, heartbeat_at = null,
         lock_token = null, lock_expires_at = null,
         finished_at = now(), updated_at = now()
       where profile_id in (select id from user_game_accounts where user_id = $1)
          or owner_key in (select 'profile:' || id from user_game_accounts where user_id = $1)`,
      [user.id],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  return { scheduledFor }
}

export async function cancelAccountDeletion(token: string): Promise<boolean> {
  await ensureDatabaseSchema()
  const result = await query<AccountDeletionRequest>('select * from account_deletion_requests where cancel_token_hash = $1', [hashToken(token)])
  const request = result.rows[0]
  if (!request || Date.parse(request.scheduled_for) <= Date.now()) return false
  const user = await getUserById(request.user_id)
  if (!user || user.status !== 'pending_deletion') return false
  const restored: UserAccountRecord = { ...user, status: 'active', updated_at: new Date().toISOString() }
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query('update user_accounts set status = $2, record_json = $3::jsonb, updated_at = $4 where id = $1', [restored.id, restored.status, JSON.stringify(restored), restored.updated_at])
    await client.query('delete from account_deletion_requests where id = $1', [request.id])
    await client.query('commit')
    return true
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function processDueAccountDeletions(now = new Date()): Promise<number> {
  await ensureDatabaseSchema()
  const due = await query<AccountDeletionRequest & { email: string }>(
    `select request.*, account.email from account_deletion_requests request
     join user_accounts account on account.id = request.user_id
     where request.scheduled_for <= $1 order by request.scheduled_for asc`,
    [now.toISOString()],
  )
  for (const request of due.rows) {
    await deleteUserAccount(request.user_id)
    try {
      await sendAccountDeletionReceiptEmail(request.email, request.id)
    } catch (error) {
      console.warn('account deletion receipt skipped:', error instanceof Error ? error.message : error)
    }
  }
  return due.rows.length
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
    running = processDueAccountDeletions()
      .then(() => undefined)
      .catch((error) => console.warn('account deletion worker skipped:', error))
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
