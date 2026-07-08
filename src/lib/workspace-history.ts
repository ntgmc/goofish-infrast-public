import type { LicenseConfig, OptimizeResult } from './types'

export interface ConfigDiffItem {
  label: string;
  before: string;
  after: string;
}

const PRODUCT_LABELS: Record<string, string> = {
  LMD: '龙门币',
  Orundum: '合成玉',
  'Pure Gold': '赤金',
  'Battle Record': '作战记录',
  'Originium Shard': '源石碎片',
}

const SCHEDULE_MODE_LABELS: Record<string, string> = {
  maa: 'MAA 排班表',
  rotation: '游戏内轮换',
}

const DORMITORY_RULE_LABELS: Record<string, string> = {
  fixed: '排班表写死',
  maa_autofill: 'MAA 自动填满',
}

const DRONE_ORDER_LABELS: Record<string, string> = {
  pre: '换班前',
  post: '换班后',
}

export function describeConfigDiff(current: LicenseConfig, previous: LicenseConfig | null | undefined): ConfigDiffItem[] {
  if (!previous) {
    return [{ label: '上次配置', before: '无记录', after: formatConfigBrief(current) }]
  }

  const rows: ConfigDiffItem[] = []
  pushDiff(rows, '布局', previous.layout || formatLayout(previous), current.layout || formatLayout(current))
  pushDiff(rows, '排班模式', formatScheduleMode(previous), formatScheduleMode(current))
  pushDiff(rows, '宿舍规则', formatDormitoryRule(previous), formatDormitoryRule(current))
  pushDiff(rows, '贸易站产物', formatProductCounts(previous.product_requirements?.trading_stations), formatProductCounts(current.product_requirements?.trading_stations))
  pushDiff(rows, '制造站产物', formatProductCounts(previous.product_requirements?.manufacturing_stations), formatProductCounts(current.product_requirements?.manufacturing_stations))
  pushDiff(rows, '菲亚梅塔', previous.Fiammetta?.enable ? '启用' : '未启用', current.Fiammetta?.enable ? '启用' : '未启用')
  pushDiff(rows, '无人机', formatDrones(previous), formatDrones(current))
  pushDiff(rows, '中间产物库存', formatIntermediateInventory(previous), formatIntermediateInventory(current))
  return rows
}

export function downloadOptimizeResult(result: OptimizeResult, filenameBase = 'maa_schedule_optimized'): void {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenameBase}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function formatWorkspaceDate(value: string | null | undefined): string {
  if (!value) return '未知时间'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time))
}

export function formatPlanName(config: LicenseConfig | null | undefined, fallback = '未命名方案'): string {
  if (!config) return fallback
  return config.desc || config.layout || fallback
}

export function formatResultSummary(result: OptimizeResult): string {
  const mode = formatScheduleMode(result)
  const planCount = Array.isArray(result.plans) ? result.plans.length : 0
  const efficiency = typeof result.total_efficiency === 'number'
    ? ` · 总效率 ${Math.round(result.total_efficiency)}`
    : ''
  return `${mode} · ${planCount} 班${efficiency}`
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

function formatScheduleMode(value: Pick<LicenseConfig, 'schedule_mode'> | Pick<OptimizeResult, 'schedule_mode'>): string {
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
  if (entries.length === 0) return '未设置'
  return entries.map(([product, count]) => `${formatProduct(product)} x${count}`).join(' / ')
}

function formatProduct(product: string): string {
  return PRODUCT_LABELS[product] ?? product
}

function formatDroneOrder(order: string | undefined): string {
  return DRONE_ORDER_LABELS[order ?? 'pre'] ?? '自定义顺序'
}

function formatDroneAutoStrategy(config: LicenseConfig): string {
  const strategy = config.drones?.auto_strategy
  if (!strategy) return '默认策略'
  if (strategy === 'trading_priority') return '贸易站优先'
  if (strategy === 'manufacture_product') {
    const target = config.drones?.auto_target_product
    return target ? `制造站优先：${formatProduct(target)}` : '制造站优先'
  }
  return '自定义策略'
}

function formatDrones(config: LicenseConfig): string {
  if (!config.drones?.enable) return '未启用'
  if (config.drones.auto) return `自动 · ${formatDroneAutoStrategy(config)}`
  const targets = config.drones.targets?.length ? config.drones.targets.map(formatProduct).join(' / ') : '未指定目标'
  return `${formatDroneOrder(config.drones.order)} · ${targets}`
}

function formatIntermediateInventory(config: LicenseConfig): string {
  const entries = Object.entries(config.intermediate_inventory ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return '未设置'
  return entries.map(([product, count]) => `${formatProduct(product)} ${count}`).join(' / ')
}
