import type { DailyProduction, LicenseOperator, OptimizeResult, ShiftRoom } from '../../lib/types'
import { calculateProductionSanity } from '../../lib/production-sanity'
import { PRODUCT_LABELS, ROOM_LABELS } from './labels'
import type { PreparedPlan, RoomOperator } from './types'

const MAX_MOOD_FALLBACK = 24
const ROOM_DISPLAY_ORDER = ['trading', 'manufacture', 'power', 'control', 'meeting', 'dormitory'] as const
const UNKNOWN_ROOM_DISPLAY_RANK = ROOM_DISPLAY_ORDER.length
const ROOM_DISPLAY_RANK: Record<string, number> = ROOM_DISPLAY_ORDER.reduce(
  (rank, roomType, index) => ({ ...rank, [roomType]: index }),
  {},
)

export type DroneGainSummary = {
  value: string;
  suffix: string;
  note: string;
}

export type PreparedIntermediateDepletion = {
  product: string;
  label: string;
  stock: number;
  netPerDay: number;
  daysRemaining: number | null;
}

export type PreparedResult = {
  totalEff: number;
  rawTotalEff: number;
  hasDailyProduction: boolean;
  rotationStatsNote?: string;
  plans: PreparedPlan[];
  productionStats: {
    manufacturing: Record<string, number>;
    manufacturingTotal: number;
    lmd: number;
    orundum: number;
    goldNet: number;
    droneGain: DroneGainSummary;
  };
  productionSanity: { value: number; note: string };
  intermediateDepletion: PreparedIntermediateDepletion[];
  maaDefaultComparison?: {
    sanityDelta: number;
    sanityDeltaNote: string;
    baselineSanity: number;
    totalEfficiencyDelta: number;
    rawTotalEfficiencyDelta: number;
    lmdDelta: number;
    goldNetDelta: number;
    baselineTotalEfficiency: number;
    baselineLmd: number;
    baselineGoldNet: number;
    warnings: string[];
  };
  detailStats: { planCount: number; roomCount: number };
}

function getSortedRoomEntries(roomsByType: Record<string, ShiftRoom[]>): [string, ShiftRoom[]][] {
  return Object.entries(roomsByType)
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const rankDelta = getRoomDisplayRank(left.entry[0]) - getRoomDisplayRank(right.entry[0])
      return rankDelta !== 0 ? rankDelta : left.index - right.index
    })
    .map(({ entry }) => entry)
}

function getRoomDisplayRank(roomType: string): number {
  return ROOM_DISPLAY_RANK[roomType] ?? UNKNOWN_ROOM_DISPLAY_RANK
}

