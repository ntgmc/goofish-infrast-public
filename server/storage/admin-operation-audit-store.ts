import type { AdminAuditDetail, AdminAuditFilters, AdminAuditPage, AdminAuditSource } from '../../src/lib/admin-audit-contracts'
import { buildAdminPagination } from '../handlers/admin-pagination'
import type { QueryClient } from './postgres'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from './postgres'
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

// Keep source IDs distinct: legacy audit tables can contain the same ID.
const auditSql = `select 'admin'::text as source, id, actor_username, action, target_type, target_id,
    reason, request_id, client_ip, before_json, after_json, null::jsonb as context_json, created_at
  from admin_operation_audit
  union all
  select 'inventory', id, admin_username, action, target_type, target_id,
    reason, null, null, before_json, after_json, null::jsonb, created_at
  from inventory_admin_audit
  union all
  select 'risk_review', id, admin_username, 'risk.review.' || outcome, 'risk_case',
    coalesce(case_id, case_snapshot_json->>'id', id), note, null, null, null::jsonb, null::jsonb,
    jsonb_build_object('case_snapshot', case_snapshot_json, 'actions', actions_json,
      'outcome', outcome, 'integrity_hash', entry_hash, 'previous_hash', previous_hash), created_at
  from behavior_risk_review_audit
  union all
  select 'risk_access', id, admin_username, action, 'admin_capability', capability,
    reason, request_id, null, null::jsonb, null::jsonb,
    jsonb_build_object('decision', decision, 'capability', capability), created_at
  from behavior_risk_admin_audit
  union all
  select 'risk_settings', id, admin_username, 'risk.settings.update', 'risk_settings', settings_key,
    reason, request_id, null, before_json, after_json,
    jsonb_build_object('integrity_hash', entry_hash, 'previous_hash', previous_hash), created_at
  from risk_settings_audit
  union all
  select 'registration', id, admin_username, 'registration_invitation.' || action, 'registration_invitation', invitation_id,
    reason, null, null, before_json, after_json, null::jsonb, created_at
  from admin_registration_invitation_audit
  union all
  select 'commercial', id, actor_username, 'commercial.limits.update', 'user', user_id,
    reason, request_id, null, before_json, after_json, jsonb_build_object('approved_by', approved_by), created_at
  from commercial_account_audit
  union all
  select 'balance', id, admin_username, 'balance.' || kind, 'user', user_id,
    coalesce(reason, '未记录原因'), null, null,
    jsonb_build_object('balance', (balance_after - amount)::text), jsonb_build_object('balance', balance_after::text),
    jsonb_build_object('amount', amount::text, 'approved_by', approved_by,
      'reference_type', reference_type, 'reference_id', reference_id), created_at
  from user_balance_transactions where admin_username is not null and kind in ('admin_credit', 'admin_debit', 'admin_credit_reversal')`
const summaryColumns = 'source, id, actor_username, action, target_type, target_id, reason, request_id, created_at::text as created_at'

export async function listAdminOperationAudits(page: number, pageSize: number, filters: AdminAuditFilters): Promise<AdminAuditPage> {
  await ensureSchema()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const params: unknown[] = []
    const conditions: string[] = []
    for (const [field, value] of Object.entries({ actor_username: filters.actor, action: filters.action,
      target_type: filters.target_type, target_id: filters.target_id, request_id: filters.request_id })) {
      if (value) { params.push(value); conditions.push(`${field} = $${params.length}`) }
    }
    if (filters.from) { params.push(filters.from); conditions.push(`created_at >= $${params.length}::timestamptz`) }
    if (filters.to) { params.push(filters.to); conditions.push(`created_at <= $${params.length}::timestamptz`) }
    if (filters.related_source && filters.related_id) {
      const origin = await client.query<Pick<AdminAuditDetail, 'target_type' | 'target_id' | 'request_id'>>(
        `with audits as (${auditSql}) select target_type, target_id, request_id from audits where source = $1 and id = $2`,
        [filters.related_source, filters.related_id],
      )
      if (!origin.rows[0]) return { items: [], pagination: buildAdminPagination(page, pageSize, 0) }
      const target = origin.rows[0]
      params.push(filters.related_source, filters.related_id, target.target_type, target.target_id, target.request_id || null)
      const index = params.length
      conditions.push(`not (source = $${index - 4} and id = $${index - 3})
        and ((target_type = $${index - 2} and target_id = $${index - 1}) or request_id = $${index})`)
    }
    const where = conditions.length ? `where ${conditions.join(' and ')}` : ''
    const count = await client.query<{ total: string }>(`with audits as (${auditSql}) select count(*)::text as total from audits ${where}`, params)
    const pagination = buildAdminPagination(page, pageSize, Number(count.rows[0]!.total))
    const result = await client.query<AdminAuditPage['items'][number]>(`with audits as (${auditSql})
      select ${summaryColumns} from audits ${where} order by audits.created_at desc, source desc, id desc
      limit $${params.length + 1} offset $${params.length + 2}`, [...params, pagination.page_size, (pagination.page - 1) * pagination.page_size])
    return { items: result.rows, pagination }
  })
}

export async function getAdminOperationAudit(source: AdminAuditSource, id: string): Promise<AdminAuditDetail | null> {
  await ensureSchema()
  const result = await query<AdminAuditDetail>(`with audits as (${auditSql})
    select ${summaryColumns}, client_ip, before_json, after_json, context_json from audits where source = $1 and id = $2`, [source, id])
  return result.rows[0] ?? null
}

export async function recordAdminOperationAudit(input: AdminOperationAuditInput): Promise<void> {
  await ensureSchema()
  await insertAdminOperationAudit({ query }, input)
}

export async function recordAdminOperationAuditInTransaction(
  client: QueryClient,
  input: AdminOperationAuditInput,
): Promise<void> {
  await insertAdminOperationAudit(client, input)
}

async function insertAdminOperationAudit(
  client: QueryClient,
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
