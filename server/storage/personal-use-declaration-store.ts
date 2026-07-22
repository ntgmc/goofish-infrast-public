import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { CURRENT_PERSONAL_USE_DECLARATION, type PersonalUseDeclarationAction } from '../personal-use-declaration'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

export interface PersonalUseDeclarationAcceptance {
  id: string
  user_id: string
  profile_id: string | null
  declaration_id: string
  declaration_version: string
  content_hash: string
  action: PersonalUseDeclarationAction
  client_ip: string
  accepted_at: string
  account_deleted_at: string | null
  retain_until: string | null
}

export async function getPersonalUseDeclarationAcceptance(userId: string): Promise<PersonalUseDeclarationAcceptance | null> {
  await ensureDatabaseSchema()
  const result = await query<PersonalUseDeclarationAcceptance>(
    `select id, user_id, profile_id, declaration_id, declaration_version, content_hash, action, client_ip, accepted_at, account_deleted_at, retain_until
     from personal_use_declaration_acceptances
     where user_id = $1 and declaration_id = $2`,
    [userId, CURRENT_PERSONAL_USE_DECLARATION.id],
  )
  return result.rows[0] ?? null
}

export async function confirmPersonalUseDeclaration(
  userId: string,
  action: PersonalUseDeclarationAction,
  clientIp: string,
  profileId: string | null = null,
  now = new Date(),
): Promise<PersonalUseDeclarationAcceptance> {
  await ensureDatabaseSchema()
  const acceptedAt = now.toISOString()
  await query(
    `insert into personal_use_declaration_acceptances
      (id, user_id, profile_id, declaration_id, declaration_version, content_hash, action, client_ip, accepted_at, account_deleted_at, retain_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, null)
     on conflict (user_id, declaration_id) do nothing`,
    [
      randomUUID(),
      userId,
      profileId,
      CURRENT_PERSONAL_USE_DECLARATION.id,
      CURRENT_PERSONAL_USE_DECLARATION.version,
      CURRENT_PERSONAL_USE_DECLARATION.contentHash,
      action,
      clientIp,
      acceptedAt,
    ],
  )
  const acceptance = await getPersonalUseDeclarationAcceptance(userId)
  if (!acceptance) throw new Error('个人使用声明确认记录未创建。')
  return acceptance
}

export async function attachPersonalUseDeclarationAcceptanceToProfile(userId: string, profileId: string): Promise<void> {
  await ensureDatabaseSchema()
  await query(
    `update personal_use_declaration_acceptances
     set profile_id = $2
     where user_id = $1
       and declaration_id = $3
       and profile_id is null`,
    [userId, profileId, CURRENT_PERSONAL_USE_DECLARATION.id],
  )
}

export async function listPersonalUseDeclarationAcceptancesForUser(userId: string): Promise<PersonalUseDeclarationAcceptance[]> {
  await ensureDatabaseSchema()
  const result = await query<PersonalUseDeclarationAcceptance>(
    `select id, user_id, profile_id, declaration_id, declaration_version, content_hash, action, client_ip, accepted_at, account_deleted_at, retain_until
     from personal_use_declaration_acceptances
     where user_id = $1
     order by accepted_at desc`,
    [userId],
  )
  return result.rows
}

export async function markPersonalUseDeclarationAcceptancesDeleted(
  client: Pick<PoolClient, 'query'>,
  userId: string,
  deletedAt = new Date(),
): Promise<void> {
  const retainUntil = new Date(deletedAt.getTime())
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + 1)
  await client.query(
    `update personal_use_declaration_acceptances
     set account_deleted_at = $2,
         retain_until = $3
     where user_id = $1
       and account_deleted_at is null`,
    [userId, deletedAt.toISOString(), retainUntil.toISOString()],
  )
}

export async function purgeExpiredPersonalUseDeclarationAcceptances(now = new Date()): Promise<number> {
  await ensureDatabaseSchema()
  const result = await query(
    `delete from personal_use_declaration_acceptances
     where retain_until is not null and retain_until <= $1`,
    [now.toISOString()],
  )
  return result.rowCount ?? 0
}