export function prepareResult(
  result: OptimizeResult,
  isRotationMode: boolean,
  isMaaDormitoryAutofill: boolean,
  operators: LicenseOperator[] = [],
): PreparedResult {
  const operatorLookup = buildOperatorLookup(operators)
  const rawTotalEff = result.raw_total_efficiency ??
    result.raw_results.reduce((sum, item) => sum + (item?.total_efficiency ?? 0), 0)
  const totalEff = result.total_efficiency ?? rawTotalEff
  const hasDailyProduction = Boolean(result.daily_production)
  const rotationStatsNote = isRotationMode
    ? `按每队列 ${result.rotation_mode?.shift_hours_per_queue ?? 12}h 计算，日产量折算 ${result.rotation_mode?.daily_production_normalized_hours ?? 24}h`
    : undefined
  const plans: PreparedPlan[] = result.plans.map((plan, planIndex) => ({
    ...plan,
    rows: getSortedRoomEntries(plan.rooms ?? {}).flatMap(([roomType, rooms]) => {
      if (!Array.isArray(rooms)) return []
      if (isRotationMode && roomType === 'dormitory') return []
      return rooms.flatMap((room, index) => {
        const queueLabel = isRotationMode ? plan.name || `队列 ${planIndex + 1}` : plan.name || `班次 ${planIndex + 1}`
        if (roomType === 'dormitory' && isMaaDormitoryAutofill) {
          if (index > 0) return []
          return [{
            key: `${planIndex}-${roomType}-maa-autofill`,
            label: ROOM_LABELS[roomType] || roomType,
            indexLabel: '',
            roomType,
            roomIndex: index,
            queueLabel,
            product: '-',
            operators: [],
            operatorText: '宿舍由 MAA 自动填满',
            efficiency: '-',
            speedEfficiency: '-',
            detail: '导出的 MAA JSON 不写死宿舍干员',
            detailItems: ['导出的 MAA JSON 不写死宿舍干员'],
            hasAdjustedSpeed: false,
            isAutofill: true,
          }]
        }
        const ops = room.operators
        if (!Array.isArray(ops) || ops.length === 0) return []
        const efficiency = getDisplayEfficiency(room)
        const speedEfficiency = getEffectiveEfficiency(roomType, room)
        const hasAdjustedSpeed = Math.abs(speedEfficiency - efficiency) >= 0.05
        const detailItems = [
          `${isRotationMode ? '房间效率' : '显示效率'} ${formatPercent(efficiency)}`,
          `速度效率 ${formatPercent(speedEfficiency)}`,
          getEfficiencyDetail(roomType, room),
          getMoodDetail(room, isRotationMode),
        ].filter(Boolean)
        const detail = detailItems
          .filter(Boolean)
          .join(' · ')
        return {
          key: `${planIndex}-${roomType}-${index}`,
          label: ROOM_LABELS[roomType] || roomType,
          indexLabel: rooms.length > 1 ? String(index + 1) : '',
          roomType,
          roomIndex: index,
          queueLabel,
          product: formatProduct(room.product),
          operators: resolveRoomOperators(ops, operatorLookup),
          operatorText: ops.join('、'),
          efficiency: formatPercent(efficiency),
          speedEfficiency: formatPercent(speedEfficiency),
          detail,
          detailItems,
          hasAdjustedSpeed,
        }
      })
    }),
  }))

  const daily = result.daily_production ?? {}
  const manufacturing = daily.manufacturing ?? {}
  const droneGain = summarizeDroneGains(daily.details ?? [])
  const productionStats = {
    manufacturing,
    manufacturingTotal: Object.values(manufacturing).reduce((sum, value) => sum + value, 0),
    lmd: daily.trading?.LMD ?? 0,
    orundum: daily.trading?.Orundum ?? 0,
    goldNet: daily.net?.['Pure Gold'] ?? 0,
    droneGain,
  }
  const productionSanity = calculateProductionSanity(daily)
  const intermediateDepletion = (result.intermediate_depletion ?? []).map((item) => ({
    product: item.product,
    label: formatProduct(item.product),
    stock: item.stock,
    netPerDay: item.net_per_day,
    daysRemaining: item.days_remaining,
  }))
  const maaDefaultComparison = !isRotationMode && result.maa_default_comparison
    ? (() => {
        const comparison = result.maa_default_comparison
        const deltaDaily: Partial<DailyProduction> = {
          manufacturing: comparison.delta.manufacturing,
          trading: comparison.delta.trading,
          consumption: comparison.delta.consumption,
          net: comparison.delta.net,
          drones: comparison.delta.drones,
        }
        const baselineSanity = calculateProductionSanity(comparison.baseline.daily_production ?? {})
        const sanityDelta = calculateProductionSanity(deltaDaily)
        return {
          sanityDelta: sanityDelta.value,
          sanityDeltaNote: `相对 MAA 默认 ${formatSigned(sanityDelta.value)} 理智/日（${sanityDelta.note}）`,
          baselineSanity: baselineSanity.value,
          totalEfficiencyDelta: comparison.delta.total_efficiency,
          rawTotalEfficiencyDelta: comparison.delta.raw_total_efficiency,
          lmdDelta: comparison.delta.trading.LMD ?? 0,
          goldNetDelta: comparison.delta.net['Pure Gold'] ?? 0,
          baselineTotalEfficiency: comparison.baseline.total_efficiency,
          baselineLmd: comparison.baseline.daily_production?.trading?.LMD ?? 0,
          baselineGoldNet: comparison.baseline.daily_production?.net?.['Pure Gold'] ?? 0,
          warnings: comparison.warnings,
        }
      })()
    : undefined

  const detailStats = {
    planCount: plans.length,
    roomCount: plans.reduce((sum, plan) => sum + plan.rows.length, 0),
  }

  return {
    totalEff,
    rawTotalEff,
    hasDailyProduction,
    rotationStatsNote,
    plans,
    productionStats,
    productionSanity,
    intermediateDepletion,
    maaDefaultComparison,
    detailStats,
  }
}

