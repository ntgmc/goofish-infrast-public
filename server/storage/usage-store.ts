import { query } from './postgres'

export type UsageEventName = 'tool_visit' | 'schedule_generate' | 'cdk_redeem'

export interface UsageEventRecord {
  id: string
  event: UsageEventName
  visitor_id: string | null
  created_at: string
  date: string
}

export interface UsageDayStats {
  date: string
  unique_visitors: number
  visits: number
  schedule_generates: number
  cdk_redeems: number
}

export interface UsageStats {
  totals: UsageDayStats
  days: UsageDayStats[]
}

export interface UsageEventStore {
  set: (key: string, record: UsageEventRecord) => Promise<void>
  getStats: (dates: string[]) => Promise<UsageStats>
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
    getStats: async (dates) => {
      const totalsResult = await query<{
        unique_visitors: number
        visits: number
        schedule_generates: number
        cdk_redeems: number
      }>(
        `select
           count(distinct visitor_id) filter (where event = 'tool_visit' and visitor_id is not null)::int as unique_visitors,
           count(*) filter (where event = 'tool_visit')::int as visits,
           count(*) filter (where event = 'schedule_generate')::int as schedule_generates,
           count(*) filter (where event = 'cdk_redeem')::int as cdk_redeems
         from usage_events
         where key like 'events/%'`,
      )
      const totalsRow = totalsResult.rows[0]
      const totals: UsageDayStats = {
        date: 'total',
        unique_visitors: totalsRow?.unique_visitors ?? 0,
        visits: totalsRow?.visits ?? 0,
        schedule_generates: totalsRow?.schedule_generates ?? 0,
        cdk_redeems: totalsRow?.cdk_redeems ?? 0,
      }

      const startDate = dates[0] ?? ''
      const endDate = dates[dates.length - 1] ?? ''
      const daysByDate = new Map<string, UsageDayStats>()

      if (startDate && endDate) {
        const daysResult = await query<{
          date: string
          unique_visitors: number
          visits: number
          schedule_generates: number
          cdk_redeems: number
        }>(
          `select
             date::text as date,
             count(distinct visitor_id) filter (where event = 'tool_visit' and visitor_id is not null)::int as unique_visitors,
             count(*) filter (where event = 'tool_visit')::int as visits,
             count(*) filter (where event = 'schedule_generate')::int as schedule_generates,
             count(*) filter (where event = 'cdk_redeem')::int as cdk_redeems
           from usage_events
           where key like 'events/%' and date between $1 and $2
           group by date
           order by date asc`,
          [startDate, endDate],
        )

        for (const row of daysResult.rows) {
          daysByDate.set(row.date, {
            date: row.date,
            unique_visitors: row.unique_visitors ?? 0,
            visits: row.visits ?? 0,
            schedule_generates: row.schedule_generates ?? 0,
            cdk_redeems: row.cdk_redeems ?? 0,
          })
        }
      }

      return {
        totals,
        days: dates.map((date) => daysByDate.get(date) ?? createEmptyDayStats(date)),
      }
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

function createEmptyDayStats(date: string): UsageDayStats {
  return {
    date,
    unique_visitors: 0,
    visits: 0,
    schedule_generates: 0,
    cdk_redeems: 0,
  }
}
