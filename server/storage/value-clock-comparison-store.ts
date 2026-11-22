import { randomUUID } from 'node:crypto'
import type { ValueClockComparison, ValueClockComparisonRequest } from '../../src/lib/value-clock-comparison'
import { ValueClockComparisonError, verifyValueClockComparison } from '../value-clock-comparison'
import { freezeValueClockProduction, ValueClockError } from '../value-clock-production'
import type { WorkspaceResultHistoryExportItem } from '../../src/lib/types'
import { getOptimizeJobStore } from './optimize-job-store'
import { getProfileOptimizationResult } from './optimization-result-store'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction, type QueryClient } from './postgres'
import { syncValueClockHistory } from './value-clock-sync'

type ComparisonRow = {
  id: string; identity: string; source_matches: boolean; current_result_id: string; baseline_result_id: string; baseline_name: string;
  current_daily_sanity: string; baseline_daily_sanity: string; confirmed_at: Date | null;
  ends_at: Date | null; inventory_ends_at: Date | null; interval_ends_at: Date | null; request_id: string; current_job_id: string; baseline_job_id: string;
}
const selectComparison = `select c.*, h.name as baseline_name,
  c.source_fingerprint = value_clock_comparison_source(c.profile_id, c.current_result_id, c.baseline_result_id) as source_matches,
  (select min(ends_at) from value_clock_intervals where comparison_id = c.id) as interval_ends_at from value_clock_comparisons c
  join optimization_result_history h on h.profile_id = c.profile_id and h.id = c.baseline_result_id`

export async function readPersonalValueClock(profileId: string) {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await syncValueClockHistory(client)
    const settings = await client.query<{ revision: number; active_id: string | null }>('select * from value_clock_comparison_settings where profile_id = $1', [profileId])
    const current = await currentInterval(client, profileId)
    const activeId = settings.rows[0]?.active_id
    const comparisons = activeId ? await client.query<ComparisonRow>(`${selectComparison} where c.id = $1 and c.profile_id = $2`, [activeId, profileId]) : null
    const row = comparisons?.rows[0]
    const active = row && (await client.query('select 1 from value_clock_intervals where comparison_id = $1 and started_at <= now() and (ends_at is null or ends_at > now())', [row.id])).rowCount
    return { revision: settings.rows[0]?.revision ?? 0, current,
      comparison_state: active ? 'active' as const : row ? 'ended' as const : 'not_set' as const,
      comparison: row ? comparisonValue(row) : null }
  })
}

export async function verifyPersonalValueClock(input: Extract<ValueClockComparisonRequest, { action: 'verify' }>, importedAt: string | null) {
  await ensureDatabaseSchema()
  const saved = await query<ComparisonRow>(`${selectComparison} where c.profile_id = $1 and c.request_id = $2`, [input.profile_id, input.request_id])
  if (saved.rows[0]) return verifiedRetry(saved.rows[0], input)
  const [current, baseline, currentJob, baselineJob] = await Promise.all([
    getProfileOptimizationResult(input.profile_id, input.current_result_id), getProfileOptimizationResult(input.profile_id, input.baseline_result_id),
    getOptimizeJobStore().getJob(input.current_job_id), getOptimizeJobStore().getJob(input.baseline_job_id),
  ])
  if (!current || !baseline || !currentJob || !baselineJob) throw new ValueClockComparisonError('原排班或核算记录已失效，请重新选择并核算。')
  const proof = verifyValueClockComparison(input.profile_id, current, baseline, [currentJob, baselineJob], importedAt)
  return withTransaction(async (client) => {
    await syncValueClockHistory(client)
    const existing = await client.query<ComparisonRow>(`${selectComparison} where c.profile_id = $1 and c.request_id = $2`, [input.profile_id, input.request_id])
    if (existing.rows[0]) return verifiedRetry(existing.rows[0], input)
    const interval = await currentInterval(client, input.profile_id)
    if (!interval || interval.id !== current.id) throw new ValueClockComparisonError('当前方案已更换或停止累计，请读取最新方案。')
    const id = randomUUID()
    // Inventory uses the saved plan's anchor; confirming again never replenishes it.
    let inventoryAnchor = Date.parse(current.created_at)
    if (Number.isFinite(proof.inventoryDurationMs)) {
      const history = await client.query<{ id: string; name: string; created_at: string; config_json: WorkspaceResultHistoryExportItem['config']; result_json: WorkspaceResultHistoryExportItem['result']; imported_at: string | null }>(`select h.id, h.name, h.created_at, h.config_json, h.result_json, g.record_json->'skland_binding'->>'last_imported_at' as imported_at
        from optimization_result_history h join user_game_accounts g on g.id = h.profile_id
        where value_clock_identity(g.id, g.record_json) = (select value_clock_identity(id, record_json) from user_game_accounts where id = $1)`, [input.profile_id])
      for (const source of history.rows) {
        try {
          const at = Date.parse(source.created_at)
          const frozen = freezeValueClockProduction({ ...source, config: source.config_json, result: source.result_json, source: 'generated', operator_count: 0, archived_at: null }, source.imported_at && Date.parse(source.imported_at) <= at ? source.imported_at : null)
          if (frozen.inventorySnapshot === proof.inventorySnapshot) inventoryAnchor = Math.min(inventoryAnchor, at)
        } catch (error) { if (!(error instanceof ValueClockError)) throw error }
      }
    }
    const inventoryEnd = Number.isFinite(proof.inventoryDurationMs) ? new Date(inventoryAnchor + proof.inventoryDurationMs).toISOString() : null
    if (inventoryEnd && Date.parse(inventoryEnd) <= Date.now()) throw new ValueClockComparisonError('原排班的可用库存已耗尽，请更新库存后重新核算。')
    await client.query(`insert into value_clock_comparisons(id, profile_id, identity, request_id, current_result_id, baseline_result_id,
      current_job_id, baseline_job_id, context_fingerprint, source_fingerprint, current_daily_sanity, baseline_daily_sanity, daily, inventory_ends_at)
      select $1, $2, value_clock_identity(id, record_json), $3, $4, $5, $6, $7, $8, value_clock_comparison_source($2, $4, $5), $9, $10, $11::jsonb, $12::timestamptz from user_game_accounts where id = $2`,
    [id, input.profile_id, input.request_id, current.id, baseline.id, input.current_job_id, input.baseline_job_id,
      proof.fingerprint, proof.currentDaily, proof.baselineDaily, JSON.stringify(proof.daily), inventoryEnd])
    const saved = await client.query<ComparisonRow>(`${selectComparison} where c.id = $1`, [id])
    return comparisonValue(saved.rows[0])
  })
}

