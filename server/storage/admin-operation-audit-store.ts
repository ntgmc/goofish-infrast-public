import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

export interface AdminOperationAuditInput {
  actorUsername: string
  action: string
  targetType: string
  targetId: string
  reason: string
  requestId: string
  clientIp?: string | null
  before?: unknown
  after?: unknown
  createdAt?: string
}

let schemaReady: Promise<void> | null = null

export async function recordAdminOperationAudit(input: AdminOperationAuditInput): Promise<void> {
  await ensureSchema()
  await insertAdminOperationAudit({ query }, input)
}

export async function recordAdminOperationAuditInTransaction(
  client: PoolClient,
  input: AdminOperationAuditInput,
): Promise<void> {
  await insertAdminOperationAudit(client, input)
}

async function insertAdminOperationAudit(
  client: Pick<PoolClient, 'query'>,
  input: AdminOperationAuditInput,
): Promise<void> {
  const reason = input.reason.trim()
  if (reason.length < 2 || reason.length > 500) {
    throw new Error('Admin operation audit reason must contain 2-500 characters.')
  }
  await client.query(
    `insert into admin_operation_audit
      (id, actor_username, action, target_type, target_id, reason, request_id,
       client_ip, before_json, after_json, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
    [
      randomUUID(),
      input.actorUsername,
      input.action,
      input.targetType,
      input.targetId,
      reason,
      input.requestId,
      input.clientIp ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.createdAt ?? new Date().toISOString(),
    ],
  )
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = ensureDatabaseSchema()
  await schemaReady
}
