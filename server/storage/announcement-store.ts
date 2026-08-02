import { query, withTransaction } from './postgres'

interface AnnouncementDocument {
  data: unknown
  revision: number
}

export class AnnouncementConflictError extends Error {
  constructor() {
    super('Announcement document revision conflict.')
    this.name = 'AnnouncementConflictError'
  }
}

export interface AnnouncementStore {
  get: () => Promise<AnnouncementDocument>
  set: (data: unknown, expectedRevision: number, retainedAnnouncementIds?: string[]) => Promise<number>
}

export function createPostgresAnnouncementStore(key = 'current.json'): AnnouncementStore {
  return {
    get: async () => {
      const result = await query<{ data_json: unknown; revision: number }>(
        'select data_json, revision from announcements where key = $1',
        [key],
      )
      const row = result.rows[0]
      return { data: row?.data_json ?? null, revision: row?.revision ?? 0 }
    },
    set: async (data, expectedRevision, retainedAnnouncementIds = []) => withTransaction(async (client) => {
      const saved = await client.query<{ revision: number }>(
        `with updated as (
           update announcements
              set data_json = $2::jsonb, updated_at = now(), revision = revision + 1
            where key = $1 and revision = $3
            returning revision
         ), inserted as (
           insert into announcements (key, data_json, updated_at, revision)
           select $1, $2::jsonb, now(), 1
            where $3 = 0 and not exists (select 1 from updated)
           on conflict (key) do nothing
           returning revision
         )
         select revision from updated
         union all
         select revision from inserted`,
        [key, JSON.stringify(data), expectedRevision],
      )
      const revision = saved.rows[0]?.revision
      if (revision === undefined) throw new AnnouncementConflictError()
      await client.query(
        'delete from user_announcement_reads where not (announcement_id = any($1::text[]))',
        [retainedAnnouncementIds],
      )
      return revision
    }),
  }
}
