import { query } from './postgres'
import type { AdminUserRecord } from '../handlers/admin-auth'

export interface AdminUserStore {
  get: (username: string) => Promise<AdminUserRecord | null>
  set: (username: string, user: AdminUserRecord) => Promise<void>
  delete: (username: string) => Promise<void>
  list: () => Promise<AdminUserRecord[]>
}

export function createPostgresAdminUserStore(): AdminUserStore {
  return {
    get: async (username) => {
      const result = await query<{ record_json: AdminUserRecord }>(
        'select record_json from admin_users where username = $1',
        [username],
      )
      return result.rows[0]?.record_json ?? null
    },
    set: async (username, user) => {
      await query(
        `insert into admin_users
          (username, password_hash, salt, iterations, record_json, created_at, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7)
         on conflict (username) do update set
          password_hash = excluded.password_hash,
          salt = excluded.salt,
          iterations = excluded.iterations,
          record_json = excluded.record_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
        [
          username,
          user.password_hash,
          user.salt,
          user.iterations,
          JSON.stringify(user),
          user.created_at,
          user.updated_at,
        ],
      )
    },
    delete: async (username) => {
      await query('delete from admin_users where username = $1', [username])
    },
    list: async () => {
      const result = await query<{ record_json: AdminUserRecord }>(
        'select record_json from admin_users order by username asc',
      )
      return result.rows.map((row) => row.record_json)
    },
  }
}
