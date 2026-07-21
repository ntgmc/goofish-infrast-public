import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { AdminRegistrationInvitation, AdminRegistrationInvitationStatus } from '../../src/lib/types'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'

const ADMIN_INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ADMIN_INVITE_LENGTH = 16
const ADMIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_GENERATION_ATTEMPTS = 10

interface AdminRegistrationInvitationRow {
  id: string
  created_at: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  consumed_by_user_id: string | null
  consumed_by_email: string | null
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

let schemaReady: Promise<void> | null = null

export function normalizeAdminRegistrationInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code) ? code : null
}

export async function createAdminRegistrationInvitation(now = new Date()): Promise<{
  invitation: AdminRegistrationInvitation
  code: string
}> {
  await ensureSchema()
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = createAdminInviteCode()
    const id = randomUUID()
    const createdAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ADMIN_INVITE_TTL_MS).toISOString()
    const inserted = await query<AdminRegistrationInvitationRow>(
      `insert into admin_registration_invitations
        (id, code_hash, created_at, expires_at, consumed_at, consumed_by_user_id, revoked_at)
       values ($1, $2, $3, $4, null, null, null)
       on conflict (code_hash) do nothing
       returning id, created_at::text, expires_at::text, consumed_at::text, revoked_at::text,
                 consumed_by_user_id, null::text as consumed_by_email`,
      [id, hashAdminInviteCode(code), createdAt, expiresAt],
    )
    if (inserted.rows[0]) return { invitation: toPublicInvitation(inserted.rows[0], now), code }
  }
  throw new Error('生成管理员邀请码失败，请重试。')
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
}

export async function saveRegistrationWithAdminInvitation(
  saveUser: (client: PoolClient) => Promise<void>,
  invitation: ValidatedAdminRegistrationInvitation,
  userId: string,
): Promise<void> {
  await ensureSchema()
  await withTransaction(async (client) => {
    await saveUser(client)
    await consumeAdminRegistrationInvitationInTransaction(client, invitation, userId)
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
    `select invitation.id, invitation.created_at::text, invitation.expires_at::text,
            invitation.consumed_at::text, invitation.revoked_at::text,
            invitation.consumed_by_user_id, account.email as consumed_by_email
       from admin_registration_invitations invitation
       left join user_accounts account on account.id = invitation.consumed_by_user_id
      where ${where}
      order by invitation.created_at desc, invitation.id asc
      limit $2 offset $3`,
    [now.toISOString(), options.pageSize, (page - 1) * options.pageSize],
  )
  return { records: result.rows.map((row) => toPublicInvitation(row, now)), total, page }
}

export async function revokeAdminRegistrationInvitation(id: string, now = new Date()): Promise<AdminRegistrationInvitation | null> {
  await ensureSchema()
  const result = await query<AdminRegistrationInvitationRow>(
    `update admin_registration_invitations invitation
        set revoked_at = coalesce(revoked_at, $2)
      where id = $1 and consumed_at is null and expires_at > $2
      returning invitation.id, invitation.created_at::text, invitation.expires_at::text,
                invitation.consumed_at::text, invitation.revoked_at::text,
                invitation.consumed_by_user_id, null::text as consumed_by_email`,
    [id, now.toISOString()],
  )
  return result.rows[0] ? toPublicInvitation(result.rows[0], now) : null
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
  }
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

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
