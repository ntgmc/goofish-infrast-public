import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

let schemaReady: Promise<void> | null = null

export interface AdminSessionRecord {
  id: string
  username: string
  token_hash: string
  created_at: string
  last_seen_at: string
  expires_at: string
}

export interface AdminSessionStore {
  save: (session: AdminSessionRecord) => Promise<void>
  authenticateAndTouch: (
    tokenHash: string,
    now: string,
    idleCutoff: string,
  ) => Promise<AdminSessionRecord | null>
  deleteByTokenHash: (tokenHash: string) => Promise<void>
  deleteExpired: (now: string, idleCutoff: string) => Promise<void>
}

export function createPostgresAdminSessionStore(): AdminSessionStore {
  return {
    save: async (session) => {
      await ensureSchema()
      await query(
        `insert into admin_sessions
          (id, username, token_hash, created_at, last_seen_at, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          session.id,
          session.username,
          session.token_hash,
          session.created_at,
          session.last_seen_at,
          session.expires_at,
        ],
      )
    },
    authenticateAndTouch: async (tokenHash, now, idleCutoff) => {
      await ensureSchema()
      const result = await query<AdminSessionRecord>(
        `update admin_sessions
         set last_seen_at = $2
         where token_hash = $1
           and expires_at > $2
           and last_seen_at > $3
         returning id, username, token_hash, created_at, last_seen_at, expires_at`,
        [tokenHash, now, idleCutoff],
      )
      const session = result.rows[0] ?? null
      if (!session) await query('delete from admin_sessions where token_hash = $1', [tokenHash])
      return session
    },
    deleteByTokenHash: async (tokenHash) => {
      await ensureSchema()
      await query('delete from admin_sessions where token_hash = $1', [tokenHash])
    },
    deleteExpired: async (now, idleCutoff) => {
      await ensureSchema()
      await query(
        'delete from admin_sessions where expires_at <= $1 or last_seen_at <= $2',
        [now, idleCutoff],
      )
    },
  }
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = ensureDatabaseSchema()
  await schemaReady
}
