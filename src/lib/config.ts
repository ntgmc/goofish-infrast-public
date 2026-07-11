import type { IntermediateProduct, LicenseConfig, PermissionMode } from './types'

type ProductGroup = 'trading_stations' | 'manufacturing_stations'

export const TRADING_PRODUCTS = ['LMD', 'Orundum']
export const MANUFACTURING_PRODUCTS = ['Pure Gold', 'Battle Record', 'Originium Shard']

export const PRODUCT_LABELS: Record<string, string> = {
  LMD: '龙门币',
  Orundum: '合成玉',
  'Pure Gold': '赤金',
  'Battle Record': '作战记录',
  'Originium Shard': '源石碎片',
}

export const SCHEDULE_MODE_LABELS: Record<string, string> = {
  maa: 'MAA 排班表',
  rotation: '游戏内轮换',
  variable: 'MAA 自动非固定',
}

export const DORMITORY_RULE_LABELS: Record<string, string> = {
  fixed: '排班表写死',
  maa_autofill: 'MAA 自动填满',
}

const DEFAULT_SHIFT_HOURS = [8, 8, 8]


export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  recommended: '单次重置卡',
  growth: '练度提升卡',
  advanced: '单账号终身卡',
  ultimate: 'Admin卡',
  admin: 'Admin卡',
}

export const CONFIG_PRESETS: Record<string, LicenseConfig> = {
  '243': {
    layout: '2-4-3',
    desc: '243 均衡流 (2赤金/2经验)',
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 2 },
      manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  '243-1': {
    layout: '2-4-3',
    desc: '243 搓玉 (2赤金/2源石)',
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 1, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  '333': {
    layout: '3-3-3',
    desc: '333 搓玉流',
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 3,
    manufacturing_stations_count: 3,
    product_requirements: {
      trading_stations: { LMD: 2, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 1 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
}

export function cloneConfig(config: LicenseConfig): LicenseConfig {
  return JSON.parse(JSON.stringify(config)) as LicenseConfig
}

export function normalizeScheduleMode(mode: unknown): 'maa' | 'rotation' | 'variable' {
  const modeText = String(mode ?? 'maa').trim().toLowerCase()
  if (['rotation', 'rotate', 'game_rotation', 'in_game_rotation', '轮换', '轮换模式', '游戏内轮换'].includes(modeText)) {
    return 'rotation'
  }
  if (['variable', 'variable_shift', 'variable-shift', 'variable_shift_schedule', '一天n换', '一天 n 换', '非固定间隔'].includes(modeText)) {
    return 'variable'
  }
  return 'maa'
}

export function normalizeDormitoryRule(rule: unknown): 'fixed' | 'maa_autofill' {
  const ruleText = String(rule ?? 'fixed').trim().toLowerCase()
  return ['maa_autofill', 'maa-autofill', 'autofill', 'auto', 'maa自动填满', '自动填满'].includes(ruleText)
    ? 'maa_autofill'
    : 'fixed'
}

export function parseShiftHours(value: unknown): number[] | null {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[-,，、\s]+/).filter(Boolean)
      : null
  if (!items) return null
  const hours = items.map((item) => Number(item))
  if (hours.length === 0 || hours.length > 6) return null
  if (hours.some((hour) => !Number.isFinite(hour) || hour <= 0)) return null
  return hours.map((hour) => Math.round(hour * 100) / 100)
}

export function isValidShiftHours(hours: number[]): boolean {
  const total = hours.reduce((sum, hour) => sum + hour, 0)
  return Math.abs(total - 24) <= 0.0001
}

function sumCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

export function normalizeConfig(config: LicenseConfig): LicenseConfig {
  const next = cloneConfig(config)
  const parsedShiftHours = parseShiftHours(next.shift_hours)
  next.product_requirements = {
    trading_stations: { ...(next.product_requirements?.trading_stations ?? {}) },
    manufacturing_stations: { ...(next.product_requirements?.manufacturing_stations ?? {}) },
  }
  next.trading_stations_count = Number.isFinite(next.trading_stations_count) ? next.trading_stations_count : 2
  next.manufacturing_stations_count = Number.isFinite(next.manufacturing_stations_count) ? next.manufacturing_stations_count : 4
  next.schedule_mode = normalizeScheduleMode(next.schedule_mode ?? next.mode)
  next.dormitory_rule = normalizeDormitoryRule(next.dormitory_rule)
  next.shift_hours = parsedShiftHours && isValidShiftHours(parsedShiftHours)
    ? parsedShiftHours
    : [...DEFAULT_SHIFT_HOURS]
  next.layout = next.layout || `${next.trading_stations_count}-${next.manufacturing_stations_count}-3`
  next.desc = next.desc || `${next.layout} 基建配置`
  next.Fiammetta = next.Fiammetta ?? { enable: false }
  next.drones = {
    enable: next.drones?.enable ?? false,
    auto: next.drones?.auto ?? false,
    auto_strategy: next.drones?.auto_strategy,
    auto_target_product: next.drones?.auto_target_product,
    order: next.drones?.order ?? 'pre',
    targets: Array.isArray(next.drones?.targets) ? next.drones.targets : [],
  }
  next.intermediate_inventory = normalizeIntermediateInventory(next.intermediate_inventory)
  return next
}

function applyCounts(config: LicenseConfig): LicenseConfig {
  config.layout = `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`
  config.desc = `${config.layout} 自定义配置`
  return config
}

export function validateConfig(config: LicenseConfig): { ok: true } | { ok: false; message: string } {
  const rotationMode = normalizeScheduleMode(config.schedule_mode) === 'rotation'
  const tradingCount = config.trading_stations_count
  const manufacturingCount = config.manufacturing_stations_count
  if (!Number.isInteger(tradingCount) || !Number.isInteger(manufacturingCount)) {
    return { ok: false, message: '贸易站和制造站数量必须是整数。' }
  }
  if (tradingCount < 1 || manufacturingCount < 1 || tradingCount + manufacturingCount !== 6) {
    return { ok: false, message: '当前版本固定 3 个发电站，贸易站 + 制造站需要等于 6。' }
  }
  const tradingTotal = sumCounts(config.product_requirements.trading_stations)
  if (tradingTotal !== tradingCount) {
    return { ok: false, message: `贸易产物数量合计为 ${tradingTotal}，需要等于 ${tradingCount}。` }
  }
  const manufacturingTotal = sumCounts(config.product_requirements.manufacturing_stations)
  if (manufacturingTotal !== manufacturingCount) {
    return { ok: false, message: `制造产物数量合计为 ${manufacturingTotal}，需要等于 ${manufacturingCount}。` }
  }
  const shiftHours = parseShiftHours(config.shift_hours)
  if (!rotationMode && (!shiftHours || !isValidShiftHours(shiftHours))) {
    return { ok: false, message: 'MAA 换班间隔需要由 1–6 个正数构成，并覆盖完整 24 小时。' }
  }
  if (!rotationMode && config.drones?.enable && !config.drones.auto && (!Array.isArray(config.drones.targets) || config.drones.targets.length === 0)) {
    return { ok: false, message: '启用无人机时至少需要一个加速目标。' }
  }
  return { ok: true }
}

function normalizeIntermediateInventory(value: unknown): Record<IntermediateProduct, number> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const next: Record<IntermediateProduct, number> = {
    'Originium Shard': 0,
    'Pure Gold': 0,
    'Orirock Cube': 0,
  }
  for (const product of Object.keys(next) as IntermediateProduct[]) {
    const count = Number(source[product])
    next[product] = Number.isFinite(count) ? Math.max(0, Math.round(count * 100) / 100) : 0
  }
  return next
}
