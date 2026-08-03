import type { PoolClient } from 'pg'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  getCdkBalanceAmount,
  getCdkItemCode,
  getCdkItemExpiresAt,
  getCdkType,
  isProfileCdkRecord,
  type CdkRecord,
  type CdkRecordStore,
  type OperatorFingerprint,
} from '../handlers/license-utils'
import { normalizeRuntimePermission } from '../../src/lib/product-catalog'

let schemaReady: Promise<void> | null = null

export async function listCdkRecordsByKeys(keys: string[]): Promise<Map<string, CdkRecord>> {
  if (keys.length === 0) return new Map()
  await ensureSchema()
  const result = await query<{ key: string; record_json: CdkRecord }>(
    'select key, record_json from cdk_records where key = any($1::text[])',
    [keys],
  )
  return new Map(result.rows.map((row) => [row.key, row.record_json]))
}

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
  const storedRecord = normalizeCdkRecordForPersistence(record)
  const result = await client.query(
    `update cdk_records
     set status = 'used', cdk_type = $2, permission = $3, balance_amount = $4::numeric,
         item_code = $5, item_expires_at = $6, license_order_hash = $7, record_json = $8::jsonb,
         record_revision = record_revision + 1, updated_at = now()
     where key = $1 and status = 'claiming'`,
    [key, getCdkType(storedRecord), storedRecord.permission, getCdkBalanceAmount(storedRecord), getCdkItemCode(storedRecord), getCdkItemExpiresAt(storedRecord), storedRecord.license_order_hash, JSON.stringify(storedRecord)],
  )
  if (result.rowCount !== 1) throw new Error('CDK redemption claim was lost before completion')
}

export async function recordOperatorFingerprintInTransaction(
  client: PoolClient,
  record: CdkRecord,
  fingerprint: OperatorFingerprint,
): Promise<CdkRecord> {
  const key = `cdk/${record.code_hash}.json`
  const selected = await client.query<{ record_json: CdkRecord }>(
    "select record_json from cdk_records where key = $1 and status = 'used' for update",
    [key],
  )
  const current = selected.rows[0]?.record_json
  if (!current) return record
  const baseline = current.baseline_operator_fingerprint ?? fingerprint
  if (
    current.baseline_operator_fingerprint?.hash === baseline.hash
    && current.latest_operator_fingerprint?.hash === fingerprint.hash
  ) return current
  const next = normalizeCdkRecordForPersistence({
    ...current,
    baseline_operator_fingerprint: baseline,
    latest_operator_fingerprint: fingerprint,
  })
  const updated = await client.query<{ record_json: CdkRecord }>(
    `update cdk_records
     set record_json = $2::jsonb, record_revision = record_revision + 1, updated_at = now()
     where key = $1 and status = 'used'
     returning record_json`,
    [key, JSON.stringify(next)],
  )
  if (updated.rowCount !== 1 || !updated.rows[0]) {
    throw new Error('CDK record changed before its operator fingerprint could be updated')
  }
  return updated.rows[0].record_json
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
      await insertCdkRecord({ query }, key, record)
    },
    createBatch: async (entries) => {
      if (entries.length === 0) return
      await ensureSchema()
      await withTransaction(async (client) => {
        for (const entry of entries) {
          await insertCdkRecord(client, entry.key, entry.record)
        }
      })
    },
    mutate: async (key, mutate, options) => {
      await ensureSchema()
      return withTransaction(async (client) => {
        const selected = await client.query<{ record_json: CdkRecord }>(
          'select record_json from cdk_records where key = $1 for update',
          [key],
        )
        const current = selected.rows[0]
        if (!current) return null
        if (current.record_json.status === 'revoked') return current.record_json
        if (options?.allowedStatuses && !options.allowedStatuses.includes(current.record_json.status)) return current.record_json

        const mutated = mutate(current.record_json)
        if (!mutated) return current.record_json
        if (mutated.status !== current.record_json.status) {
          const isValidTransition = (
            (current.record_json.status === 'used' && mutated.status === 'frozen')
            || (current.record_json.status === 'frozen' && mutated.status === 'used')
            || ((current.record_json.status === 'used' || current.record_json.status === 'frozen') && mutated.status === 'revoked')
          ) && options?.allowedStatuses?.includes(current.record_json.status)
          if (!isValidTransition) {
            throw new Error('CDK status transition requires an explicit allowed source status')
          }
        }

        const next = normalizeCdkRecordForPersistence(mutated)
        const result = await client.query<{ record_json: CdkRecord }>(
          `update cdk_records
           set status = $2, cdk_type = $3, permission = $4, balance_amount = $5::numeric,
               item_code = $6, item_expires_at = $7, license_order_hash = $8, record_json = $9::jsonb,
               record_revision = record_revision + 1, updated_at = now()
           where key = $1 and status <> 'revoked'
           returning record_json`,
          [key, next.status, getCdkType(next), next.permission, getCdkBalanceAmount(next), getCdkItemCode(next),
            getCdkItemExpiresAt(next), next.license_order_hash, JSON.stringify(next)],
        )
        if (result.rowCount !== 1 || !result.rows[0]) throw new Error('CDK record changed before it could be updated')
        await syncLinkedProfileAuthorization(client, key, next)
        return result.rows[0].record_json
      })
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
    deleteUnused: async (key) => {
      await ensureSchema()
      const result = await query("delete from cdk_records where key = $1 and status = 'unused' returning key", [key])
      return result.rowCount === 1
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
      if (options.cdkType !== 'all') conditions.push(`cdk_type = ${add(options.cdkType)}`)
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

async function insertCdkRecord(client: Pick<PoolClient, 'query'>, key: string, record: CdkRecord): Promise<void> {
  const storedRecord = normalizeCdkRecordForPersistence(record)
  const result = await client.query(
    `insert into cdk_records
      (key, code_hash, cdk_type, status, permission, balance_amount, item_code, item_expires_at, license_order_hash, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10::jsonb, $11, now())
     on conflict (key) do nothing`,
    [
      key,
      storedRecord.code_hash,
      getCdkType(storedRecord),
      storedRecord.status,
      storedRecord.permission,
      getCdkBalanceAmount(storedRecord),
      getCdkItemCode(storedRecord),
      getCdkItemExpiresAt(storedRecord),
      storedRecord.license_order_hash,
      JSON.stringify(storedRecord),
      storedRecord.created_at || null,
    ],
  )
  if (result.rowCount !== 1) throw new Error('CDK record already exists')
}

function normalizeCdkRecordForPersistence(record: CdkRecord): CdkRecord {
  if (!isProfileCdkRecord(record)) return record
  return { ...record, permission: normalizeRuntimePermission(record.permission) }
}

async function syncLinkedProfileAuthorization(client: PoolClient, cdkKey: string, record: CdkRecord): Promise<void> {
  if (!isProfileCdkRecord(record) || !['used', 'frozen', 'revoked'].includes(record.status)) return
  const permission = normalizeRuntimePermission(record.permission)
  const status = record.status === 'used' ? 'active' : record.status
  const updatedAt = new Date().toISOString()
  const patch = JSON.stringify({ permission, status, updated_at: updatedAt })
  await client.query(
    `update user_game_accounts
        set permission = $2,
            status = $3,
            updated_at = $4,
            record_json = record_json || $5::jsonb
      where cdk_key = $1`,
    [cdkKey, permission, status, updatedAt, patch],
  )
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
