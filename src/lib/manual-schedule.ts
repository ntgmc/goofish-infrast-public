import { z } from 'zod'
import { canonicalJson } from './crypto'
import type { LicenseOperator, OptimizeResult, ShiftRoom } from './types'

export const manualPlansSchema = z.array(z.strictObject({
  rooms: z.record(z.string().min(1).max(128), z.array(z.array(z.string().max(256)).max(5)).max(20)),
  drones: z.strictObject({
    enable: z.boolean(),
    room: z.string().max(128),
    index: z.number().int().min(1).max(20),
    order: z.enum(['pre', 'post']),
  }),
})).min(1).max(24)

export type ManualPlan = {
  rooms: Record<string, string[][]>;
  drones: { enable: boolean; room: string; index: number; order: string };
}
export type ManualDraft = {
  version: 1;
  source: string;
  title: string;
  savedAt: string;
  plans: ManualPlan[];
}

function isFixedDormitory(source: OptimizeResult, type: string): boolean {
  return type === 'dormitory' && (source.schedule_mode === 'rotation' || source.dormitory_rule === 'maa_pure_autofill')
}

function roomCapacity(type: string, room: ShiftRoom): number {
  if (type === 'trading' || type === 'manufacture') return Math.max(1, Math.min(3, room.level ?? 3))
  if (type === 'control') return Math.max(1, Math.min(5, room.level ?? 5))
  return ({ meeting: 2, hire: 1, power: 1, processing: 1, dormitory: 5 } as Record<string, number>)[type] ?? room.operators?.length ?? 0
}

export function createManualPlans(source: OptimizeResult): ManualPlan[] {
  return source.plans.map((plan) => ({
    rooms: Object.fromEntries(Object.entries(plan.rooms).map(([type, rooms]) => [
      type, rooms.map((room) => Array.from({ length: Math.max(roomCapacity(type, room), room.operators?.length ?? 0) }, (_, index) => room.operators?.[index] ?? '')),
    ])),
    drones: {
      enable: plan.drones?.enable === true, room: plan.drones?.room ?? 'trading',
      index: plan.drones?.index ?? 1, order: plan.drones?.order ?? 'pre',
    },
  }))
}

export function lockedManualOperators(source: OptimizeResult): Set<string> {
  return new Set(source.plans.flatMap((plan) => plan.Fiammetta?.enable && plan.Fiammetta.target?.trim() ? [plan.Fiammetta.target.trim()] : []))
}

export function changeManualOperator(source: OptimizeResult, plans: ManualPlan[], operators: LicenseOperator[],
  planIndex: number, roomType: string, roomIndex: number, slot: number, name: string): ManualPlan[] {
  const current = plans[planIndex]?.rooms[roomType]?.[roomIndex]
  const locked = lockedManualOperators(source)
  if (!current || slot < 0 || slot >= current.length || locked.has(current[slot]) || locked.has(name)
    || (name && !operators.some((operator) => operator.name === name && operator.own))
    || isFixedDormitory(source, roomType)) throw new Error('Invalid operator edit')
  const next = structuredClone(plans)
  const destination = next[planIndex].rooms[roomType][roomIndex]
  const previous = destination[slot]
  if (name) {
    for (const [type, rooms] of Object.entries(next[planIndex].rooms)) {
      if (isFixedDormitory(source, type)) continue
      for (const room of rooms) {
        const index = room.indexOf(name)
        if (index >= 0) room[index] = previous
      }
    }
  }
  destination[slot] = name
  validateManualPlans(source, next, operators)
  return next
}

export function changeManualDrone(source: OptimizeResult, plans: ManualPlan[], operators: LicenseOperator[],
  planIndex: number, roomType?: string, roomIndex?: number): ManualPlan[] {
  const next = structuredClone(plans)
  if (!next[planIndex]) throw new Error('Invalid shift')
  next[planIndex].drones = roomType === undefined ? { ...next[planIndex].drones, enable: false } : {
    enable: true, room: roomType, index: (roomIndex ?? 0) + 1, order: next[planIndex].drones.order,
  }
  validateManualPlans(source, next, operators)
  return next
}

