import { Pool } from 'pg'
import {
  getUpgradedProfileMetadata,
  LEGACY_FREE_PROFILE_DISPLAY_NAME,
  LEGACY_FREE_PROFILE_NOTE,
} from '../server/profile-default-metadata.ts'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node --env-file=.env scripts/repair-profile-default-metadata.mjs [--apply]\nRequires DATABASE_URL. Defaults to a read-only preview of CDK profiles with legacy default metadata.')
  process.exit(0)
}
if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported; omit it to preview changes')
const apply = args.includes('--apply')
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: databaseUrl, application_name: 'goofish-profile-metadata-repair', connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })

try {
  const client = await pool.connect()
  try {
    if (apply) await client.query('begin')
    const { rows } = await client.query(
      `select id, display_name, note from user_game_accounts
       where kind = 'cdk' and (display_name = $1 or note = $2)
       order by id${apply ? ' for update' : ''}`,
      [LEGACY_FREE_PROFILE_DISPLAY_NAME, LEGACY_FREE_PROFILE_NOTE],
    )
    const changes = rows.map((row) => ({
      id: row.id,
      before: { display_name: row.display_name, note: row.note },
      after: getUpgradedProfileMetadata(row),
    }))
    if (apply) {
      const now = new Date().toISOString()
      for (const change of changes) {
        await client.query(
          `update user_game_accounts
           set display_name = $2, note = $3, updated_at = $4::text::timestamptz,
               record_json = record_json || jsonb_build_object('display_name', $2::text, 'note', $3::text, 'updated_at', $4::text)
           where id = $1`,
          [change.id, change.after.display_name, change.after.note, now],
        )
      }
      await client.query('commit')
    }
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', count: changes.length, changes }, null, 2))
  } catch (error) {
    if (apply) await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
