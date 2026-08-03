import { createHash, randomUUID } from 'node:crypto'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { productPolicies } from '../../src/lib/product-catalog'
import { SettingsConflictError } from './settings-conflict'

const RISK_SETTINGS_KEY = 'global'
const RISK_SETTINGS_AUDIT_LOCK_KEY = 1_743_861_294

export interface RiskControlSettings {
  operator_data_risk_enabled: boolean;
  revision: number;
  updated_at: string | null;
}

export type RiskControlSettingsPatch = Partial<Pick<RiskControlSettings, 'operator_data_risk_enabled'>>

export interface RiskControlSettingsStore {
  get: () => Promise<RiskControlSettings | null>;
  set: (input: {
    patch: RiskControlSettingsPatch
    expectedRevision: number
    adminUsername: string
    reason: string
    requestId: string
  }) => Promise<RiskControlSettings>;
}

export const DEFAULT_RISK_CONTROL_SETTINGS: RiskControlSettings = {
  operator_data_risk_enabled: productPolicies.risk.operator_data_enabled_by_default,
  revision: 0,
  updated_at: null,
}

let schemaReady: Promise<void> | null = null

export function normalizeRiskControlSettings(value: unknown): RiskControlSettings {
  const source = value && typeof value === 'object' ? value as Partial<RiskControlSettings> : {}
  return {
    operator_data_risk_enabled: source.operator_data_risk_enabled ?? productPolicies.risk.operator_data_enabled_by_default,
    revision: Number.isSafeInteger(source.revision) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function createPostgresRiskControlSettingsStore(): RiskControlSettingsStore {
  return {
    get: async () => {
      await ensureSchema()
      const result = await query<{ record_json: RiskControlSettings; revision: number }>(
        'select record_json, revision from risk_settings where key = $1',
        [RISK_SETTINGS_KEY],
      )
      const row = result.rows[0]
      return row ? normalizeRiskControlSettings({ ...row.record_json, revision: row.revision }) : null
    },
    set: async (input) => {
      await ensureSchema()
      const reason = input.reason.trim()
      if (reason.length < 2 || reason.length > 500) throw new Error('风控设置变更原因需为 2-500 个字符。')
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SettingsConflictError()
      return withTransaction(async (client) => {
        const currentResult = await client.query<{ record_json: unknown; revision: number }>(
          'select record_json, revision from risk_settings where key = $1 for update',
          [RISK_SETTINGS_KEY],
        )
        const row = currentResult.rows[0]
        const currentRevision = row?.revision ?? 0
        if (currentRevision !== input.expectedRevision) throw new SettingsConflictError()
        const current = normalizeRiskControlSettings({
          ...(row?.record_json && typeof row.record_json === 'object' ? row.record_json : {}),
          revision: currentRevision,
        })
        const record = normalizeRiskControlSettings({
          ...current,
          ...input.patch,
          revision: currentRevision + 1,
          updated_at: new Date().toISOString(),
        })
        const saved = await client.query(
          `insert into risk_settings (key, record_json, updated_at, revision)
           values ($1, $2::jsonb, $3, $4)
           on conflict (key) do update set
             record_json = excluded.record_json,
             updated_at = excluded.updated_at,
             revision = excluded.revision
           where risk_settings.revision = $5`,
          [RISK_SETTINGS_KEY, JSON.stringify(record), record.updated_at, record.revision, input.expectedRevision],
        )
        if (saved.rowCount !== 1) throw new SettingsConflictError()
        await client.query('select pg_advisory_xact_lock($1)', [RISK_SETTINGS_AUDIT_LOCK_KEY])
        const previous = await client.query<{ entry_hash: string | null }>(
          `select entry_hash from risk_settings_audit
            order by created_at desc, id desc
            limit 1`,
        )
        const id = randomUUID()
        const previousHash = previous.rows[0]?.entry_hash ?? null
        const audit = {
          id,
          admin_username: input.adminUsername,
          settings_key: RISK_SETTINGS_KEY,
          reason,
          request_id: input.requestId,
          before: current,
          after: record,
          created_at: record.updated_at,
        }
        const entryHash = createHash('sha256').update(`${previousHash ?? ''}:${JSON.stringify(audit)}`).digest('hex')
        await client.query(
          `insert into risk_settings_audit
            (id, admin_username, settings_key, reason, request_id, before_json, after_json,
             previous_hash, entry_hash, created_at)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
          [
            id,
            input.adminUsername,
            RISK_SETTINGS_KEY,
            reason,
            input.requestId,
            JSON.stringify(current),
            JSON.stringify(record),
            previousHash,
            entryHash,
            record.updated_at,
          ],
        )
        return record
      })
    },
  }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
