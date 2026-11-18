import type { AdminAiUsageDetail, AdminAiUsagePage, AiUsageFilters, AiUsageRecord, AiUsageTotals } from '../../src/lib/ai-usage'
import { buildAdminPagination } from '../handlers/admin-pagination'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

const recordColumns = `id, user_id, profile_id, result_id, status, created_at, settled_at, duration_ms,
  cost_micro_cny::float8, reserved_micro_cny::float8, cost_basis, pricing, usage,
  cost_breakdown as breakdown, provider_request_id, error_code`
const totalsSql = `count(*)::int as requests,
  count(*) filter (where status = 'succeeded')::int as succeeded,
  count(*) filter (where status = 'failed')::int as failed,
  count(*) filter (where status = 'pending')::int as pending,
  count(usage)::int as metered_requests,
  count(*) filter (where usage->>'cached_input_tokens' is not null)::int as cache_reported_requests,
  coalesce(sum((usage->>'input_tokens')::bigint), 0)::float8 as input_tokens,
  coalesce(sum((usage->>'output_tokens')::bigint), 0)::float8 as output_tokens,
  coalesce(sum((usage->>'cached_input_tokens')::bigint), 0)::float8 as cached_input_tokens,
  coalesce(sum((usage->>'cache_write_tokens')::bigint), 0)::float8 as cache_write_tokens,
  coalesce(sum(cost_micro_cny), 0)::float8 as cost_micro_cny,
  coalesce(sum(cost_micro_cny) filter (where cost_basis = 'usage'), 0)::float8 as usage_cost_micro_cny,
  coalesce(sum(cost_micro_cny) filter (where cost_basis = 'estimated'), 0)::float8 as estimated_cost_micro_cny,
  coalesce(sum(cost_micro_cny) filter (where cost_basis in ('reserved', 'legacy')), 0)::float8 as reserved_cost_micro_cny,
  sum((cost_breakdown->>'input')::numeric) filter (where cost_basis = 'usage')::float8 as input_cost_micro_cny,
  sum((cost_breakdown->>'cached_input')::numeric) filter (where usage->>'cached_input_tokens' is not null)::float8 as cached_input_cost_micro_cny,
  sum((cost_breakdown->>'cache_write_5m')::numeric + (cost_breakdown->>'cache_write_1h')::numeric)::float8 as cache_write_cost_micro_cny,
  sum((cost_breakdown->>'output')::numeric)::float8 as output_cost_micro_cny`
type StoredRecord = Omit<AiUsageRecord, 'created_at' | 'settled_at'> & { created_at: Date; settled_at: Date | null }

export async function listAiUsage(page: number, pageSize: number, filters: AiUsageFilters): Promise<AdminAiUsagePage> {
  await ensureDatabaseSchema()
  const values: string[] = []
  const conditions = ['true']
  for (const [field, value] of Object.entries(filters)) {
    if (!value) continue
    values.push(value)
    if (field === 'from') conditions.push(`created_at >= $${values.length}::timestamptz`)
    else if (field === 'to') conditions.push(`created_at <= $${values.length}::timestamptz`)
    else if (field === 'provider' || field === 'model') conditions.push(`pricing->>'${field}' = $${values.length}`)
    else if (field === 'status' || field === 'user_id') conditions.push(`${field} = $${values.length}`)
  }
  const where = `where ${conditions.join(' and ')}`
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const total = await client.query<AiUsageTotals>(`select ${totalsSql} from ai_schedule_usage ${where}`, values)
    const totals = total.rows[0]
    const pagination = buildAdminPagination(page, pageSize, totals.requests)
    const rows = await client.query<StoredRecord>(`select ${recordColumns} from ai_schedule_usage ${where}
      order by created_at desc, id desc limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, pageSize, (pagination.page - 1) * pageSize])
    const daily = await client.query<AdminAiUsagePage['daily'][number]>(`select
      to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day, ${totalsSql}
      from ai_schedule_usage ${where} group by day order by day desc`, values)
    const models = await client.query<AdminAiUsagePage['models'][number]>(`select
      pricing->>'provider' as provider, pricing->>'model' as model, pricing->>'protocol' as protocol, ${totalsSql}
      from ai_schedule_usage ${where} group by pricing->>'provider', pricing->>'model', pricing->>'protocol'
      order by cost_micro_cny desc, provider nulls last, model nulls last, protocol nulls last`, values)
    return { items: rows.rows.map(toRecord), totals, daily: daily.rows, models: models.rows, pagination }
  })
}

export async function getAiUsage(id: string): Promise<AdminAiUsageDetail | null> {
  await ensureDatabaseSchema()
  const record = await query<StoredRecord>(`select ${recordColumns} from ai_schedule_usage where id = $1`, [id])
  if (!record.rows[0]) return null
  const explanation = await query<{ text: string; created_at: Date }>(`select saved.explanation as text, saved.created_at
    from ai_schedule_explanations saved join ai_schedule_usage usage on usage.cache_key = saved.cache_key and usage.user_id = saved.user_id
    where usage.id = $1 and usage.status = 'succeeded'`, [id])
  return { item: toRecord(record.rows[0]), explanation: explanation.rows[0]
    ? { text: explanation.rows[0].text, created_at: explanation.rows[0].created_at.toISOString() } : null }
}

function toRecord(row: StoredRecord): AiUsageRecord {
  return { ...row, created_at: row.created_at.toISOString(), settled_at: row.settled_at?.toISOString() ?? null }
}
