import type { FreeScheduleEntitlement, LicenseConfig, LicenseOperator, OptimizeResult, UpgradeSuggestion, WorkspaceResultHistoryItem, WorkspaceResultHistorySummary } from '../../../lib/types'
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

export function resolveLatestHistoryConfig(
  historyItem: WorkspaceResultHistoryItem | null,
  latestResult: WorkspaceResultHistorySummary | null,
): LicenseConfig | null {
  if (!historyItem || historyItem.id !== latestResult?.id) return null
  return historyItem.config
}

export function normalizeUpgradeSuggestions(
  suggestions: OptimizeResult['upgrade_suggestions'],
): UpgradeSuggestion[] {
  return (suggestions ?? [])
    .map((suggestion, index): UpgradeSuggestion => {
      if (suggestion.type === 'single') {
        return {
          type: 'single',
          suggestion_id: suggestion.suggestion_id,
          id: suggestion.id || suggestion.name || '',
          name: suggestion.name,
          current_elite: suggestion.current,
          target_elite: suggestion.target,
          gain: Math.round(suggestion.gain),
          desc: `${suggestion.name}${copy.optimize.pages_tool_optimize_useOptimizeWorkflow_017}${suggestion.current}${copy.optimize.pages_tool_optimize_useOptimizeWorkflow_018}${suggestion.target}`,
          training_cost: suggestion.training_cost,
          rooms: suggestion.rooms,
          specialType: suggestion.specialType,
          roi: suggestion.roi,
          orundum_roi: suggestion.orundum_roi,
          impact: suggestion.impact,
          partial_outcomes: suggestion.partial_outcomes,
          partial_outcomes_truncated: suggestion.partial_outcomes_truncated,
          partial_outcomes_unavailable_reason: suggestion.partial_outcomes_unavailable_reason,
        }
      }
      return {
        type: 'bundle',
        suggestion_id: suggestion.suggestion_id,
        id: `bundle-${index}`,
        gain: Math.round(suggestion.gain),
        desc: suggestion.ops.map((operator) => `${operator.name}${copy.optimize.pages_tool_optimize_useOptimizeWorkflow_019}${operator.current}${copy.optimize.pages_tool_optimize_useOptimizeWorkflow_020}${operator.target}`).join(', '),
        ops: suggestion.ops.map((operator) => ({
          id: operator.id || operator.name,
          name: operator.name,
          current: operator.current,
          target: operator.target,
          current_elite: operator.current,
          target_elite: operator.target,
        })),
        training_cost: suggestion.training_cost,
        rooms: suggestion.rooms,
        specialType: suggestion.specialType,
        roi: suggestion.roi,
        orundum_roi: suggestion.orundum_roi,
        impact: suggestion.impact,
        partial_outcomes: suggestion.partial_outcomes,
        partial_outcomes_truncated: suggestion.partial_outcomes_truncated,
        partial_outcomes_unavailable_reason: suggestion.partial_outcomes_unavailable_reason,
      }
    })
    .sort((left, right) => right.gain - left.gain)
    .slice(0, 20)
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

function hasUnusedStrongReorderBonus(entitlement: FreeScheduleEntitlement): boolean {
  const bonus = entitlement.strong_reorder_bonus
  return Boolean(bonus && bonus.month === getShanghaiMonthKey() && !bonus.used_at)
}

function getShanghaiMonthKey(date = new Date()): string {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}
