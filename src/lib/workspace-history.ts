import type { LicenseConfig, OptimizeResult, WorkspaceResultHistorySummary } from './types'
import { copy, CURRENT_LOCALE } from '../copy/index'


export interface ConfigDiffItem {
  label: string;
  before: string;
  after: string;
}

const PRODUCT_LABELS: Record<string, string> = {
  LMD: copy.common.lib_workspace_history_001,
  Orundum: copy.common.lib_workspace_history_002,
  'Pure Gold': copy.common.lib_workspace_history_003,
  'Battle Record': copy.common.lib_workspace_history_004,
  'Originium Shard': copy.common.lib_workspace_history_005,
}

const SCHEDULE_MODE_LABELS: Record<string, string> = {
  maa: copy.common.lib_workspace_history_006,
  rotation: copy.common.lib_workspace_history_007,
}

const DORMITORY_RULE_LABELS: Record<string, string> = {
  fixed: copy.common.lib_workspace_history_008,
  maa_autofill: copy.common.lib_workspace_history_009,
}

const DRONE_ORDER_LABELS: Record<string, string> = {
  pre: copy.common.lib_workspace_history_010,
  post: copy.common.lib_workspace_history_011,
}

export function describeConfigDiff(current: LicenseConfig, previous: LicenseConfig | null | undefined): ConfigDiffItem[] {
  if (!previous) {
    return [{ label: copy.common.lib_workspace_history_012, before: copy.common.lib_workspace_history_013, after: formatConfigBrief(current) }]
  }

  const rows: ConfigDiffItem[] = []
  pushDiff(rows, copy.common.lib_workspace_history_014, previous.layout || formatLayout(previous), current.layout || formatLayout(current))
  pushDiff(rows, copy.common.lib_workspace_history_015, formatScheduleMode(previous), formatScheduleMode(current))
  pushDiff(rows, copy.common.lib_workspace_history_016, formatDormitoryRule(previous), formatDormitoryRule(current))
  pushDiff(rows, copy.common.lib_workspace_history_017, formatProductCounts(previous.product_requirements?.trading_stations), formatProductCounts(current.product_requirements?.trading_stations))
  pushDiff(rows, copy.common.lib_workspace_history_018, formatProductCounts(previous.product_requirements?.manufacturing_stations), formatProductCounts(current.product_requirements?.manufacturing_stations))
  pushDiff(rows, copy.common.lib_workspace_history_019, previous.Fiammetta?.enable ? copy.common.lib_workspace_history_020 : copy.common.lib_workspace_history_021, current.Fiammetta?.enable ? copy.common.lib_workspace_history_022 : copy.common.lib_workspace_history_023)
  pushDiff(rows, copy.common.lib_workspace_history_024, formatDrones(previous), formatDrones(current))
  pushDiff(rows, copy.common.lib_workspace_history_025, formatIntermediateInventory(previous), formatIntermediateInventory(current))
  return rows
}

export function formatWorkspaceDate(value: string | null | undefined): string {
  if (!value) return copy.common.lib_workspace_history_026
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Intl.DateTimeFormat(CURRENT_LOCALE, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time))
}

export function formatPlanName(config: LicenseConfig | null | undefined, fallback = copy.common.lib_workspace_history_027): string {
  if (!config) return fallback
  return config.desc || config.layout || fallback
}

export function formatResultHistorySummary(summary: WorkspaceResultHistorySummary): string {
  return formatScheduleMode(summary)
}

export function isMaaJsonDownloadable(result: OptimizeResult): boolean {
  return result.schedule_mode !== 'rotation'
}

function pushDiff(rows: ConfigDiffItem[], label: string, before: string, after: string): void {
  if (before === after) return
  rows.push({ label, before, after })
}

function formatConfigBrief(config: LicenseConfig): string {
  return `${config.layout || formatLayout(config)} · ${formatScheduleMode(config)} · ${formatProductCounts(config.product_requirements?.trading_stations)}`
}

function formatLayout(config: LicenseConfig): string {
  return `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`
}

function formatScheduleMode(value: { schedule_mode?: string | null }): string {
  const mode = String(value.schedule_mode ?? 'maa')
  return SCHEDULE_MODE_LABELS[mode] ?? mode
}

function formatDormitoryRule(config: LicenseConfig): string {
  const rule = String(config.dormitory_rule ?? 'fixed')
  return DORMITORY_RULE_LABELS[rule] ?? rule
}

function formatProductCounts(counts: Record<string, number> | undefined): string {
  const entries = Object.entries(counts ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return copy.common.lib_workspace_history_030
  return entries.map(([product, count]) => `${formatProduct(product)} x${count}`).join(' / ')
}

function formatProduct(product: string): string {
  return PRODUCT_LABELS[product] ?? product
}

function formatDroneOrder(order: string | undefined): string {
  return DRONE_ORDER_LABELS[order ?? 'pre'] ?? copy.common.lib_workspace_history_031
}

function formatDroneAutoStrategy(config: LicenseConfig): string {
  const strategy = config.drones?.auto_strategy
  if (!strategy) return copy.common.lib_workspace_history_032
  if (strategy === 'trading_priority') return copy.common.lib_workspace_history_033
  if (strategy === 'manufacture_product') {
    const target = config.drones?.auto_target_product
    return target ? `${copy.common.lib_workspace_history_034}${formatProduct(target)}` : copy.common.lib_workspace_history_035
  }
  return copy.common.lib_workspace_history_036
}

function formatDrones(config: LicenseConfig): string {
  if (!config.drones?.enable) return copy.common.lib_workspace_history_037
  if (config.drones.auto) return `${copy.common.lib_workspace_history_038}${formatDroneAutoStrategy(config)}`
  const targets = config.drones.targets?.length ? config.drones.targets.map(formatProduct).join(' / ') : copy.common.lib_workspace_history_039
  return `${formatDroneOrder(config.drones.order)} · ${targets}`
}

function formatIntermediateInventory(config: LicenseConfig): string {
  const entries = Object.entries(config.intermediate_inventory ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return copy.common.lib_workspace_history_040
  return entries.map(([product, count]) => `${formatProduct(product)} ${count}`).join(' / ')
}
