import type { FreeScheduleEntitlement, LicenseConfig, LicenseOperator } from '../../../lib/types'
import { canonicalJson } from '../../../lib/crypto'
import { SCHEDULE_PROGRESS_COMPLETION_DURATION_MS } from '../../../components/ScheduleProgress'
import { copy } from '../../../copy/index'


export function buildOptimizeSignature(operators: LicenseOperator[], config: LicenseConfig): string {
  return canonicalJson({ operators, config })
}

export function formatConfigPresetLabel(config: LicenseConfig): string {
  const layout = String(config.layout || `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`)
  const compactLayout = layout.replace(/-/g, '')
  const presetLayout = compactLayout === '243' || compactLayout === '333' ? compactLayout : layout
  const trading = config.product_requirements?.trading_stations ?? {}
  const suffix = (trading.Orundum ?? 0) > 0 ? copy.optimize.pages_tool_optimize_workflow_utils_001 : copy.optimize.pages_tool_optimize_workflow_utils_002
  return `${presetLayout} ${suffix}`
}

export function waitForProgressCompletion(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SCHEDULE_PROGRESS_COMPLETION_DURATION_MS))
}

export function formatOptimizeError(message: string): string {
  return message.includes(copy.optimize.pages_tool_optimize_workflow_utils_003) || message.includes(copy.optimize.pages_tool_optimize_workflow_utils_004) || message.includes(copy.optimize.pages_tool_optimize_workflow_utils_005)
    ? message
    : `${copy.optimize.pages_tool_optimize_workflow_utils_006}${message}`
}

export function getFreeScheduleGenerateBlockedReason(
  isPreviewProfile: boolean,
  entitlement: FreeScheduleEntitlement | null,
): string | null {
  if (!isPreviewProfile || !entitlement) return null
  if (hasUnusedStrongReorderBonus(entitlement)) return null
  if (!entitlement.first_generated_at) return null
  if (entitlement.confirmed_at || entitlement.locked_at) {
    return copy.optimize.pages_tool_optimize_workflow_utils_007
  }
  const firstGeneratedAt = Date.parse(entitlement.first_generated_at)
  if (!Number.isFinite(firstGeneratedAt)) return null
  const windowMs = entitlement.revision_window_hours * 60 * 60 * 1000
  if (Date.now() - firstGeneratedAt >= windowMs) {
    return copy.optimize.pages_tool_optimize_workflow_utils_008
  }
  if (entitlement.revision_count >= entitlement.revision_limit) {
    return copy.optimize.pages_tool_optimize_workflow_utils_009
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
