import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { BrevoQuotaAction, EmailProviderPriority } from '../../src/lib/types'

const REGISTRATION_SETTINGS_KEY = 'global'

export interface RegistrationSettingsV5 {
  version: 5
  email_verification_required: boolean
  invite_code_required: boolean
  email_provider_priority: EmailProviderPriority
  brevo_quota_action: BrevoQuotaAction
  admin_invite_email_reserve: number
  password_reset_email_reserve: number
  updated_at: string | null
}

export type RegistrationSettingsPatch = Pick<
  RegistrationSettingsV5,
  'email_verification_required' | 'invite_code_required' | 'email_provider_priority' | 'brevo_quota_action' | 'admin_invite_email_reserve' | 'password_reset_email_reserve'
>

export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettingsV5 = {
  version: 5,
  email_verification_required: true,
  invite_code_required: false,
  email_provider_priority: ['brevo', 'ses'],
  brevo_quota_action: 'pause_registration',
  admin_invite_email_reserve: 0,
  password_reset_email_reserve: 0,
  updated_at: null,
}

export interface RegistrationSettingsValidationIssue {
  path: keyof RegistrationSettingsPatch | 'settings'
  message: string
}

export class RegistrationSettingsValidationError extends Error {
  readonly code = 'invalid_registration_settings'

  constructor(readonly issues: RegistrationSettingsValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('；') || '注册设置无效。')
    this.name = 'RegistrationSettingsValidationError'
  }
}

let schemaReady: Promise<void> | null = null

export function normalizeRegistrationSettings(value: unknown): RegistrationSettingsV5 {
  const source = value && typeof value === 'object' ? value as Partial<RegistrationSettingsV5> : {}
  const adminInviteReserve = integerInRange(source.admin_invite_email_reserve, 0, 300, 0)
  const passwordResetReserve = Math.min(
    integerInRange(source.password_reset_email_reserve, 0, 300, 0),
    300 - adminInviteReserve,
  )
  return {
    version: 5,
    email_verification_required: typeof source.email_verification_required === 'boolean'
      ? source.email_verification_required
      : true,
    invite_code_required: source.invite_code_required === true,
    email_provider_priority: isEmailProviderPriority(source.email_provider_priority)
      ? [...source.email_provider_priority]
      : ['brevo', 'ses'],
    brevo_quota_action: isBrevoQuotaAction(source.brevo_quota_action)
      ? source.brevo_quota_action
      : 'pause_registration',
    admin_invite_email_reserve: adminInviteReserve,
    password_reset_email_reserve: passwordResetReserve,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function validateRegistrationSettingsPatch(value: unknown): RegistrationSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RegistrationSettingsValidationError([{ path: 'settings', message: '注册设置必须是对象。' }])
  }
  const source = value as Record<string, unknown>
  const issues: RegistrationSettingsValidationIssue[] = []
  if (typeof source.email_verification_required !== 'boolean') {
    issues.push({ path: 'email_verification_required', message: '邮箱验证设置必须是布尔值。' })
  }
  if (typeof source.invite_code_required !== 'boolean') {
    issues.push({ path: 'invite_code_required', message: '仅邀请注册设置必须是布尔值。' })
  }
  if (!isEmailProviderPriority(source.email_provider_priority)) {
    issues.push({ path: 'email_provider_priority', message: '邮件服务优先级必须包含 Brevo 和 Amazon SES，且不能重复。' })
  }
  if (!isBrevoQuotaAction(source.brevo_quota_action)) {
    issues.push({ path: 'brevo_quota_action', message: 'Brevo 配额处理方式无效。' })
  }
  const adminInviteReserve = validateReserve(
    source.admin_invite_email_reserve,
    'admin_invite_email_reserve',
    '管理员邀请邮件保留额度',
    issues,
  )
  const passwordResetReserve = validateReserve(
    source.password_reset_email_reserve,
    'password_reset_email_reserve',
    '密码重置邮件保留额度',
    issues,
  )
  if (adminInviteReserve !== null && passwordResetReserve !== null
    && adminInviteReserve + passwordResetReserve > 300) {
    issues.push({ path: 'password_reset_email_reserve', message: '两项保留额度总和不能超过 300。' })
  }
  if (issues.length > 0) throw new RegistrationSettingsValidationError(issues)
  return {
    email_verification_required: source.email_verification_required as boolean,
    invite_code_required: source.invite_code_required as boolean,
    email_provider_priority: [...source.email_provider_priority as EmailProviderPriority],
    brevo_quota_action: source.brevo_quota_action as BrevoQuotaAction,
    admin_invite_email_reserve: adminInviteReserve!,
    password_reset_email_reserve: passwordResetReserve!,
  }
}

export async function getRegistrationSettings(): Promise<RegistrationSettingsV5> {
  await ensureSchema()
  const result = await query<{ record_json: RegistrationSettingsV5 }>(
    'select record_json from registration_settings where key = $1',
    [REGISTRATION_SETTINGS_KEY],
  )
  return normalizeRegistrationSettings(result.rows[0]?.record_json)
}

export async function saveRegistrationSettings(patch: RegistrationSettingsPatch): Promise<RegistrationSettingsV5> {
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

function isEmailProviderPriority(value: unknown): value is EmailProviderPriority {
  return Array.isArray(value)
    && value.length === 2
    && value.includes('brevo')
    && value.includes('ses')
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback
}

function validateReserve(
  value: unknown,
  path: 'admin_invite_email_reserve' | 'password_reset_email_reserve',
  label: string,
  issues: RegistrationSettingsValidationIssue[],
): number | null {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 300) {
    issues.push({ path, message: `${label}必须是 0 到 300 之间的整数。` })
    return null
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