export function validateManualPlans(source: OptimizeResult, value: unknown, operators: LicenseOperator[]): asserts value is ManualPlan[] {
  if (!Array.isArray(value) || value.length !== source.plans.length) throw new Error('Invalid shifts')
  const base = createManualPlans(source)
  const locked = lockedManualOperators(source)
  const allowed = new Set([
    ...operators.filter((operator) => operator.own).map((operator) => operator.name),
    ...base.flatMap((plan) => Object.values(plan.rooms).flat(2).filter(Boolean)),
  ])
  value.forEach((plan: ManualPlan, planIndex) => {
    if (!plan || typeof plan !== 'object' || !plan.rooms || !plan.drones
      || canonicalJson(Object.keys(plan.rooms).sort()) !== canonicalJson(Object.keys(base[planIndex].rooms).sort())) throw new Error('Invalid rooms')
    const assigned = new Set<string>()
    for (const [type, rooms] of Object.entries(plan.rooms)) {
      const original = base[planIndex].rooms[type]
      if (!Array.isArray(rooms) || rooms.length !== original.length) throw new Error('Invalid facilities')
      rooms.forEach((room, roomIndex) => {
        if (!Array.isArray(room) || room.length !== original[roomIndex].length) throw new Error('Invalid room capacity')
        if (isFixedDormitory(source, type)) {
          if (canonicalJson(room) !== canonicalJson(original[roomIndex])) throw new Error('Autofill is locked')
          return
        }
        room.forEach((name, slot) => {
          if (typeof name !== 'string' || (name && (!allowed.has(name) || assigned.has(name)))) throw new Error('Invalid or duplicate operator')
          if (name) assigned.add(name)
          const before = original[roomIndex][slot]
          if ((locked.has(before) || locked.has(name)) && name !== before) throw new Error('Fiammetta target is locked')
        })
      })
    }
    const drone = plan.drones
    if (typeof drone.enable !== 'boolean' || typeof drone.room !== 'string' || !Number.isInteger(drone.index)
      || !['pre', 'post'].includes(drone.order)) throw new Error('Invalid drones')
    if (drone.enable && (!['trading', 'manufacture'].includes(drone.room) || !plan.rooms[drone.room]?.[drone.index - 1])) throw new Error('Invalid drone target')
  })
}

export function manualResult(source: OptimizeResult, plans: ManualPlan[]): OptimizeResult {
  return {
    author: source.author, title: source.title, description: source.description, buildingType: source.buildingType,
    planTimes: source.planTimes, schedule_mode: source.schedule_mode, dormitory_rule: source.dormitory_rule,
    schedule_mode_name: source.schedule_mode_name, dormitory_rule_name: source.dormitory_rule_name,
    rotation_mode: source.rotation_mode, facility_layout: source.facility_layout,
    shift_hours: source.shift_hours, shift_pattern: source.shift_pattern,
    total_schedule_hours: source.total_schedule_hours, fiammetta_target_slots: source.fiammetta_target_slots,
    raw_results: [],
    plans: source.plans.map((plan, index) => ({
      name: plan.name, shift_hours: plan.shift_hours, Fiammetta: plan.Fiammetta,
      drones: {
        enable: plans[index].drones.enable, room: plans[index].drones.room, index: plans[index].drones.index,
        order: plans[index].drones.order, mode: 'manual',
      },
      rooms: Object.fromEntries(Object.entries(plan.rooms).map(([type, rooms]) => [
        type, rooms.map((room, roomIndex) => ({
          level: room.level, product: room.product, operators: plans[index].rooms[type][roomIndex].filter(Boolean), autofill: room.autofill,
        })),
      ])),
    })),
  }
}

export function manualSourceKey(source: OptimizeResult): string {
  return canonicalJson({
    title: source.title, buildingType: source.buildingType, planTimes: source.planTimes,
    schedule_mode: source.schedule_mode, dormitory_rule: source.dormitory_rule, plans: source.plans,
  })
}

export function readManualDraft(profileId: string, source: OptimizeResult, operators: LicenseOperator[]): ManualDraft | null {
  const raw = localStorage.getItem(`manual-schedule:${profileId}`)
  if (!raw) return null
  return parseManualDraft(raw, source, operators)
}

export function parseManualDraft(raw: string, source: OptimizeResult, operators: LicenseOperator[]): ManualDraft {
  const draft = JSON.parse(raw) as ManualDraft
  if (!draft || draft.version !== 1 || draft.source !== manualSourceKey(source) || typeof draft.savedAt !== 'string') throw new Error('Draft does not match source')
  validateManualPlans(source, draft.plans, operators)
  return draft
}

export function saveManualDraft(profileId: string, source: OptimizeResult, plans: ManualPlan[], operators: LicenseOperator[]): ManualDraft {
  validateManualPlans(source, plans, operators)
  const draft: ManualDraft = { version: 1, source: manualSourceKey(source), title: source.title, savedAt: new Date().toISOString(), plans }
  localStorage.setItem(`manual-schedule:${profileId}`, JSON.stringify(draft))
  return draft
}
