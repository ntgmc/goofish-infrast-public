import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

const REGISTRATION_SETTINGS_KEY = 'global'

export interface RegistrationSettingsV1 {
  version: 1
  email_verification_required: boolean
  updated_at: string | null
}

export type RegistrationSettingsPatch = Partial<Pick<RegistrationSettingsV1, 'email_verification_required'>>

export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettingsV1 = {
  version: 1,
  email_verification_required: true,
  updated_at: null,
}

let schemaReady: Promise<void> | null = null

export function normalizeRegistrationSettings(value: unknown): RegistrationSettingsV1 {
  const source = value && typeof value === 'object' ? value as Partial<RegistrationSettingsV1> : {}
  return {
    version: 1,
    email_verification_required: typeof source.email_verification_required === 'boolean'
      ? source.email_verification_required
      : true,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function validateRegistrationSettingsPatch(value: unknown): RegistrationSettingsPatch {
  if (!value || typeof value !== 'object') throw new Error('注册设置必须是对象。')
  const source = value as Record<string, unknown>
  if (typeof source.email_verification_required !== 'boolean') throw new Error('邮箱验证设置必须是布尔值。')
  return { email_verification_required: source.email_verification_required }
}

export async function getRegistrationSettings(): Promise<RegistrationSettingsV1> {
  await ensureSchema()
  const result = await query<{ record_json: RegistrationSettingsV1 }>(
    'select record_json from registration_settings where key = $1',
    [REGISTRATION_SETTINGS_KEY],
  )
  return normalizeRegistrationSettings(result.rows[0]?.record_json)
}

export async function saveRegistrationSettings(patch: RegistrationSettingsPatch): Promise<RegistrationSettingsV1> {
  await ensureSchema()
  const saved = normalizeRegistrationSettings({
    ...await getRegistrationSettings(),
    ...patch,
    updated_at: new Date().toISOString(),
  })
  await query(
    `insert into registration_settings (key, record_json, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set record_json = excluded.record_json, updated_at = now()`,
    [REGISTRATION_SETTINGS_KEY, JSON.stringify(saved)],
  )
  return saved
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
