import { query } from './postgres'

export interface AnnouncementStore {
  get: () => Promise<unknown>
  set: (data: unknown) => Promise<void>
}

export function createPostgresAnnouncementStore(key = 'current.json'): AnnouncementStore {
  return {
    get: async () => {
      const result = await query<{ data_json: unknown }>(
        'select data_json from announcements where key = $1',
        [key],
      )
      return result.rows[0]?.data_json ?? null
    },
    set: async (data) => {
      await query(
        `insert into announcements (key, data_json, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (key) do update set
          data_json = excluded.data_json,
          updated_at = excluded.updated_at`,
        [key, JSON.stringify(data)],
      )
    },
  }
}