function buildOperatorLookup(operators: LicenseOperator[]): Map<string, LicenseOperator> {
  const lookup = new Map<string, LicenseOperator>()
  for (const operator of operators) {
    if (!operator?.name) continue
    lookup.set(operator.name, operator)
    lookup.set(operator.name.trim(), operator)
  }
  return lookup
}

function resolveRoomOperators(names: string[], lookup: Map<string, LicenseOperator>): RoomOperator[] {
  return names.map((name) => {
    const operator = lookup.get(name) ?? lookup.get(name.trim())
    const id = typeof operator?.id === 'string' && operator.id ? operator.id : undefined
    return { name, id }
  })
}

export function formatProduct(product?: string): string {
  if (!product) return '-'
  return PRODUCT_LABELS[product] ?? product
}

export function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`
}

export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('zh-CN')
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

export function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatAmount(value)}`
}

export function formatIntermediateDepletionSummary(items: PreparedIntermediateDepletion[]): string {
  if (items.length === 0) return ''
  const consuming = items.filter((item) => item.daysRemaining !== null)
  if (consuming.length === 0) return '当前排班不会耗尽赤金/源石碎片'
  return consuming
    .map((item) => `${item.label}${formatDaysRemaining(item.daysRemaining ?? 0)}`)
    .join('，')
}

function formatDaysRemaining(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '不足 1 天后耗完'
  if (days < 1) return '不足 1 天后耗完'
  return `约 ${formatAmount(days)} 天后耗完`
}

export function formatProductionBreakdown(manufacturing: Record<string, number>): string {
  const parts = ['Pure Gold', 'Battle Record', 'Originium Shard']
    .map((product) => {
      const amount = manufacturing[product] ?? 0
      return amount > 0 ? `${formatProduct(product)} ${formatAmount(amount)}` : ''
    })
    .filter(Boolean)
  return parts.length > 0 ? parts.join('，') : '暂无制造站产出'
}

