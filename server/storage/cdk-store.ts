import type { PoolClient } from 'pg'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { CdkRecord, CdkRecordStore } from '../handlers/license-utils'

let schemaReady: Promise<void> | null = null

export async function claimCdkRecord(client: PoolClient, key: string): Promise<CdkRecord | null> {
  const result = await client.query<{ record_json: CdkRecord }>(
    `update cdk_records
     set status = 'claiming', record_revision = record_revision + 1, updated_at = now(),
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
     set status = 'used', permission = $2, license_order_hash = $3, record_json = $4::jsonb,
         record_revision = record_revision + 1, updated_at = now()
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
    create: async (key, record) => {
      await ensureSchema()
      const result = await query(
        `insert into cdk_records (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
         on conflict (key) do nothing`,
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
      if (result.rowCount !== 1) throw new Error('CDK record already exists')
    },
    mutate: async (key, mutate, options) => {
      await ensureSchema()
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const selected = await query<{ record_json: CdkRecord; record_revision: number }>(
          'select record_json, record_revision from cdk_records where key = $1',
          [key],
        )
        const current = selected.rows[0]
        if (!current) return null
        if (current.record_json.status === 'revoked') return current.record_json
        if (options?.allowedStatuses && !options.allowedStatuses.includes(current.record_json.status)) return current.record_json

        const next = mutate(current.record_json)
        if (!next) return current.record_json
        if (next.status !== current.record_json.status) {
          const isValidTransition = (
            (current.record_json.status === 'used' && next.status === 'frozen')
            || (current.record_json.status === 'frozen' && next.status === 'used')
            || ((current.record_json.status === 'used' || current.record_json.status === 'frozen') && next.status === 'revoked')
          ) && options?.allowedStatuses?.includes(current.record_json.status)
          if (!isValidTransition) {
            throw new Error('CDK status transition requires an explicit allowed source status')
          }
        }

        const result = await query<{ record_json: CdkRecord }>(
          `update cdk_records
           set status = $2, permission = $3, license_order_hash = $4, record_json = $5::jsonb,
               record_revision = record_revision + 1, updated_at = now()
           where key = $1 and record_revision = $6 and status <> 'revoked'
           returning record_json`,
          [key, next.status, next.permission, next.license_order_hash, JSON.stringify(next), current.record_revision],
        )
        if (result.rowCount === 1) return result.rows[0]?.record_json ?? null
      }
      throw new Error('CDK record changed too frequently to update safely')
    },
    incrementScheduleGenerateCount: async (key, jobId) => {
      await ensureSchema()
      if (jobId) {
        return withTransaction(async (client) => {
          const effect = await client.query(
            `insert into optimization_job_effects (job_id, effect_type, metadata_json, applied_at)
             values ($1, 'cdk_schedule_generate', $2::jsonb, now())
             on conflict (job_id, effect_type) do nothing
             returning job_id`,
            [jobId, JSON.stringify({ key })],
          )
          if (!effect.rowCount) return true
          const result = await client.query(
            `update cdk_records
             set record_json = jsonb_set(
                   record_json,
                   '{schedule_generate_count}',
                   to_jsonb(coalesce(nullif(record_json->>'schedule_generate_count', '')::integer, 0) + 1),
                   true
                 ),
                 record_revision = record_revision + 1,
                 updated_at = now()
             where key = $1 and status = 'used'`,
            [key],
          )
          if (result.rowCount === 1) return true
          await client.query(
            `delete from optimization_job_effects where job_id = $1 and effect_type = 'cdk_schedule_generate'`,
            [jobId],
          )
          return false
        })
      }
      const result = await query(
        `update cdk_records
         set record_json = jsonb_set(
               record_json,
               '{schedule_generate_count}',
               to_jsonb(coalesce(nullif(record_json->>'schedule_generate_count', '')::integer, 0) + 1),
               true
             ),
             record_revision = record_revision + 1,
             updated_at = now()
         where key = $1 and status = 'used'`,
        [key],
      )
      return result.rowCount === 1
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
    listAdminPage: async (options) => {
      await ensureSchema()
      const values: unknown[] = []
      const conditions = ["key like 'cdk/%'"]
      const add = (value: unknown) => {
        values.push(value)
        return `$${values.length}`
      }
      if (options.status !== 'all') conditions.push(`status = ${add(options.status)}`)
      if (options.permission !== 'all') conditions.push(`permission = ${add(options.permission)}`)
      if (options.search) {
        const search = add(`%${options.search.toLowerCase()}%`)
        conditions.push(`(
          lower(code_hash) like ${search}
          or lower(coalesce(license_order_hash, '')) like ${search}
          or lower(coalesce(record_json->>'order_note', '')) like ${search}
        )`)
      }
      const riskExpression = `(status = 'frozen' or jsonb_array_length(coalesce(record_json->'risk_events', '[]'::jsonb)) > 0)`
      const generatedExpression = `coalesce(nullif(record_json->>'schedule_generate_count', '')::integer, 0) > 0`
      if (options.riskOnly) conditions.push(riskExpression)
      if (options.risk !== 'all') conditions.push(options.risk === 'yes' ? riskExpression : `not ${riskExpression}`)
      if (options.generated !== 'all') conditions.push(options.generated === 'yes' ? generatedExpression : `not (${generatedExpression})`)

      const where = conditions.join(' and ')
      const countResult = await query<{ total: string }>(`select count(*)::text as total from cdk_records where ${where}`, values)
      const total = Number(countResult.rows[0]?.total ?? 0)
      const totalPages = total === 0 ? 0 : Math.ceil(total / options.pageSize)
      const page = totalPages === 0 ? 1 : Math.min(options.page, totalPages)
      const limit = add(options.pageSize)
      const offset = add((page - 1) * options.pageSize)
      const result = await query<{ record_json: CdkRecord }>(
        `select record_json from cdk_records where ${where}
         order by created_at desc nulls last, key asc limit ${limit} offset ${offset}`,
        values,
      )
      return { records: result.rows.map((row) => row.record_json), total, page, totalPages }
    },
  }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