export async function activatePersonalValueClock(input: Extract<ValueClockComparisonRequest, { action: 'activate' }>) {
  await ensureDatabaseSchema()
  await withTransaction(async (client) => {
    await syncValueClockHistory(client)
    await client.query('insert into value_clock_comparison_settings(profile_id) values ($1) on conflict do nothing', [input.profile_id])
    const settings = await client.query<{ revision: number; active_id: string | null }>('select * from value_clock_comparison_settings where profile_id = $1 for update', [input.profile_id])
    if (settings.rows[0].active_id === input.comparison_id) return
    if (settings.rows[0].revision !== input.revision) throw new ValueClockComparisonError('原排班设置已更新，请重新读取后确认。', 'comparison_revision_conflict')
    const comparison = await client.query<ComparisonRow>(`${selectComparison} where c.id = $1 and c.profile_id = $2 for update of c`, [input.comparison_id, input.profile_id])
    const row = comparison.rows[0]
    const current = await currentInterval(client, input.profile_id)
    const identity = await client.query<{ identity: string }>('select value_clock_identity(id, record_json) as identity from user_game_accounts where id = $1', [input.profile_id])
    if (!row || !row.source_matches || row.identity !== identity.rows[0].identity || row.confirmed_at || current?.id !== row.current_result_id || row.inventory_ends_at && row.inventory_ends_at.getTime() <= Date.now()) throw new ValueClockComparisonError('比较已失效，请读取当前方案并重新核算。')
    await client.query('update value_clock_comparisons set ends_at = now() where id = $1', [settings.rows[0].active_id])
    await client.query('update value_clock_comparisons set confirmed_at = now() where id = $1 and identity = $2', [row.id, identity.rows[0].identity])
    await client.query('update value_clock_comparison_settings set revision = revision + 1, active_id = $2 where profile_id = $1', [input.profile_id, row.id])
    await client.query('insert into value_clock_pending(identity) values ($1) on conflict do nothing', [identity.rows[0].identity])
    await syncValueClockHistory(client)
  })
  return readPersonalValueClock(input.profile_id)
}

async function currentInterval(client: QueryClient, profileId: string) {
  const result = await client.query<{ id: string; name: string; created_at: string }>(`select h.id, h.name, h.created_at from value_clock_intervals i
    join optimization_result_history h on h.profile_id = i.profile_id and h.id = i.result_id
    where i.profile_id = $1 and i.view = 'production' and i.started_at <= now() and (i.ends_at is null or i.ends_at > now())`, [profileId])
  const row = result.rows[0]
  return row ? { ...row, created_at: new Date(row.created_at).toISOString() } : null
}
function verifiedRetry(row: ComparisonRow, input: Extract<ValueClockComparisonRequest, { action: 'verify' }>) {
  if (!row.source_matches) throw new ValueClockComparisonError('来源排班已更改，请重新核算。')
  if (row.current_result_id !== input.current_result_id || row.baseline_result_id !== input.baseline_result_id || row.current_job_id !== input.current_job_id || row.baseline_job_id !== input.baseline_job_id) throw new ValueClockComparisonError('本次请求已用于另一份比较，请重新核算。', 'comparison_request_conflict')
  return comparisonValue(row)
}
function comparisonValue(row: ComparisonRow): ValueClockComparison {
  const current = Number(row.current_daily_sanity), baseline = Number(row.baseline_daily_sanity)
  const end = [row.ends_at, row.inventory_ends_at, row.interval_ends_at].filter((value): value is Date => value !== null).map((value) => value.getTime())
  return { id: row.id, current_result_id: row.current_result_id, baseline_result_id: row.baseline_result_id, baseline_name: row.baseline_name,
    current_daily_sanity: current, baseline_daily_sanity: baseline, daily_gain_sanity: current - baseline,
    confirmed_at: row.confirmed_at?.toISOString() ?? null, ends_at: end.length ? new Date(Math.min(...end)).toISOString() : null }
}
