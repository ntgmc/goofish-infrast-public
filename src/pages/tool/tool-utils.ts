import type { LicenseConfig, LicenseFile, LicenseOperator, PermissionMode, UserGameAccount } from '../../lib/types'
import { copy, CURRENT_LOCALE } from '../../copy/index'
import { getPermissionProfile, normalizeRuntimePermission } from '../../lib/product-catalog'
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../../lib/auth-constraints'


export function createAccountLicense(profile: UserGameAccount, operators: LicenseOperator[], config: LicenseConfig): LicenseFile {
  return {
    version: 1,
    order_hash: profile.cdk_order_hash ?? profile.id.slice(0, 16),
    operators,
    config,
    permission: normalizePermission(getEffectiveProfilePermission(profile)),
    issued_at: profile.created_at,
    sig: `account-${profile.id}`,
  }
}

export function countOwnedOperators(operators: LicenseOperator[] | null | undefined): number {
  return operators?.filter((operator) => operator.own !== false).length ?? 0
}

export function isFreePreviewProfile(profile: UserGameAccount): boolean {
  return profile.kind === 'free_preview'
}

export function isFreePreviewTrialActive(profile: UserGameAccount): boolean {
  return isFreePreviewProfile(profile) && profile.trial?.active === true
}

export function getEffectiveProfilePermission(profile: UserGameAccount): PermissionMode {
  return profile.trial?.effective_permission ?? profile.permission
}

export function isSchedulableProfile(profile: UserGameAccount): boolean {
  return !profile.archived_at && (profile.kind === 'cdk' || profile.kind === 'free_preview'
    || profile.kind === 'metered_personal' || profile.kind === 'metered_commercial')
}

export function getProfileAccessLabel(profile: UserGameAccount): string {
  if (isFreePreviewTrialActive(profile)) return copy.workspace.pages_tool_tool_utils_001
  if (isFreePreviewProfile(profile)) return copy.workspace.pages_tool_tool_utils_002
  return getPermissionProfile(profile.permission).label
}

export function sortOperatorsForPreview(operators: LicenseOperator[]): LicenseOperator[] {
  return [...operators].sort((left, right) => (
    numberValue(right.elite) - numberValue(left.elite)
    || numberValue(right.level) - numberValue(left.level)
    || left.name.localeCompare(right.name, CURRENT_LOCALE)
    || left.id.localeCompare(right.id)
  ))
}

export function parseOperatorsText(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) || data.length === 0) throw new Error(copy.workspace.pages_tool_tool_utils_008)
  const requiredKeys = ['id', 'name', 'own', 'elite', 'rarity']
  data.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`${copy.workspace.pages_tool_tool_utils_009}${index + 1}${copy.workspace.pages_tool_tool_utils_010}`)
    for (const key of requiredKeys) {
      if (!(key in raw)) throw new Error(`${copy.workspace.pages_tool_tool_utils_011}${index + 1}${copy.workspace.pages_tool_tool_utils_012}${key}${copy.workspace.pages_tool_tool_utils_013}`)
    }
  })
  return data as LicenseOperator[]
}

export function validatePasswordInput(value: string): string | null {
  if (!value) return copy.workspace.pages_tool_tool_utils_016
  if (value.length < AUTH_PASSWORD_MIN_LENGTH) return copy.workspace.pages_tool_tool_utils_017
  if (value.length > AUTH_PASSWORD_MAX_LENGTH) return copy.workspace.pages_tool_tool_utils_018
  return null
}

export function inputClassName(hasError: boolean, extra = ''): string {
  const base = 'tool-field'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : ''
  return `${base} ${state} ${extra}`.trim()
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(CURRENT_LOCALE, { hour12: false })
}

export function formatShanghaiDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(CURRENT_LOCALE, {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function normalizePermission(permission: PermissionMode): PermissionMode {
  return normalizeRuntimePermission(permission)
}
