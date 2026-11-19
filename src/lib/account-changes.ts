import { copy } from '../copy'
import { allocateProjectMaterials, type CultivationProject } from './cultivation-projects'
import type { CultivationData } from './cultivation-contract'
import { scheduleProductionMetrics } from './schedule-comparison'
import { sklandResourceState, type SklandSnapshot } from './skland-snapshot'
import type { OptimizeResult } from './types'
import type { AssistantCandidate } from './workspace-assistant'

const text = copy.v2.workspaceAssistant
const format = (value: number, signed = false) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1, signDisplay: signed ? 'exceptZero' : 'auto' })

export function snapshotChanges(before: SklandSnapshot, after: SklandSnapshot): AssistantCandidate[] | null {
  if (before.uid !== after.uid) return null
  const changes: AssistantCandidate[] = []
  const oldGame = before.game.data
  const newGame = after.game.data
  const gameChanged = updatedResource(before.game, after.game) && oldGame && newGame
  const inventoryChanged = updatedResource(before.inventory, after.inventory) && before.inventory.items && after.inventory.items
  if (!gameChanged && !inventoryChanged) return null
  function compare(key: string, title: string, previous: number | null, current: number | null) {
    if (previous !== null && current !== null && previous !== current) changes.push({ key, title, facts: [text.inventoryDelta(title, format(previous), format(current))] })
  }
  if (gameChanged) compare('operators', copy.skland.operators, oldGame.player.operators, newGame.player.operators)
  if (inventoryChanged) {
    compare('lmd', copy.skland.lmd, before.inventory.lmd, after.inventory.lmd)
    compare('experience', copy.skland.exp, before.inventory.exp, after.inventory.exp)
    const left = before.inventory.items!
    const right = after.inventory.items!
    const names = { ...before.inventory.itemNames, ...after.inventory.itemNames }
    const knownChanged = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => names[key] && (left[key] ?? 0) !== (right[key] ?? 0))
    if (knownChanged.length) changes.push({ key: 'materials', title: text.inventoryTitle, facts: [text.inventoryKinds(knownChanged.length)] })
  }
  return changes
}

function updatedResource(before: SklandSnapshot['game'], after: SklandSnapshot['game']) {
  return Boolean(before.fetchedAt && after.fetchedAt && Date.parse(after.fetchedAt) > Date.parse(before.fetchedAt)
    && sklandResourceState(before.fetchedAt) !== 'expired' && sklandResourceState(after.fetchedAt) !== 'expired')
}

export function cultivationChanges(before: CultivationData, after: CultivationData, projects: CultivationProject[]): AssistantCandidate[] {
  const left = new Map(allocateProjectMaterials(before, projects).map((row) => [row.project.operatorId, row]))
  return allocateProjectMaterials(after, projects).flatMap((row, index) => {
    const previous = left.get(row.project.operatorId)
    if (!row.candidate || !previous?.candidate || row.candidate.warnings.length || previous.candidate.warnings.length) return []
    const facts: string[] = []
    if (!previous.candidate.satisfied && row.candidate.satisfied) facts.push(text.newTargets)
    else if (!row.candidate.satisfied && previous.allocation && row.allocation && Object.keys(previous.allocation.missing).length && !Object.keys(row.allocation.missing).length) facts.push(text.readyTargets)
    return facts.length ? [{ key: `goal-${index + 1}`, title: row.candidate.name, facts }] : []
  })
}

export function scheduleChanges(before: OptimizeResult, after: OptimizeResult): AssistantCandidate[] {
  const left = scheduleProductionMetrics(before)
  const right = scheduleProductionMetrics(after)
  const changes: AssistantCandidate[] = []
  if (left && right) {
    for (const [key, title] of [['lmd', copy.v2.comparison.lmd], ['experience', copy.v2.comparison.experience], ['orundum', copy.v2.comparison.orundum]] as const) {
      const a = left[key], b = right[key]
      if (format(a) !== format(b)) changes.push({ key, title, facts: [text.scheduleDelta(title, format(a), format(b), format(b - a, true))] })
    }
  }
  if (before.schedule_mode === after.schedule_mode && before.plans.length && after.plans.length && before.plans.length !== after.plans.length
    && before.total_schedule_hours === after.total_schedule_hours) {
    const title = text.shiftSegments
    changes.push({ key: 'operations', title, facts: [text.scheduleDelta(title, format(before.plans.length), format(after.plans.length), format(after.plans.length - before.plans.length, true))] })
  }
  if (before.buildingType && after.buildingType && before.buildingType !== after.buildingType) changes.push({ key: 'layout', title: copy.v2.comparison.layout,
    facts: [text.inventoryDelta(copy.v2.comparison.layout, String(before.buildingType), String(after.buildingType))] })
  return changes
}
