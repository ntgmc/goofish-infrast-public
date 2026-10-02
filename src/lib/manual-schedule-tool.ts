import { z } from 'zod'
import { isValidShiftHours, normalizeConfig, parseShiftHours, validateConfig } from './config'
import { facilityLayoutSchema } from './facility-layout'
import { createManualPlans, manualResult, roomCapacity, validateManualPlans } from './manual-schedule'
import { hasCapability } from './product-catalog'
import { copy } from '../copy/index'
import type { LicenseConfig, LicenseOperator, OptimizeResult, UserGameAccount } from './types'

const roomTypes = z.enum(['trading', 'manufacture', 'power', 'control', 'meeting', 'hire', 'processing', 'training', 'dormitory'])
const hours = z.number().finite().positive().max(24)

export const manualScheduleSourceSchema: z.ZodType<OptimizeResult> = z.object({
  author: z.string().max(1_000).default(''),
  title: z.string().max(1_000),
  description: z.string().max(20_000).default(''),
  buildingType: z.number().int().min(0).max(999).default(243),
  planTimes: z.string().max(2_000).default(''),
  schedule_mode: z.enum(['maa', 'rotation', 'variable']).optional(),
  dormitory_rule: z.enum(['fixed', 'maa_pure_autofill']).optional(),
  facility_layout: facilityLayoutSchema.optional(),
  shift_hours: z.array(hours).min(1).max(24).optional(),
  shift_pattern: z.string().max(200).optional(),
  total_schedule_hours: z.number().finite().positive().max(576).optional(),
  rotation_mode: z.object({
    queue_count: z.number().int().min(1).max(24),
    quick_switch: z.literal(true),
    training_policy: z.literal('assume_not_training'),
    shift_hours_per_queue: hours.optional(),
    daily_production_normalized_hours: z.number().finite().positive().optional(),
    total_cycle_hours: z.number().finite().positive().optional(),
    suppress_total_efficiency: z.literal(false).optional(),
  }).optional(),
  plans: z.array(z.object({
    name: z.string().min(1).max(1_000),
    shift_hours: hours.optional(),
    rooms: z.partialRecord(roomTypes, z.array(z.object({
      level: z.number().int().min(1).max(5).optional(),
      product: z.enum(['LMD', 'Orundum', 'Pure Gold', 'Battle Record', 'Originium Shard']).optional(),
      operators: z.array(z.string().max(256)).max(5).default([]),
      autofill: z.boolean().optional(),
    })).max(20)),
    Fiammetta: z.object({
      enable: z.boolean(), target: z.string().max(256), order: z.enum(['pre', 'post']),
    }).optional(),
    drones: z.object({
      enable: z.boolean(), room: z.string().max(128), index: z.number().int().min(1).max(20),
      order: z.enum(['pre', 'post']),
    }).optional(),
  })).min(1).max(24),
  raw_results: z.array(z.never()).default([]),
})

export function isManualScheduleProfileAvailable(profile: UserGameAccount, now = Date.now()): boolean {
  if (profile.kind === 'depot_value' || profile.archived_at || profile.status !== 'active') return false
  if (profile.expires_at && !(Date.parse(profile.expires_at) > now)) return false
  if (profile.kind === 'free_preview' && (!profile.trial?.active ||
    !(Date.parse(profile.trial.starts_at) <= now && Date.parse(profile.trial.ends_at) > now))) return false
  return hasCapability({ permission: profile.trial?.effective_permission ?? profile.permission }, 'edit_full_config')
}

export function createBlankManualSchedule(input: LicenseConfig): OptimizeResult {
  const requestedHours = parseShiftHours(input.shift_hours)
  if (!requestedHours || !isValidShiftHours(requestedHours)) throw new Error(copy.domain.lib_config_035)
  const config = normalizeConfig({ ...input, schedule_mode: 'maa', dormitory_rule: 'fixed', Fiammetta: { enable: false } })
  const validation = validateConfig(config)
  if (!validation.ok) throw new Error(validation.message)
  const shiftHours = parseShiftHours(config.shift_hours)!
  const productionRooms = (type: 'trading' | 'manufacture') => {
    const products = Object.entries(type === 'trading'
      ? config.product_requirements.trading_stations : config.product_requirements.manufacturing_stations)
      .flatMap(([product, count]) => Array<string>(count).fill(product))
    const levels = type === 'trading' ? config.trading_station_levels : config.manufacturing_station_levels
    return products.map((product, index) => ({ product, level: levels?.[index] ?? 3, operators: [] }))
  }
  return {
    author: '', title: copy.tools.manualSchedule.title, description: '', buildingType: Number(config.layout.replace(/-/g, '')),
    planTimes: shiftHours.map((hour) => `${hour}h`).join('-'), schedule_mode: 'maa', dormitory_rule: 'fixed',
    facility_layout: config.facility_layout, shift_hours: shiftHours,
    total_schedule_hours: shiftHours.reduce((total, hour) => total + hour, 0), raw_results: [],
    plans: shiftHours.map((shift_hours, index) => ({
      name: `Shift${index + 1}`, shift_hours,
      rooms: {
        trading: productionRooms('trading'), manufacture: productionRooms('manufacture'),
        power: Array.from({ length: 9 - config.trading_stations_count - config.manufacturing_stations_count }, () => ({ level: 3, operators: [] })),
        control: [{ level: 5, operators: [] }], meeting: [{ level: 3, operators: [] }],
        hire: [{ level: 3, operators: [] }], processing: [{ level: 3, operators: [] }],
        dormitory: Array.from({ length: 4 }, () => ({ level: 5, operators: [] })),
      },
      drones: { enable: false, room: 'trading', index: 1, order: 'pre' },
    })),
  }
}

