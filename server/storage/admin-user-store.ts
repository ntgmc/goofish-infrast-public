import { query } from './postgres'
import type { AdminUserRecord } from '../handlers/admin-auth'
import type { PasswordHashRecord } from '../security/password'

export interface AdminUserStore {
  get: (username: string) => Promise<AdminUserRecord | null>
  set: (username: string, user: AdminUserRecord) => Promise<void>
  upgradePasswordHash: (
    username: string,
    expectedPasswordHash: string,
    replacement: PasswordHashRecord,
  ) => Promise<AdminUserRecord | null>
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
    upgradePasswordHash: async (username, expectedPasswordHash, replacement) => {
      const updatedAt = new Date().toISOString()
      const passwordPatch = {
        password_hash: replacement.password_hash,
        salt: replacement.salt,
        iterations: replacement.iterations,
        password_algorithm: replacement.password_algorithm,
        updated_at: updatedAt,
      }
      const result = await query<{ record_json: AdminUserRecord }>(
        `update admin_users
         set password_hash = $3,
             salt = $4,
             iterations = $5,
             record_json = record_json || $6::jsonb,
             updated_at = $7
         where username = $1 and password_hash = $2
         returning record_json`,
        [
          username,
          expectedPasswordHash,
          replacement.password_hash,
          replacement.salt,
          replacement.iterations,
          JSON.stringify(passwordPatch),
          updatedAt,
        ],
      )
      return result.rows[0]?.record_json ?? null
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
