import type { FreeScheduleEntitlement, LicenseConfig, LicenseOperator } from '../../../lib/types'
import { canonicalJson } from '../../../lib/crypto'
import { SCHEDULE_PROGRESS_COMPLETION_DURATION_MS } from '../../../components/ScheduleProgress'

export function buildOptimizeSignature(operators: LicenseOperator[], config: LicenseConfig): string {
  return canonicalJson({ operators, config })
}

export function formatConfigPresetLabel(config: LicenseConfig): string {
  const layout = String(config.layout || `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`)
  const compactLayout = layout.replace(/-/g, '')
  const presetLayout = compactLayout === '243' || compactLayout === '333' ? compactLayout : layout
  const trading = config.product_requirements?.trading_stations ?? {}
  const suffix = (trading.Orundum ?? 0) > 0 ? '搓玉' : '均衡'
  return `${presetLayout} ${suffix}`
}

export function waitForProgressCompletion(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SCHEDULE_PROGRESS_COMPLETION_DURATION_MS))
}

export function formatOptimizeError(message: string): string {
  return message.includes('冻结') || message.includes('被冻结') || message.includes('已拦截')
    ? message
    : `优化失败: ${message}`
}

export function getFreeScheduleGenerateBlockedReason(
  isPreviewProfile: boolean,
  entitlement: FreeScheduleEntitlement | null,
): string | null {
  if (!isPreviewProfile || !entitlement) return null
  if (hasUnusedStrongReorderBonus(entitlement)) return null
  if (!entitlement.first_generated_at) return null
  if (entitlement.confirmed_at || entitlement.locked_at) {
    return '免费完整排班权益已锁定。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。'
  }
  const firstGeneratedAt = Date.parse(entitlement.first_generated_at)
  if (!Number.isFinite(firstGeneratedAt)) return null
  const windowMs = entitlement.revision_window_hours * 60 * 60 * 1000
  if (Date.now() - firstGeneratedAt >= windowMs) {
    return '免费完整排班确认期已结束。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。'
  }
  if (entitlement.revision_count >= entitlement.revision_limit) {
    return '免费完整排班修正次数已用完。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。'
  }
  return null
}

export function hasUnusedStrongReorderBonus(entitlement: FreeScheduleEntitlement): boolean {
  const bonus = entitlement.strong_reorder_bonus
  return Boolean(bonus && bonus.month === getShanghaiMonthKey() && !bonus.used_at)
}

export function getShanghaiMonthKey(date = new Date()): string {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

export function parseOperatorsFile(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('干员数据不能为空。')
  }
  const requiredKeys = ['id', 'name', 'own', 'elite', 'rarity'] as const
  for (const [index, raw] of data.entries()) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`第 ${index + 1} 个干员不是对象。`)
    }
    const op = raw as Record<string, unknown>
    const missing = requiredKeys.filter((key) => !(key in op))
    if (missing.length > 0) {
      throw new Error(`干员 ${String(op.name ?? index + 1)} 缺少字段: ${missing.join(', ')}。`)
    }
    if (typeof op.id !== 'string' || typeof op.name !== 'string' || typeof op.own !== 'boolean') {
      throw new Error(`干员 ${String(op.name ?? index + 1)} 的 id/name/own 格式不正确。`)
    }
    if (!Number.isFinite(op.elite) || !Number.isFinite(op.rarity)) {
      throw new Error(`干员 ${String(op.name)} 的 elite/rarity 必须是数字。`)
    }
  }
  return data as LicenseOperator[]
}