export function formatOverflowSummary(overflow: NonNullable<OptimizeResult['analysis_summary']>['overflow'] | undefined): string {
  if (!overflow) return '暂无爆仓信息'
  const parts = [
    overflow.earliest_trading_full_time ? `贸易最短 ${overflow.earliest_trading_full_time}` : '',
    overflow.earliest_manufacturing_full_time ? `制造最短 ${overflow.earliest_manufacturing_full_time}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('，') : '暂无爆仓信息'
}

function getDisplayEfficiency(room: ShiftRoom): number {
  return Number(
    room.overflow?.equivalent?.equivalent_efficiency ??
    room.overflow?.final_efficiency ??
    room.final_efficiency ??
    room.efficiency ??
    0,
  )
}

function getEffectiveEfficiency(roomType: string, room: ShiftRoom): number {
  if (roomType === 'trading') {
    return Number(room.overflow?.speed_efficiency ?? room.overflow?.final_efficiency ?? room.final_efficiency ?? room.efficiency ?? 0)
  }
  return Number(room.overflow?.final_efficiency ?? room.final_efficiency ?? room.efficiency ?? 0)
}

function getEfficiencyDetail(roomType: string, room: ShiftRoom): string {
  const overflow = room.overflow
  if (!overflow) return ''
  if (roomType === 'trading' && typeof overflow.time === 'string') {
    return `满单 ${overflow.time}`
  }
  if (roomType === 'trading' && typeof overflow.expected_order_time === 'string') {
    return `单均 ${overflow.expected_order_time}`
  }
  if (roomType === 'manufacture' && typeof overflow.time === 'string') {
    return `满仓 ${overflow.time}`
  }
  return ''
}

function getMoodDetail(room: ShiftRoom, isRotationMode = false): string {
  if (isRotationMode) {
    const workHoursToZero = room.rotation?.work_hours_to_zero
    return workHoursToZero !== undefined && workHoursToZero !== null
      ? `预计 ${formatCompactNumber(workHoursToZero)}h 后整设施切换`
      : ''
  }

  const mood = room.mood ?? {}
  const entries = Object.values(mood)
  if (entries.length === 0) return ''
  const minEnd = Math.min(...entries.map((item) => Number(item.end ?? MAX_MOOD_FALLBACK)))
  const maxCost = Math.max(...entries.map((item) => Number(item.cost_per_hour ?? 0)))
  const redOps = Object.entries(mood)
    .filter(([, item]) => item.red_face)
    .map(([name]) => name)
  const parts = [`心情≥${formatCompactNumber(minEnd)}`, `最高消耗/时 ${formatCompactNumber(maxCost)}`]
  if (room.rotation?.work_hours_to_zero !== undefined && room.rotation.work_hours_to_zero !== null) {
    parts.push(`最快耗心 ${formatCompactNumber(room.rotation.work_hours_to_zero)}h 触发整设施切换`)
  }
  if (redOps.length > 0) parts.push(`红脸风险 ${redOps.join(', ')}`)
  return parts.join('，')
}

function summarizeDroneGains(details: NonNullable<DailyProduction['details']>): DroneGainSummary {
  const produced: Record<string, number> = {}
  const consumed: Record<string, number> = {}

  for (const detail of details) {
    if (detail.source !== 'drones') continue
    const product = typeof detail.product === 'string' ? detail.product : ''
    const amount = typeof detail.amount === 'number' ? detail.amount : 0
    if (product && amount > 0) {
      produced[product] = (produced[product] ?? 0) + amount
    }
    if (isRecord(detail.consume)) {
      for (const [productName, rawAmount] of Object.entries(detail.consume)) {
        if (typeof rawAmount === 'number' && rawAmount > 0) {
          consumed[productName] = (consumed[productName] ?? 0) + rawAmount
        }
      }
    }
  }

  const productOrder = ['LMD', 'Pure Gold', 'Battle Record', 'Orundum', 'Originium Shard']
  const producedParts = formatResourceParts(produced, productOrder)
  const consumedParts = formatResourceParts(consumed, productOrder)
  const primaryProduct = productOrder.find((product) => (produced[product] ?? 0) > 0) ??
    Object.keys(produced).find((product) => produced[product] > 0)

  if (!primaryProduct) {
    return {
      value: '0',
      suffix: '收益',
      note: '未产生无人机加速收益',
    }
  }

  return {
    value: `+${formatAmount(produced[primaryProduct])}`,
    suffix: formatProduct(primaryProduct),
    note: [
      producedParts.length > 0 ? `额外产出 ${producedParts.join('，')}` : '',
      consumedParts.length > 0 ? `消耗 ${consumedParts.join('，')}` : '',
    ].filter(Boolean).join('；'),
  }
}

function formatResourceParts(values: Record<string, number>, preferredOrder: string[]): string[] {
  const orderedProducts = [
    ...preferredOrder,
    ...Object.keys(values).filter((product) => !preferredOrder.includes(product)).sort(),
  ]
  return orderedProducts
    .filter((product) => (values[product] ?? 0) > 0)
    .map((product) => `${formatProduct(product)} ${formatAmount(values[product])}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
