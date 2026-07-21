import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { BrevoQuotaAction } from '../../src/lib/types'

const REGISTRATION_SETTINGS_KEY = 'global'

export interface RegistrationSettingsV2 {
  version: 2
  email_verification_required: boolean
  brevo_quota_action: BrevoQuotaAction
  updated_at: string | null
}

export type RegistrationSettingsPatch = Pick<RegistrationSettingsV2, 'email_verification_required' | 'brevo_quota_action'>

export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettingsV2 = {
  version: 2,
  email_verification_required: true,
  brevo_quota_action: 'pause_registration',
  updated_at: null,
}

let schemaReady: Promise<void> | null = null

export function normalizeRegistrationSettings(value: unknown): RegistrationSettingsV2 {
  const source = value && typeof value === 'object' ? value as Partial<RegistrationSettingsV2> : {}
  return {
    version: 2,
    email_verification_required: typeof source.email_verification_required === 'boolean'
      ? source.email_verification_required
      : true,
    brevo_quota_action: isBrevoQuotaAction(source.brevo_quota_action)
      ? source.brevo_quota_action
      : 'pause_registration',
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function validateRegistrationSettingsPatch(value: unknown): RegistrationSettingsPatch {
  if (!value || typeof value !== 'object') throw new Error('注册设置必须是对象。')
  const source = value as Record<string, unknown>
  if (typeof source.email_verification_required !== 'boolean') throw new Error('邮箱验证设置必须是布尔值。')
  if (!isBrevoQuotaAction(source.brevo_quota_action)) throw new Error('Brevo 配额处理方式无效。')
  return {
    email_verification_required: source.email_verification_required,
    brevo_quota_action: source.brevo_quota_action,
  }
}

export async function getRegistrationSettings(): Promise<RegistrationSettingsV2> {
  await ensureSchema()
  const result = await query<{ record_json: RegistrationSettingsV2 }>(
    'select record_json from registration_settings where key = $1',
    [REGISTRATION_SETTINGS_KEY],
  )
  return normalizeRegistrationSettings(result.rows[0]?.record_json)
}

export async function saveRegistrationSettings(patch: RegistrationSettingsPatch): Promise<RegistrationSettingsV2> {
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

function isBrevoQuotaAction(value: unknown): value is BrevoQuotaAction {
  return value === 'pause_registration' || value === 'allow_unverified_registration'
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
