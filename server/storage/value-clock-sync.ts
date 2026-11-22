import { randomUUID } from 'node:crypto'
import { VALUE_CLOCK_METRICS as metrics, type ValueClockVector } from '../../src/lib/value-clock'
import type { WorkspaceResultHistoryExportItem } from '../../src/lib/types'
import { freezeValueClockProduction, ValueClockError } from '../value-clock-production'
import type { QueryClient } from './postgres'

// The caller owns the transaction, both during migration and ordinary refreshes.
export async function syncValueClockHistory(client: QueryClient): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended('value-clock-sync', 0))")
  const pending = await client.query<{ identity: string }>('delete from value_clock_pending returning identity')
  if (!pending.rows.length) return
  for (const { identity } of pending.rows) {
    const result = await client.query<{
      profile_id: string; id: string; name: string; created_at: string;
      config_json: WorkspaceResultHistoryExportItem['config']; result_json: WorkspaceResultHistoryExportItem['result'];
      source: 'generated' | 'manual'; imported_at: string | null;
    }>(`select h.profile_id, h.id, h.name, h.created_at, h.config_json, h.result_json, h.source,
        g.record_json->'skland_binding'->>'last_imported_at' as imported_at
      from optimization_result_history h join user_game_accounts g on g.id = h.profile_id
      where value_clock_identity(g.id, g.record_json) = $1 order by h.position, h.profile_id, h.id`, [identity])
    const sources = result.rows.map((row) => ({ ...row, at: Date.parse(row.created_at) }))
      .filter((row) => Number.isFinite(row.at)).sort((a, b) => a.at - b.at)
    const inventory = new Map<string, { anchor: number; until: number }>()
    const intervals: Array<ValueClockVector & { id: string; identity: string; profile_id: string; result_id: string; started_at: string; ends_at: string | null }> = []
    for (const [index, row] of sources.entries()) {
      let frozen: ReturnType<typeof freezeValueClockProduction>
      try {
        frozen = freezeValueClockProduction({ id: row.id, name: row.name, created_at: row.created_at, config: row.config_json, result: row.result_json, operator_count: 0, source: row.source, archived_at: null }, row.imported_at && Date.parse(row.imported_at) <= row.at ? row.imported_at : null)
      } catch (error) {
        if (error instanceof ValueClockError) continue
        throw error
      }
      let end = sources[index + 1]?.at ?? Infinity
      if (frozen.inventory) {
        const previous = inventory.get(frozen.inventory.snapshot)
        const anchor = previous?.anchor ?? row.at
        const until = Math.min(previous?.until ?? Infinity, anchor + frozen.inventory.durationMs)
        inventory.set(frozen.inventory.snapshot, { anchor, until })
        end = Math.min(end, until)
      }
      if (end <= row.at) continue
      intervals.push({ id: randomUUID(), identity, profile_id: row.profile_id, result_id: row.id,
        started_at: new Date(row.at).toISOString(), ends_at: Number.isFinite(end) ? new Date(end).toISOString() : null, ...frozen.daily })
    }
    await client.query('delete from value_clock_intervals where identity = $1', [identity])
    if (intervals.length) await client.query(`insert into value_clock_intervals(id, identity, profile_id, result_id, started_at, ends_at, ${metrics.join(', ')})
      select id, identity, profile_id, result_id, started_at, ends_at, ${metrics.join(', ')} from jsonb_to_recordset($1::jsonb)
      as r(id text, identity text, profile_id text, result_id text, started_at timestamptz, ends_at timestamptz, ${metrics.map((key) => `${key} numeric`).join(', ')})`, [JSON.stringify(intervals)])
  }
  await client.query(`update value_clock_series set revision = revision + 1,
    started_at = (select min(started_at) from value_clock_intervals) where id = 'production-v1'`)
}
