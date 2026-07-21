import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { BrevoQuotaAction } from '../../src/lib/types'

const REGISTRATION_SETTINGS_KEY = 'global'

export interface RegistrationSettingsV4 {
  version: 4
  email_verification_required: boolean
  invite_code_required: boolean
  brevo_quota_action: BrevoQuotaAction
  admin_invite_email_reserve: number
  password_reset_email_reserve: number
  updated_at: string | null
}

export type RegistrationSettingsPatch = Pick<
  RegistrationSettingsV4,
  'email_verification_required' | 'invite_code_required' | 'brevo_quota_action' | 'admin_invite_email_reserve' | 'password_reset_email_reserve'
>

export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettingsV4 = {
  version: 4,
  email_verification_required: true,
  invite_code_required: false,
  brevo_quota_action: 'pause_registration',
  admin_invite_email_reserve: 0,
  password_reset_email_reserve: 0,
  updated_at: null,
}

let schemaReady: Promise<void> | null = null

export function normalizeRegistrationSettings(value: unknown): RegistrationSettingsV4 {
  const source = value && typeof value === 'object' ? value as Partial<RegistrationSettingsV4> : {}
  const adminInviteReserve = integerInRange(source.admin_invite_email_reserve, 0, 300, 0)
  const passwordResetReserve = Math.min(
    integerInRange(source.password_reset_email_reserve, 0, 300, 0),
    300 - adminInviteReserve,
  )
  return {
    version: 4,
    email_verification_required: typeof source.email_verification_required === 'boolean'
      ? source.email_verification_required
      : true,
    invite_code_required: source.invite_code_required === true,
    brevo_quota_action: isBrevoQuotaAction(source.brevo_quota_action)
      ? source.brevo_quota_action
      : 'pause_registration',
    admin_invite_email_reserve: adminInviteReserve,
    password_reset_email_reserve: passwordResetReserve,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function validateRegistrationSettingsPatch(value: unknown): RegistrationSettingsPatch {
  if (!value || typeof value !== 'object') throw new Error('注册设置必须是对象。')
  const source = value as Record<string, unknown>
  if (typeof source.email_verification_required !== 'boolean') throw new Error('邮箱验证设置必须是布尔值。')
  if (typeof source.invite_code_required !== 'boolean') throw new Error('仅邀请注册设置必须是布尔值。')
  if (!isBrevoQuotaAction(source.brevo_quota_action)) throw new Error('Brevo 配额处理方式无效。')
  const adminInviteReserve = requireReserve(source.admin_invite_email_reserve, '管理员邀请邮件预留')
  const passwordResetReserve = requireReserve(source.password_reset_email_reserve, '密码重置邮件预留')
  if (adminInviteReserve + passwordResetReserve > 300) throw new Error('两类邮件预留总和不能超过 300。')
  return {
    email_verification_required: source.email_verification_required,
    invite_code_required: source.invite_code_required,
    brevo_quota_action: source.brevo_quota_action,
    admin_invite_email_reserve: adminInviteReserve,
    password_reset_email_reserve: passwordResetReserve,
  }
}

export async function getRegistrationSettings(): Promise<RegistrationSettingsV4> {
  await ensureSchema()
  const result = await query<{ record_json: RegistrationSettingsV4 }>(
    'select record_json from registration_settings where key = $1',
    [REGISTRATION_SETTINGS_KEY],
  )
  return normalizeRegistrationSettings(result.rows[0]?.record_json)
}

export async function saveRegistrationSettings(patch: RegistrationSettingsPatch): Promise<RegistrationSettingsV4> {
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

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback
}

function requireReserve(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 300) {
    throw new Error(`${label}必须是 0 到 300 之间的整数。`)
  }
  return Number(value)
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
