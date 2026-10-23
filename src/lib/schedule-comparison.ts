import { canonicalJson } from './crypto'
import { calculateProductionSanity } from './production-sanity'
import { copy } from '../copy'
import type { OptimizeResult } from './types'

export type ScheduleAssignment = { start: number; end: number; roomType: string; roomIndex: number }
export type ScheduleOperatorDifference = {
  name: string
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  before: ScheduleAssignment[]
  after: ScheduleAssignment[]
}

function assignments(result: OptimizeResult): Map<string, ScheduleAssignment[]> {
  const assigned = new Map<string, ScheduleAssignment[]>()
  let start = 0
  result.plans.forEach((plan, shift) => {
    const end = start + (plan.shift_hours ?? result.shift_hours?.[shift] ?? 0)
    const add = (name: string, roomType: string, roomIndex: number) => {
      if (!name) return
      const entries = assigned.get(name) ?? []
      entries.push({ start, end, roomType, roomIndex })
      assigned.set(name, entries)
    }
    for (const [type, rooms] of Object.entries(plan.rooms)) {
      rooms.forEach((room, index) => room.operators?.forEach((name) => add(name, type, index)))
    }
    if (plan.Fiammetta?.enable) {
      add(copy.tools.manualSchedule.fiammettaName, 'fiammetta', 0)
      add(plan.Fiammetta.target, 'fiammetta-target', 0)
    }
    start = end
  })
  for (const entries of assigned.values()) entries.sort((a, b) =>
    a.start - b.start || a.end - b.end || a.roomType.localeCompare(b.roomType) || a.roomIndex - b.roomIndex)
  return assigned
}

export function compareScheduleOperators(before: OptimizeResult, after: OptimizeResult): ScheduleOperatorDifference[] {
  const left = assignments(before)
  const right = assignments(after)
  return [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((name) => {
    const before = left.get(name) ?? []
    const after = right.get(name) ?? []
    return { name, before, after, status: !before.length ? 'added' : !after.length ? 'removed'
      : canonicalJson(before) === canonicalJson(after) ? 'unchanged' : 'changed' }
  })
}

export function scheduleProductionMetrics(result: OptimizeResult | null) {
  const daily = result?.daily_production
  if (!daily) return null
  const manufacturing = daily.manufacturing ?? {}
  const trading = daily.trading ?? {}
  const consumption = daily.consumption ?? {}
  return {
    lmd: trading.LMD ?? 0,
    experience: (manufacturing['Battle Record'] ?? 0) * 1000,
    orundum: trading.Orundum ?? 0,
    gold: manufacturing['Pure Gold'] ?? 0,
    goldConsumed: consumption['Pure Gold'] ?? 0,
    goldNet: daily.net?.['Pure Gold'] ?? (manufacturing['Pure Gold'] ?? 0) - (consumption['Pure Gold'] ?? 0),
    shard: manufacturing['Originium Shard'] ?? 0,
    shardConsumed: consumption['Originium Shard'] ?? 0,
    shardNet: daily.net?.['Originium Shard'] ?? (manufacturing['Originium Shard'] ?? 0) - (consumption['Originium Shard'] ?? 0),
    sanity: calculateProductionSanity(daily).value,
  }
}