export function parseManualScheduleJson(text: string, config: LicenseConfig, operators: LicenseOperator[]): OptimizeResult {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schedule')
  const data = value as Record<string, unknown>
  const source = manualScheduleSourceSchema.parse({ ...data, raw_results: [] })
  const shiftHours = source.shift_hours ?? parseShiftHours(config.shift_hours)
  if (!shiftHours) throw new Error('Invalid shifts')
  source.plans.forEach((plan, index) => { plan.shift_hours ??= shiftHours[index % shiftHours.length] })
  source.shift_hours = source.plans.map((plan) => plan.shift_hours!)
  source.planTimes = source.shift_hours.map((hour) => `${hour}h`).join('-')
  source.total_schedule_hours = source.shift_hours.reduce((total, hour) => total + hour, 0)
  source.schedule_mode ??= 'maa'
  source.dormitory_rule ??= source.plans.some((plan) => plan.rooms.dormitory?.some((room) => room.autofill)) ? 'maa_pure_autofill' : 'fixed'
  const resolved = resolveManualScheduleConfig(source, config, operators)
  source.buildingType = Number(resolved.layout.replace(/-/g, ''))
  const plans = createManualPlans(source)
  validateManualPlans(source, plans, operators)
  return manualResult(source, plans)
}

export function resolveManualScheduleConfig(source: OptimizeResult, input: LicenseConfig, operators: LicenseOperator[]): LicenseConfig {
  const rooms = source.plans[0].rooms
  const owned = new Set(operators.filter((operator) => operator.own).map((operator) => operator.name))
  const maximumRooms: Record<string, number> = { trading: 5, manufacture: 5, power: 3, dormitory: 4, control: 1, meeting: 1, hire: 1, processing: 1, training: 1 }
  for (const plan of source.plans) {
    if (Object.keys(plan.rooms).length === 0) throw new Error('Empty facilities')
    if (plan.Fiammetta?.enable && !owned.has(plan.Fiammetta.target)) throw new Error('Invalid Fiammetta target')
    for (const [type, entries] of Object.entries(plan.rooms)) {
      if (entries.length > maximumRooms[type] || entries.length !== (rooms[type]?.length ?? 0)) throw new Error('Invalid facilities')
      entries.forEach((room, index) => {
        if ((room.operators?.length ?? 0) > roomCapacity(type, room) ||
          room.operators?.some((name) => name !== '' && !owned.has(name)) ||
          ((type === 'trading' || type === 'manufacture' || type === 'power') && (room.level ?? 3) > 3) ||
          room.product !== rooms[type][index].product || room.level !== rooms[type][index].level) throw new Error('Invalid room')
      })
    }
    if (Object.keys(plan.rooms).length !== Object.keys(rooms).length) throw new Error('Invalid facilities')
  }
  const trading = rooms.trading?.length ?? 0
  const manufacture = rooms.manufacture?.length ?? 0
  const power = rooms.power?.length ?? 0
  if (trading < 1 || manufacture < 1 || power < 1 || trading + manufacture + power !== 9) throw new Error('Invalid layout')
  const products = (type: 'trading' | 'manufacture') => {
    const counts: Record<string, number> = {}
    for (const room of rooms[type]) {
      const product = room.product ?? (type === 'trading' ? 'LMD' : 'Battle Record')
      if (!(type === 'trading' ? ['LMD', 'Orundum'] : ['Pure Gold', 'Battle Record', 'Originium Shard']).includes(product)) throw new Error('Invalid product')
      counts[product] = (counts[product] ?? 0) + 1
    }
    return counts
  }
  const shiftHours = source.plans.map((plan, index) => plan.shift_hours ?? source.shift_hours?.[index])
  if (shiftHours.some((hour) => typeof hour !== 'number' || !Number.isFinite(hour) || hour <= 0 || hour > 24)) throw new Error('Invalid shifts')
  return {
    ...input, layout: `${trading}-${manufacture}-${power}`,
    schedule_mode: source.schedule_mode ?? 'maa', dormitory_rule: source.dormitory_rule ?? 'fixed',
    shift_hours: shiftHours as number[], facility_layout: source.facility_layout,
    trading_stations_count: trading, manufacturing_stations_count: manufacture,
    trading_station_levels: rooms.trading.map((room) => room.level ?? 3),
    manufacturing_station_levels: rooms.manufacture.map((room) => room.level ?? 3),
    product_requirements: { trading_stations: products('trading'), manufacturing_stations: products('manufacture') },
    Fiammetta: { enable: source.plans.some((plan) => plan.Fiammetta?.enable) },
    drones: { enable: source.plans.some((plan) => plan.drones?.enable), auto: false, order: 'pre', targets: [] },
  }
}
