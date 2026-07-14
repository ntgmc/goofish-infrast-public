import type { PoolClient } from 'pg'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { CdkRecord, CdkRecordStore } from '../handlers/license-utils'

let schemaReady: Promise<void> | null = null

export async function claimCdkRecord(client: PoolClient, key: string): Promise<CdkRecord | null> {
  const result = await client.query<{ record_json: CdkRecord }>(
    `update cdk_records
     set status = 'claiming', updated_at = now(),
         record_json = jsonb_set(record_json, '{status}', '"claiming"'::jsonb)
     where key = $1 and status = 'unused'
     returning record_json`,
    [key],
  )
  return result.rows[0]?.record_json ?? null
}

export async function completeCdkRedemption(client: PoolClient, key: string, record: CdkRecord): Promise<void> {
  const result = await client.query(
    `update cdk_records
     set status = 'used', permission = $2, license_order_hash = $3, record_json = $4::jsonb, updated_at = now()
     where key = $1 and status = 'claiming'`,
    [key, record.permission, record.license_order_hash, JSON.stringify(record)],
  )
  if (result.rowCount !== 1) throw new Error('CDK redemption claim was lost before completion')
}

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
    getByLicenseOrderHash: async (orderHash) => {
      await ensureSchema()
      const result = await query<{ record_json: CdkRecord }>(
        `select record_json
         from cdk_records
         where key like 'cdk/%' and license_order_hash = $1
         order by created_at desc nulls last, key asc
         limit 1`,
        [orderHash],
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
