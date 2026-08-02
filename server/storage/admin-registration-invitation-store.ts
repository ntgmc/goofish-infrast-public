import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { AdminRegistrationInvitation, AdminRegistrationInvitationStatus } from '../../src/lib/types'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'

const ADMIN_INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ADMIN_INVITE_LENGTH = 16
const ADMIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_GENERATION_ATTEMPTS = 10
const CODE_RECOVERY_TTL_MS = 10 * 60 * 1000
const MAX_ACTIVE_INVITATIONS_PER_ADMIN = 20
const MAX_VERIFICATION_OUTBOX_ATTEMPTS = 5
const VERIFICATION_OUTBOX_LEASE_MS = 5 * 60 * 1000

interface AdminRegistrationInvitationRow {
  id: string
  created_at: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  consumed_by_user_id: string | null
  consumed_by_email: string | null
  created_by: string
  create_reason: string
  revoked_by: string | null
  revoke_reason: string | null
  email_verified_at: string | null
  delivery_status: 'reserved' | 'sent' | 'failed' | 'uncertain' | null
  outbox_status: 'pending' | 'processing' | 'sent' | 'dead_letter' | null
  request_hash?: string | null
  code_ciphertext?: string | null
  code_iv?: string | null
  code_auth_tag?: string | null
  code_recoverable_until?: string | null
}

export interface ValidatedAdminRegistrationInvitation {
  id: string
  codeHash: string
}

export class AdminRegistrationInvitationError extends Error {
  readonly code = 'invalid_invite_code'

  constructor(message = '管理员邀请码无效。') {
    super(message)
    this.name = 'AdminRegistrationInvitationError'
  }
}

export class AdminRegistrationInvitationOperationError extends Error {
  constructor(
    readonly code: 'idempotency_conflict' | 'idempotency_response_expired' | 'active_invitation_limit',
    message: string,
  ) {
    super(message)
    this.name = 'AdminRegistrationInvitationOperationError'
  }
}

let schemaReady: Promise<void> | null = null

export function normalizeAdminRegistrationInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code) ? code : null
}

export async function createAdminRegistrationInvitation(input: {
  adminUsername: string
  reason: string
  idempotencyKey: string
  encryptionSecret: string
  now?: Date
}): Promise<{
  invitation: AdminRegistrationInvitation
  code: string
}> {
  await ensureSchema()
  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const requestHash = hashOperation({
    action: 'create',
    admin_username: input.adminUsername,
    reason: input.reason,
  })
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('admin-registration-invitation:' || $1))", [input.adminUsername])
    await client.query(
      `update admin_registration_invitations
          set code_ciphertext = null, code_iv = null, code_auth_tag = null
        where code_recoverable_until <= $1 and code_ciphertext is not null`,
      [createdAt],
    )
    const replay = await client.query<AdminRegistrationInvitationRow>(
      `${adminInvitationSelect()}
        where invitation.created_by = $1 and invitation.idempotency_key = $2
        for update of invitation`,
      [input.adminUsername, input.idempotencyKey],
    )
    const existing = replay.rows[0]
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new AdminRegistrationInvitationOperationError('idempotency_conflict', '幂等键已被不同的签发请求使用。')
      }
      if (!existing.code_ciphertext || !existing.code_iv || !existing.code_auth_tag
        || !existing.code_recoverable_until || Date.parse(existing.code_recoverable_until) <= now.getTime()) {
        throw new AdminRegistrationInvitationOperationError(
          'idempotency_response_expired',
          '原签发响应的安全恢复窗口已过期，请先检查列表后使用新的幂等键。',
        )
      }
      return {
        invitation: toPublicInvitation(existing, now),
        code: decryptAdminInviteCode(existing, input.encryptionSecret),
      }
    }
    const active = await client.query<{ count: string }>(
      `select count(*)::text as count
         from admin_registration_invitations
        where created_by = $1 and consumed_at is null and revoked_at is null and expires_at > $2`,
      [input.adminUsername, createdAt],
    )
    if (Number(active.rows[0]?.count ?? 0) >= MAX_ACTIVE_INVITATIONS_PER_ADMIN) {
      throw new AdminRegistrationInvitationOperationError(
        'active_invitation_limit',
        `每个管理员最多同时保有 ${MAX_ACTIVE_INVITATIONS_PER_ADMIN} 个有效注册邀请码。`,
      )
    }
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const code = createAdminInviteCode()
      const encrypted = encryptAdminInviteCode(code, input.encryptionSecret)
      const id = randomUUID()
      const expiresAt = new Date(now.getTime() + ADMIN_INVITE_TTL_MS).toISOString()
      const recoverableUntil = new Date(now.getTime() + CODE_RECOVERY_TTL_MS).toISOString()
      const inserted = await client.query<AdminRegistrationInvitationRow>(
        `insert into admin_registration_invitations
          (id, code_hash, created_by, create_reason, idempotency_key, request_hash,
           code_ciphertext, code_iv, code_auth_tag, code_recoverable_until,
           created_at, expires_at, consumed_at, consumed_by_user_id, revoked_at, revoked_by, revoke_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, null, null, null, null, null)
         on conflict (code_hash) do nothing
         returning id, created_at::text, expires_at::text, consumed_at::text, revoked_at::text,
                   consumed_by_user_id, null::text as consumed_by_email,
                   created_by, create_reason, revoked_by, revoke_reason,
                   null::text as email_verified_at, null::text as delivery_status, null::text as outbox_status,
                   request_hash, code_ciphertext, code_iv, code_auth_tag, code_recoverable_until::text`,
        [
          id, hashAdminInviteCode(code), input.adminUsername, input.reason, input.idempotencyKey, requestHash,
          encrypted.ciphertext, encrypted.iv, encrypted.authTag, recoverableUntil, createdAt, expiresAt,
        ],
      )
      const row = inserted.rows[0]
      if (!row) continue
      await insertAudit(client, {
        invitationId: id,
        adminUsername: input.adminUsername,
        action: 'create',
        reason: input.reason,
        requestHash,
        before: null,
        after: { status: 'active', created_at: createdAt, expires_at: expiresAt },
        now: createdAt,
      })
      return { invitation: toPublicInvitation(row, now), code }
    }
    throw new Error('生成管理员邀请码失败，请重试。')
  })
}

