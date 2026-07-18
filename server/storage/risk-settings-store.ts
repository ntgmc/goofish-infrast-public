import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { productPolicies } from '../../src/lib/product-catalog'

const RISK_SETTINGS_KEY = 'global'

export interface RiskControlSettings {
  operator_data_risk_enabled: boolean;
  updated_at: string | null;
}

export type RiskControlSettingsPatch = Partial<Pick<RiskControlSettings, 'operator_data_risk_enabled'>>

export interface RiskControlSettingsStore {
  get: () => Promise<RiskControlSettings | null>;
  set: (settings: RiskControlSettings) => Promise<RiskControlSettings>;
}

export const DEFAULT_RISK_CONTROL_SETTINGS: RiskControlSettings = {
  operator_data_risk_enabled: productPolicies.risk.operator_data_enabled_by_default,
  updated_at: null,
}

let schemaReady: Promise<void> | null = null

export function normalizeRiskControlSettings(value: unknown): RiskControlSettings {
  const source = value && typeof value === 'object' ? value as Partial<RiskControlSettings> : {}
  return {
    operator_data_risk_enabled: source.operator_data_risk_enabled ?? productPolicies.risk.operator_data_enabled_by_default,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function createPostgresRiskControlSettingsStore(): RiskControlSettingsStore {
  return {
    get: async () => {
      await ensureSchema()
      const result = await query<{ record_json: RiskControlSettings }>(
        'select record_json from risk_settings where key = $1',
        [RISK_SETTINGS_KEY],
      )
      return result.rows[0]?.record_json ?? null
    },
    set: async (settings) => {
      await ensureSchema()
      const record = normalizeRiskControlSettings({
        ...settings,
        updated_at: new Date().toISOString(),
      })
      await query(
        `insert into risk_settings (key, record_json, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (key) do update set
          record_json = excluded.record_json,
          updated_at = now()`,
        [RISK_SETTINGS_KEY, JSON.stringify(record)],
      )
      return record
    },
  }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
