import type { LicenseConfig, LicenseFile, LicenseOperator, PermissionMode, UserGameAccount } from '../../lib/types'

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

export function isCdkProfile(profile: UserGameAccount): boolean {
  return profile.kind === 'cdk'
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
  return profile.kind === 'cdk' || profile.kind === 'free_preview'
}

export function getProfileAccessLabel(profile: UserGameAccount): string {
  if (isFreePreviewTrialActive(profile)) return '高级版限时体验'
  if (isFreePreviewProfile(profile)) return '免费预览'
  if (profile.permission === 'recommended') return '单次重置卡'
  if (profile.permission === 'growth') return '练度提升卡'
  if (profile.permission === 'advanced') return '单账号终身卡'
  if (profile.permission === 'ultimate' || profile.permission === 'admin') return 'Admin卡'
  return '练度提升卡'
}

export function sortOperatorsForPreview(operators: LicenseOperator[]): LicenseOperator[] {
  return [...operators].sort((left, right) => (
    numberValue(right.elite) - numberValue(left.elite)
    || numberValue(right.level) - numberValue(left.level)
    || left.name.localeCompare(right.name, 'zh-CN')
    || left.id.localeCompare(right.id)
  ))
}

export function formatPreviewEfficiency(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${value.toFixed(1)}%`
}

export function parseOperatorsText(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) || data.length === 0) throw new Error('干员数据不能为空。')
  const requiredKeys = ['id', 'name', 'own', 'elite', 'rarity']
  data.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 个干员不是对象。`)
    for (const key of requiredKeys) {
      if (!(key in raw)) throw new Error(`第 ${index + 1} 个干员缺少 ${key} 字段。`)
    }
  })
  return data as LicenseOperator[]
}

export function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入正确的邮箱地址'
  return null
}

export function validatePasswordInput(value: string): string | null {
  if (!value) return '请输入密码'
  if (value.length < 8) return '密码至少需要 8 位'
  return null
}

export function inputClassName(hasError: boolean, extra = ''): string {
  const base = 'w-full rounded-lg border px-3 py-2 text-sm text-ink-primary outline-none transition-colors duration-150 focus:ring-2'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : 'border-surface-4 bg-surface-0 focus:border-brand-500 focus:ring-brand-500/20'
  return `${base} ${state} ${extra}`.trim()
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
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
  if (permission === 'recommended' || permission === 'growth' || permission === 'advanced' || permission === 'ultimate' || permission === 'admin') return permission
  return 'growth'
}
