import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import {
  CURRENT_PERSONAL_USE_DECLARATION,
  isCurrentPersonalUseDeclarationEffective,
  type PersonalUseDeclarationAction,
} from '../personal-use-declaration'
import type { PersonalUseDeclarationUsageAction } from '../../src/lib/personal-use-declaration'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

type DatabaseClient = Pick<PoolClient, 'query'>

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

export interface PersonalUseDeclarationUsageEvent {
  id: string
  acceptance_id: string
  user_id: string
  profile_id: string | null
  declaration_id: string
  declaration_version: string
  content_hash: string
  action: PersonalUseDeclarationUsageAction
  client_ip: string
  acceptance_accepted_at: string
  occurred_at: string
  account_deleted_at: string | null
  retain_until: string | null
}

export class PersonalUseDeclarationRequiredError extends Error {
  readonly code = 'personal_use_declaration_required'
  readonly status = 428

  constructor() {
    super('请先确认当前版本的个人使用声明。')
    this.name = 'PersonalUseDeclarationRequiredError'
  }
}

export async function getPersonalUseDeclarationAcceptance(userId: string): Promise<PersonalUseDeclarationAcceptance | null> {
  await ensureDatabaseSchema()
  return getCurrentPersonalUseDeclarationAcceptance({ query }, userId)
}

export async function requireCurrentPersonalUseAcceptanceInTransaction(
  client: DatabaseClient,
  userId: string,
): Promise<PersonalUseDeclarationAcceptance | null> {
  if (!isCurrentPersonalUseDeclarationEffective()) return null
  const acceptance = await getCurrentPersonalUseDeclarationAcceptance(client, userId, true)
  if (!acceptance) throw new PersonalUseDeclarationRequiredError()
  return acceptance
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
  return withTransaction(async (client) => {
    await client.query(
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
    const acceptance = await getCurrentPersonalUseDeclarationAcceptance(client, userId, true)
    if (!acceptance) {
      throw new Error('现有个人使用声明确认记录与当前版本或内容哈希不一致。')
    }
    return acceptance
  })
}

export async function attachPersonalUseDeclarationAcceptanceToProfileInTransaction(
  client: DatabaseClient,
  userId: string,
  profileId: string,
): Promise<void> {
  await client.query(
    `update personal_use_declaration_acceptances
     set profile_id = $2
     where user_id = $1
       and declaration_id = $3
       and profile_id is null`,
    [userId, profileId, CURRENT_PERSONAL_USE_DECLARATION.id],
  )
}

export async function recordPersonalUseDeclarationUsage(input: {
  userId: string
  profileId: string | null
  action: PersonalUseDeclarationUsageAction
  clientIp: string
  occurredAt?: Date
}): Promise<PersonalUseDeclarationUsageEvent | null> {
  await ensureDatabaseSchema()
  return withTransaction((client) => recordPersonalUseDeclarationUsageInTransaction(client, input))
}

export async function recordPersonalUseDeclarationUsageInTransaction(
  client: DatabaseClient,
  input: {
    userId: string
    profileId: string | null
    action: PersonalUseDeclarationUsageAction
    clientIp: string
    occurredAt?: Date
  },
): Promise<PersonalUseDeclarationUsageEvent | null> {
  const acceptance = await requireCurrentPersonalUseAcceptanceInTransaction(client, input.userId)
  if (!acceptance) return null
  const event: PersonalUseDeclarationUsageEvent = {
    id: randomUUID(),
    acceptance_id: acceptance.id,
    user_id: input.userId,
    profile_id: input.profileId,
    declaration_id: acceptance.declaration_id,
    declaration_version: acceptance.declaration_version,
    content_hash: acceptance.content_hash,
    action: input.action,
    client_ip: input.clientIp,
    acceptance_accepted_at: acceptance.accepted_at,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    account_deleted_at: null,
    retain_until: null,
  }
  await client.query(
    `insert into personal_use_declaration_usage_events
      (id, acceptance_id, user_id, profile_id, declaration_id, declaration_version, content_hash,
       action, client_ip, acceptance_accepted_at, occurred_at, account_deleted_at, retain_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null, null)`,
    [
      event.id,
      event.acceptance_id,
      event.user_id,
      event.profile_id,
      event.declaration_id,
      event.declaration_version,
      event.content_hash,
      event.action,
      event.client_ip,
      event.acceptance_accepted_at,
      event.occurred_at,
    ],
  )
  return event
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
  return result.rows.map(normalizeAcceptanceTimestamps)
}

export async function listPersonalUseDeclarationUsageEventsForUser(userId: string): Promise<PersonalUseDeclarationUsageEvent[]> {
  await ensureDatabaseSchema()
  const result = await query<PersonalUseDeclarationUsageEvent>(
    `select id, acceptance_id, user_id, profile_id, declaration_id, declaration_version, content_hash,
            action, client_ip, acceptance_accepted_at, occurred_at, account_deleted_at, retain_until
       from personal_use_declaration_usage_events
      where user_id = $1
      order by occurred_at desc`,
    [userId],
  )
  return result.rows.map(normalizeUsageEventTimestamps)
}

export async function markPersonalUseDeclarationAcceptancesDeleted(
  client: DatabaseClient,
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
  await client.query(
    `update personal_use_declaration_usage_events
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

async function getCurrentPersonalUseDeclarationAcceptance(
  client: DatabaseClient,
  userId: string,
  lock = false,
): Promise<PersonalUseDeclarationAcceptance | null> {
  const result = await client.query<PersonalUseDeclarationAcceptance>(
    `select acceptance.id, acceptance.user_id, acceptance.profile_id, acceptance.declaration_id,
            acceptance.declaration_version, acceptance.content_hash, acceptance.action,
            acceptance.client_ip, acceptance.accepted_at, acceptance.account_deleted_at,
            acceptance.retain_until
       from personal_use_declaration_acceptances acceptance
       join personal_use_declaration_versions declaration
         on declaration.declaration_id = acceptance.declaration_id
        and declaration.display_version = acceptance.declaration_version
        and declaration.content_hash = acceptance.content_hash
      where acceptance.user_id = $1
        and acceptance.declaration_id = $2
        and acceptance.declaration_version = $3
        and acceptance.content_hash = $4
      ${lock ? 'for share of acceptance' : ''}`,
    [
      userId,
      CURRENT_PERSONAL_USE_DECLARATION.id,
      CURRENT_PERSONAL_USE_DECLARATION.version,
      CURRENT_PERSONAL_USE_DECLARATION.contentHash,
    ],
  )
  return result.rows[0] ? normalizeAcceptanceTimestamps(result.rows[0]) : null
}

function normalizeAcceptanceTimestamps(
  acceptance: PersonalUseDeclarationAcceptance,
): PersonalUseDeclarationAcceptance {
  return {
    ...acceptance,
    accepted_at: toIsoTimestamp(acceptance.accepted_at),
    account_deleted_at: acceptance.account_deleted_at ? toIsoTimestamp(acceptance.account_deleted_at) : null,
    retain_until: acceptance.retain_until ? toIsoTimestamp(acceptance.retain_until) : null,
  }
}

function normalizeUsageEventTimestamps(event: PersonalUseDeclarationUsageEvent): PersonalUseDeclarationUsageEvent {
  return {
    ...event,
    acceptance_accepted_at: toIsoTimestamp(event.acceptance_accepted_at),
    occurred_at: toIsoTimestamp(event.occurred_at),
    account_deleted_at: event.account_deleted_at ? toIsoTimestamp(event.account_deleted_at) : null,
    retain_until: event.retain_until ? toIsoTimestamp(event.retain_until) : null,
  }
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