export async function validateAdminRegistrationInvitation(
  value: unknown,
  now = new Date(),
): Promise<ValidatedAdminRegistrationInvitation> {
  const code = normalizeAdminRegistrationInviteCode(value)
  if (!code) throw new AdminRegistrationInvitationError()
  await ensureSchema()
  const codeHash = hashAdminInviteCode(code)
  const result = await query<{ id: string }>(
    `select id from admin_registration_invitations
      where code_hash = $1 and consumed_at is null and revoked_at is null and expires_at > $2`,
    [codeHash, now.toISOString()],
  )
  if (!result.rows[0]) throw new AdminRegistrationInvitationError()
  return { id: result.rows[0].id, codeHash }
}

export async function consumeAdminRegistrationInvitationInTransaction(
  client: PoolClient,
  invitation: ValidatedAdminRegistrationInvitation,
  userId: string,
  now = new Date(),
): Promise<void> {
  const result = await client.query(
    `update admin_registration_invitations
        set consumed_at = $3, consumed_by_user_id = $2
      where id = $1 and code_hash = $4 and consumed_at is null and revoked_at is null and expires_at > $3`,
    [invitation.id, userId, now.toISOString(), invitation.codeHash],
  )
  if (result.rowCount !== 1) throw new AdminRegistrationInvitationError()
  const nowIso = now.toISOString()
  await client.query(
    `insert into admin_invitation_verification_outbox
      (id, invitation_id, user_id, status, attempts, next_attempt_at, created_at, updated_at)
     values ($1, $2, $3, 'pending', 0, $4, $4, $4)
     on conflict (invitation_id) do nothing`,
    [randomUUID(), invitation.id, userId, nowIso],
  )
}

