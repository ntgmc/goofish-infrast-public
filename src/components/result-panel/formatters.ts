import type { DailyProduction, LicenseOperator, OptimizeResult, OrundumEconomy, OrundumRoi, ShiftRoom } from '../../lib/types'
import { calculateProductionSanity } from '../../lib/production-sanity'
import { PRODUCT_LABELS, ROOM_LABELS } from './labels'
import type { PreparedPlan, RoomOperator } from './types'
import { copy, CURRENT_LOCALE } from '../../copy/index'


const MAX_MOOD_FALLBACK = 24
const ROOM_DISPLAY_ORDER = ['trading', 'manufacture', 'power', 'control', 'meeting', 'hire', 'dormitory'] as const
const UNKNOWN_ROOM_DISPLAY_RANK = ROOM_DISPLAY_ORDER.length
const ROOM_DISPLAY_RANK: Record<string, number> = ROOM_DISPLAY_ORDER.reduce(
  (rank, roomType, index) => ({ ...rank, [roomType]: index }),
  {},
)

type DroneGainSummary = {
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
  orundumEconomy?: OrundumEconomy;
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
    orundumEconomyDelta?: OrundumRoi;
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
  isPureMaaDormitoryAutofill: boolean,
  operators: LicenseOperator[] = [],
): PreparedResult {
  const operatorLookup = buildOperatorLookup(operators)
  const rawTotalEff = result.raw_total_efficiency ??
    result.raw_results.reduce((sum, item) => sum + (item?.total_efficiency ?? 0), 0)
  const totalEff = result.total_efficiency ?? rawTotalEff
  const hasDailyProduction = Boolean(result.daily_production)
  const rotationStatsNote = isRotationMode
    ? `${copy.domain.components_result_panel_formatters_001}${result.rotation_mode?.shift_hours_per_queue ?? 12}${copy.domain.components_result_panel_formatters_002}${result.rotation_mode?.daily_production_normalized_hours ?? 24}h`
    : undefined
  const plans: PreparedPlan[] = result.plans.map((plan, planIndex) => ({
    ...plan,
    rows: getSortedRoomEntries(plan.rooms ?? {}).flatMap(([roomType, rooms]) => {
      if (!Array.isArray(rooms)) return []
      if (isRotationMode && roomType === 'dormitory') return []
      return rooms.flatMap((room, index) => {
        const queueLabel = isRotationMode ? plan.name || `${copy.domain.components_result_panel_formatters_003}${planIndex + 1}` : plan.name || `${copy.domain.components_result_panel_formatters_004}${planIndex + 1}`
        if (roomType === 'dormitory' && isPureMaaDormitoryAutofill) {
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
            operatorText: copy.domain.components_result_panel_formatters_005,
            efficiency: '-',
            speedEfficiency: '-',
            detail: copy.domain.components_result_panel_formatters_006,
            detailItems: [copy.domain.components_result_panel_formatters_007],
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
          `${isRotationMode ? copy.domain.components_result_panel_formatters_008 : copy.domain.components_result_panel_formatters_009} ${formatPercent(efficiency)}`,
          `${copy.domain.components_result_panel_formatters_010}${formatPercent(speedEfficiency)}`,
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
  const orundumEconomy = result.orundum_economy
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
          sanityDeltaNote: `${copy.domain.components_result_panel_formatters_011}${formatSigned(sanityDelta.value)}${copy.domain.components_result_panel_formatters_012}${sanityDelta.note}）`,
          baselineSanity: baselineSanity.value,
          totalEfficiencyDelta: comparison.delta.total_efficiency,
          rawTotalEfficiencyDelta: comparison.delta.raw_total_efficiency,
          lmdDelta: comparison.delta.trading.LMD ?? 0,
          goldNetDelta: comparison.delta.net['Pure Gold'] ?? 0,
      baselineTotalEfficiency: comparison.baseline.total_efficiency,
      baselineLmd: comparison.baseline.daily_production?.trading?.LMD ?? 0,
      baselineGoldNet: comparison.baseline.daily_production?.net?.['Pure Gold'] ?? 0,
      warnings: comparison.warnings,
      orundumEconomyDelta: comparison.orundum_economy?.delta,
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
    orundumEconomy,
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
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString(CURRENT_LOCALE)
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
  if (consuming.length === 0) return copy.domain.components_result_panel_formatters_013
  return consuming
    .map((item) => `${item.label}${formatDaysRemaining(item.daysRemaining ?? 0)}`)
    .join('，')
}

function formatDaysRemaining(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return copy.domain.components_result_panel_formatters_014
  if (days < 1) return copy.domain.components_result_panel_formatters_015
  return `${copy.domain.components_result_panel_formatters_016}${formatAmount(days)}${copy.domain.components_result_panel_formatters_017}`
}

export function formatProductionBreakdown(manufacturing: Record<string, number>): string {
  const parts = ['Pure Gold', 'Battle Record', 'Originium Shard']
    .map((product) => {
      const amount = manufacturing[product] ?? 0
      return amount > 0 ? `${formatProduct(product)} ${formatAmount(amount)}` : ''
    })
    .filter(Boolean)
  return parts.length > 0 ? parts.join('，') : copy.domain.components_result_panel_formatters_018
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
    return `${copy.domain.components_result_panel_formatters_023}${overflow.time}`
  }
  if (roomType === 'trading' && typeof overflow.expected_order_time === 'string') {
    return `${copy.domain.components_result_panel_formatters_024}${overflow.expected_order_time}`
  }
  if (roomType === 'manufacture' && typeof overflow.time === 'string') {
    return `${copy.domain.components_result_panel_formatters_025}${overflow.time}`
  }
  return ''
}

function getMoodDetail(room: ShiftRoom, isRotationMode = false): string {
  if (isRotationMode) {
    const workHoursToZero = room.rotation?.work_hours_to_zero
    return workHoursToZero !== undefined && workHoursToZero !== null
      ? `${copy.domain.components_result_panel_formatters_026}${formatCompactNumber(workHoursToZero)}${copy.domain.components_result_panel_formatters_027}`
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
  const parts = [`${copy.domain.components_result_panel_formatters_028}${formatCompactNumber(minEnd)}`, `${copy.domain.components_result_panel_formatters_029}${formatCompactNumber(maxCost)}`]
  if (room.rotation?.work_hours_to_zero !== undefined && room.rotation.work_hours_to_zero !== null) {
    parts.push(`${copy.domain.components_result_panel_formatters_030}${formatCompactNumber(room.rotation.work_hours_to_zero)}${copy.domain.components_result_panel_formatters_031}`)
  }
  if (redOps.length > 0) parts.push(`${copy.domain.components_result_panel_formatters_032}${redOps.join(', ')}`)
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
      suffix: copy.domain.components_result_panel_formatters_033,
      note: copy.domain.components_result_panel_formatters_034,
    }
  }

  return {
    value: `+${formatAmount(produced[primaryProduct])}`,
    suffix: formatProduct(primaryProduct),
    note: [
      producedParts.length > 0 ? `${copy.domain.components_result_panel_formatters_035}${producedParts.join('，')}` : '',
      consumedParts.length > 0 ? `${copy.domain.components_result_panel_formatters_036}${consumedParts.join('，')}` : '',
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
