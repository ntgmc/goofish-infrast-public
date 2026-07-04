import { query } from './postgres'

export type UsageEventName = 'tool_visit' | 'schedule_generate' | 'cdk_redeem'

export interface UsageEventRecord {
  id: string
  event: UsageEventName
  visitor_id: string | null
  created_at: string
  date: string
}

export interface UsageEventStore {
  set: (key: string, record: UsageEventRecord) => Promise<void>
  list: (prefix: string) => Promise<UsageEventRecord[]>
}

export function createPostgresUsageEventStore(): UsageEventStore {
  return {
    set: async (key, record) => {
      await query(
        `insert into usage_events (key, event, visitor_id, date, created_at, record_json)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict (key) do update set
          event = excluded.event,
          visitor_id = excluded.visitor_id,
          date = excluded.date,
          created_at = excluded.created_at,
          record_json = excluded.record_json`,
        [
          key,
          record.event,
          record.visitor_id,
          record.date,
          record.created_at,
          JSON.stringify(record),
        ],
      )
    },
    list: async (prefix) => {
      const result = await query<{ record_json: UsageEventRecord }>(
        'select record_json from usage_events where key like $1 order by created_at asc',
        [`${prefix}%`],
      )
      return result.rows.map((row) => row.record_json)
    },
  }
}