export async function processAdminInvitationVerificationOutboxBatch(
  deliver: (userId: string) => Promise<boolean>,
  limit = 20,
): Promise<number> {
  await ensureSchema()
  let processed = 0
  for (let index = 0; index < Math.max(1, Math.min(limit, 100)); index += 1) {
    const claimed = await claimVerificationOutbox()
    if (!claimed) break
    try {
      await deliver(claimed.user_id)
      await query(
        `update admin_invitation_verification_outbox
            set status = 'sent', lease_token = null, lease_expires_at = null,
                last_error = null, updated_at = $3
          where id = $1 and status = 'processing' and lease_token = $2`,
        [claimed.id, claimed.lease_token, new Date().toISOString()],
      )
    } catch (error) {
      await releaseVerificationOutbox(claimed, error)
    }
    processed += 1
  }
  return processed
}

async function claimVerificationOutbox(now = new Date()): Promise<{
  id: string
  user_id: string
  attempts: number
  lease_token: string
} | null> {
  const nowIso = now.toISOString()
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + VERIFICATION_OUTBOX_LEASE_MS).toISOString()
  return withTransaction(async (client) => {
    await client.query(
      `update admin_invitation_verification_outbox
          set status = 'dead_letter', lease_token = null, lease_expires_at = null,
              last_error = coalesce(last_error, 'Verification outbox lease expired after final attempt'),
              updated_at = $1
        where status = 'processing' and lease_expires_at <= $1 and attempts >= $2`,
      [nowIso, MAX_VERIFICATION_OUTBOX_ATTEMPTS],
    )
    const result = await client.query<{
      id: string
      user_id: string
      attempts: number
      lease_token: string
    }>(
      `with candidate as (
         select id
           from admin_invitation_verification_outbox
          where attempts < $2
            and ((status = 'pending' and next_attempt_at <= $1)
              or (status = 'processing' and lease_expires_at <= $1))
          order by next_attempt_at asc, created_at asc
          for update skip locked
          limit 1
       )
       update admin_invitation_verification_outbox outbox
          set status = 'processing', attempts = outbox.attempts + 1,
              lease_token = $3, lease_expires_at = $4, updated_at = $1
         from candidate
        where outbox.id = candidate.id
        returning outbox.id, outbox.user_id, outbox.attempts, outbox.lease_token`,
      [nowIso, MAX_VERIFICATION_OUTBOX_ATTEMPTS, leaseToken, leaseExpiresAt],
    )
    return result.rows[0] ?? null
  })
}

async function releaseVerificationOutbox(
  claimed: { id: string; attempts: number; lease_token: string },
  error: unknown,
  now = new Date(),
): Promise<void> {
  const deadLettered = claimed.attempts >= MAX_VERIFICATION_OUTBOX_ATTEMPTS
  const nowIso = now.toISOString()
  const nextAttemptAt = new Date(
    now.getTime() + Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, claimed.attempts - 1)),
  ).toISOString()
  await query(
    `update admin_invitation_verification_outbox
        set status = $3, next_attempt_at = $4, lease_token = null, lease_expires_at = null,
            last_error = $5, updated_at = $6
      where id = $1 and status = 'processing' and lease_token = $2`,
    [
      claimed.id, claimed.lease_token, deadLettered ? 'dead_letter' : 'pending', nextAttemptAt,
      safeErrorSummary(error), nowIso,
    ],
  )
}

export async function saveRegistrationWithAdminInvitation(
  saveUser: (client: PoolClient) => Promise<void>,
  invitation: ValidatedAdminRegistrationInvitation,
  userId: string,
  now = new Date(),
): Promise<void> {
  await ensureSchema()
  await withTransaction(async (client) => {
    await saveUser(client)
    await consumeAdminRegistrationInvitationInTransaction(client, invitation, userId, now)
  })
}

export async function userRegisteredWithAdminInvitation(userId: string): Promise<boolean> {
  await ensureSchema()
  const result = await query<{ matched: boolean }>(
    'select exists (select 1 from admin_registration_invitations where consumed_by_user_id = $1) as matched',
    [userId],
  )
  return result.rows[0]?.matched === true
}

