import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { CdkRecord, CdkRecordStore } from '../../netlify/functions/license-utils'

let schemaReady: Promise<void> | null = null

export function createPostgresCdkRecordStore(): CdkRecordStore {
  return {
    get: async (key) => {
      await ensureSchema()
      const result = await query<{ record_json: CdkRecord }>(
        'select record_json from cdk_records where key = $1',
        [key],
      )
      return result.rows[0]?.record_json ?? null
    },
    set: async (key, record) => {
      await ensureSchema()
      await query(
        `insert into cdk_records (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
         on conflict (key) do update set
          code_hash = excluded.code_hash,
          status = excluded.status,
          permission = excluded.permission,
          license_order_hash = excluded.license_order_hash,
          record_json = excluded.record_json,
          created_at = excluded.created_at,
          updated_at = now()`,
        [
          key,
          record.code_hash,
          record.status,
          record.permission,
          record.license_order_hash,
          JSON.stringify(record),
          record.created_at || null,
        ],
      )
    },
    delete: async (key) => {
      await ensureSchema()
      await query('delete from cdk_records where key = $1', [key])
    },
    list: async (prefix) => {
      await ensureSchema()
      const result = await query<{ record_json: CdkRecord }>(
        'select record_json from cdk_records where key like $1 order by created_at desc nulls last, key asc',
        [`${prefix}%`],
      )
      return result.rows.map((row) => row.record_json)
    },
  }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
