import { createHash, randomUUID } from 'node:crypto'
import type { OperationsTool } from '../../src/lib/operations-tools'
import { query, type QueryClient } from './postgres'
import { createPostgresUsageEventStore, USAGE_RETENTION_DAYS, type UsageEventRecord } from './usage-store'

const trackingId = createHash('sha256').update('tool_metrics_started:tools.v1/tracking-start').digest('hex')

export async function markToolMetricsStarted(client: QueryClient = { query }): Promise<void> {
  await client.query(`insert into usage_events (key, event, visitor_id, date, created_at, expires_at, record_json)
    values ($1, 'tool_metrics_started', null, current_date, now(), 'infinity',
      jsonb_build_object('id', $2::text, 'status', 'success', 'source', 'tools.v1'))
    on conflict (key) do nothing`, [`events/idempotent/${trackingId}.json`, trackingId])
}

export async function recordToolRun(input: {
  tool: OperationsTool; userId?: string; visitorId?: string; startedAt: number; outcome: 'success' | 'failure' | 'cancelled'
}): Promise<void> {
  const finishedAt = Date.now()
  try {
    await markToolMetricsStarted()
    const now = new Date(finishedAt).toISOString()
    const id = randomUUID()
    const record: UsageEventRecord = {
      id, event: 'tool_run', visitor_id: input.visitorId ?? null, user_id: input.userId,
      tool: input.tool, tool_outcome: input.outcome, created_at: now, date: now.slice(0, 10),
      duration_ms: Math.max(0, finishedAt - input.startedAt),
      ...(input.outcome !== 'cancelled' && { status: input.outcome }),
      source: 'server_tool',
    }
    await createPostgresUsageEventStore().set(`events/${record.date}/${id}.json`, record)
  } catch (error) {
    console.warn('tool usage event skipped:', error instanceof Error ? error.name : 'UnknownError')
  }
}

// Persist the final job outcome in its transaction; retries and polling never create extra uses.
export async function recordOptimizationToolRunInTransaction(client: QueryClient, jobId: string): Promise<void> {
  await markToolMetricsStarted(client)
  await client.query(`insert into usage_events
    (key, event, visitor_id, user_id, profile_id, date, created_at, expires_at, record_json)
    select 'events/tool-job/' || job.id, 'tool_run', null, profile.user_id, profile.id,
      (job.finished_at at time zone 'UTC')::date, job.finished_at,
      job.finished_at + ($2::integer * interval '24 hours'),
      jsonb_build_object('id', job.id, 'event', 'tool_run', 'source', 'server_job',
        'tool', case when job.payload_json->>'kind' = 'scenario_comparison' then 'scenario_comparison'
          when job.payload_json->'request'->>'manual_schedule_purpose' = 'comparison' then 'schedule_comparison'
          when job.payload_json->'request'->'manual_schedule' is not null then 'manual_simulation'
          else 'schedule_generate' end,
        'tool_outcome', case when job.status = 'succeeded' then 'success'
          when job.status = 'cancelled' then 'cancelled' else 'failure' end,
        'duration_ms', greatest(0, extract(epoch from (job.finished_at - job.created_at)) * 1000))
    from optimize_jobs job join user_game_accounts profile on profile.id = job.profile_id
    where job.id = $1 and job.status in ('succeeded', 'failed', 'cancelled', 'dead_lettered')
      and job.finished_at is not null
    on conflict (key) do nothing`, [jobId, USAGE_RETENTION_DAYS])
}