export async function listAdminRegistrationInvitations(options: {
  page: number
  pageSize: number
  status: AdminRegistrationInvitationStatus | 'all'
  now?: Date
}): Promise<{ records: AdminRegistrationInvitation[]; total: number; page: number }> {
  await ensureSchema()
  const now = options.now ?? new Date()
  const where = statusSql(options.status)
  const countResult = await query<{ count: string }>(
    `select count(*)::text as count from admin_registration_invitations invitation where ${where}`,
    [now.toISOString()],
  )
  const total = Number(countResult.rows[0]?.count ?? 0)
  const totalPages = total === 0 ? 0 : Math.ceil(total / options.pageSize)
  const page = totalPages === 0 ? 1 : Math.min(options.page, totalPages)
  const result = await query<AdminRegistrationInvitationRow>(
    `${adminInvitationSelect()}
      where ${where}
      order by invitation.created_at desc, invitation.id asc
      limit $2 offset $3`,
    [now.toISOString(), options.pageSize, (page - 1) * options.pageSize],
  )
  return { records: result.rows.map((row) => toPublicInvitation(row, now)), total, page }
}

export async function revokeAdminRegistrationInvitation(input: {
  invitationId: string
  adminUsername: string
  reason: string
  now?: Date
}): Promise<AdminRegistrationInvitation | null> {
  await ensureSchema()
  const now = input.now ?? new Date()
  return withTransaction(async (client) => {
    const currentResult = await client.query<AdminRegistrationInvitationRow>(
      `${adminInvitationSelect()}
        where invitation.id = $1
        for update of invitation`,
      [input.invitationId],
    )
    const current = currentResult.rows[0]
    if (!current || current.consumed_at || Date.parse(current.expires_at) <= now.getTime()) return null
    if (current.revoked_at) return toPublicInvitation(current, now)
    const nowIso = now.toISOString()
    const requestHash = hashOperation({
      action: 'revoke',
      invitation_id: input.invitationId,
      admin_username: input.adminUsername,
      reason: input.reason,
    })
    const result = await client.query<AdminRegistrationInvitationRow>(
      `update admin_registration_invitations invitation
          set revoked_at = $2, revoked_by = $3, revoke_reason = $4,
              code_ciphertext = null, code_iv = null, code_auth_tag = null
        where id = $1
        returning invitation.id, invitation.created_at::text, invitation.expires_at::text,
                  invitation.consumed_at::text, invitation.revoked_at::text,
                  invitation.consumed_by_user_id, null::text as consumed_by_email,
                  invitation.created_by, invitation.create_reason, invitation.revoked_by, invitation.revoke_reason,
                  null::text as email_verified_at, null::text as delivery_status, null::text as outbox_status`,
      [input.invitationId, nowIso, input.adminUsername, input.reason],
    )
    const row = result.rows[0]
    if (!row) return null
    await insertAudit(client, {
      invitationId: input.invitationId,
      adminUsername: input.adminUsername,
      action: 'revoke',
      reason: input.reason,
      requestHash,
      before: toPublicInvitation(current, now),
      after: toPublicInvitation(row, now),
      now: nowIso,
    })
    return toPublicInvitation(row, now)
  })
}

export async function recordAdminInvitationVerificationResend(
  invitationId: string,
  adminUsername: string,
  reason: string,
  now = new Date(),
): Promise<string | null> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const result = await client.query<{ consumed_by_user_id: string | null; email_verified_at: string | null }>(
      `select invitation.consumed_by_user_id, account.email_verified_at::text
         from admin_registration_invitations invitation
         left join user_accounts account on account.id = invitation.consumed_by_user_id
        where invitation.id = $1
        for update of invitation`,
      [invitationId],
    )
    const row = result.rows[0]
    if (!row?.consumed_by_user_id || row.email_verified_at) return null
    const nowIso = now.toISOString()
    await client.query(
      `update admin_invitation_verification_outbox
          set status = 'pending', attempts = 0, next_attempt_at = $2,
              lease_token = null, lease_expires_at = null, last_error = null, updated_at = $2
        where invitation_id = $1`,
      [invitationId, nowIso],
    )
    const requestHash = hashOperation({
      action: 'resend_verification', invitation_id: invitationId, admin_username: adminUsername, reason,
    })
    await insertAudit(client, {
      invitationId,
      adminUsername,
      action: 'resend_verification',
      reason,
      requestHash,
      before: null,
      after: { user_id: row.consumed_by_user_id, requested_at: nowIso },
      now: nowIso,
    })
    return row.consumed_by_user_id
  })
}

function adminInvitationSelect(): string {
  return `select invitation.id, invitation.created_at::text, invitation.expires_at::text,
                 invitation.consumed_at::text, invitation.revoked_at::text,
                 invitation.consumed_by_user_id, account.email as consumed_by_email,
                 invitation.created_by, invitation.create_reason,
                 invitation.revoked_by, invitation.revoke_reason,
                 account.email_verified_at::text,
                 latest_delivery.status as delivery_status,
                 verification_outbox.status as outbox_status,
                 invitation.request_hash, invitation.code_ciphertext, invitation.code_iv,
                 invitation.code_auth_tag, invitation.code_recoverable_until::text
            from admin_registration_invitations invitation
            left join user_accounts account on account.id = invitation.consumed_by_user_id
            left join admin_invitation_verification_outbox verification_outbox
              on verification_outbox.invitation_id = invitation.id
            left join lateral (
              select delivery.status
                from email_verification_tokens token
                left join brevo_email_deliveries delivery on delivery.id = token.delivery_id
               where token.user_id = invitation.consumed_by_user_id
               order by token.created_at desc
               limit 1
            ) latest_delivery on true`
}

function statusSql(status: AdminRegistrationInvitationStatus | 'all'): string {
  if (status === 'active') return 'invitation.consumed_at is null and invitation.revoked_at is null and invitation.expires_at > $1'
  if (status === 'used') return '$1::timestamptz is not null and invitation.consumed_at is not null'
  if (status === 'revoked') return '$1::timestamptz is not null and invitation.revoked_at is not null'
  if (status === 'expired') return 'invitation.consumed_at is null and invitation.revoked_at is null and invitation.expires_at <= $1'
  return '$1::timestamptz is not null'
}

function toPublicInvitation(row: AdminRegistrationInvitationRow, now: Date): AdminRegistrationInvitation {
  return {
    id: row.id,
    status: invitationStatus(row, now),
    created_at: row.created_at,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at,
    revoked_at: row.revoked_at,
    consumed_by_user_id: row.consumed_by_user_id,
    consumed_by_email: row.consumed_by_email,
    created_by: row.created_by,
    create_reason: row.create_reason,
    revoked_by: row.revoked_by,
    revoke_reason: row.revoke_reason,
    verification_status: verificationStatus(row),
  }
}

function verificationStatus(row: AdminRegistrationInvitationRow): AdminRegistrationInvitation['verification_status'] {
  if (!row.consumed_by_user_id) return 'not_applicable'
  if (row.email_verified_at) return 'verified'
  if (row.outbox_status === 'dead_letter') return 'failed'
  if (row.delivery_status === 'sent' || row.delivery_status === 'failed' || row.delivery_status === 'uncertain') {
    return row.delivery_status
  }
  return 'pending'
}

function invitationStatus(row: AdminRegistrationInvitationRow, now: Date): AdminRegistrationInvitationStatus {
  if (row.consumed_at) return 'used'
  if (row.revoked_at) return 'revoked'
  if (Date.parse(row.expires_at) <= now.getTime()) return 'expired'
  return 'active'
}

function createAdminInviteCode(): string {
  const bytes = randomBytes(ADMIN_INVITE_LENGTH)
  let code = ''
  for (const value of bytes) code += ADMIN_INVITE_ALPHABET[value % ADMIN_INVITE_ALPHABET.length]
  return code
}

function hashAdminInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function hashOperation(value: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function safeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update('admin-registration-invitation:v1\0').update(secret).digest()
}

function encryptAdminInviteCode(code: string, secret: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  }
}

function decryptAdminInviteCode(row: AdminRegistrationInvitationRow, secret: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(row.code_iv!, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(row.code_auth_tag!, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(row.code_ciphertext!, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

async function insertAudit(client: PoolClient, input: {
  invitationId: string
  adminUsername: string
  action: 'create' | 'revoke' | 'resend_verification'
  reason: string
  requestHash: string
  before: unknown
  after: unknown
  now: string
}): Promise<void> {
  await client.query(
    `insert into admin_registration_invitation_audit
      (id, invitation_id, admin_username, action, reason, request_hash, before_json, after_json, created_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      randomUUID(), input.invitationId, input.adminUsername, input.action, input.reason, input.requestHash,
      input.before === null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after), input.now,
    ],
  )
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
