import { z } from 'zod'
import { CONFIG_PRESETS, normalizeScheduleMode } from './config'
import { getCurrentScenarioProductionPlan, SCENARIO_LAYOUT_COUNTS, type ScenarioComparisonFactors } from './scenario-comparison'
import type { LicenseConfig } from './types'

const question = z.string().trim().min(1).max(300)
const candidateKey = z.string().regex(/^[a-z0-9-]{1,48}$/)
const candidate = z.strictObject({ key: candidateKey, title: z.string().min(1).max(80), facts: z.array(z.string().min(1).max(140)).min(1).max(4) })
const profileId = z.string().trim().min(1).max(128)

export const workspaceAssistantRequestSchema = z.discriminatedUnion('task', [
  z.strictObject({ task: z.literal('comparison'), profile_id: profileId, question, context: z.strictObject({
    layout: z.string().regex(/^\d{1,2}-\d{1,2}-\d{1,2}$/).nullable(), schedule: z.enum(['maa', 'variable', 'rotation']),
  }) }),
  z.strictObject({ task: z.enum(['cultivation', 'changes']), profile_id: profileId, question, candidates: z.array(candidate).min(1).max(12) })
    .refine(({ candidates }) => new Set(candidates.map(({ key }) => key)).size === candidates.length),
])

export type WorkspaceAssistantRequest = z.infer<typeof workspaceAssistantRequestSchema>

const metric = z.enum(['lmd', 'experience', 'orundum', 'sanity', 'operations'])
export const comparisonGoalSchema = z.strictObject({
  metrics: z.array(metric).min(1).max(5), priority: metric.nullable(),
}).refine(({ metrics, priority }) => new Set(metrics).size === metrics.length && (priority === null || metrics.includes(priority)))
export type ComparisonGoal = z.infer<typeof comparisonGoalSchema>
const count = z.number().int().min(0).max(5)
const comparisonPlan = z.strictObject({
  layout: z.enum(['153', '243', '252', '252-1', '252-full', '333']),
  allocation: z.strictObject({ lmd: count, orundum: count, pureGold: count, battleRecord: count, originiumShard: count }).nullable(),
})
const comparisonReply = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), answer: z.string().trim().min(1).max(1200), plans: z.array(z.union([z.literal('current'), comparisonPlan])).min(1).max(3),
    schedules: z.array(z.enum(['variable', '8x3', 'rotation'])).max(3),
    drones: z.array(z.enum(['off', 'auto', 'inventory_balance', 'lmd', 'orundum', 'pure_gold', 'battle_record', 'originium_shard'])).max(8), goal: comparisonGoalSchema }),
  z.strictObject({ status: z.enum(['unsupported', 'clarify']), reason: z.string().trim().min(1).max(120) }),
])

const selectionReply = z.strictObject({ keys: z.array(candidateKey).max(3) })
export const workspaceAssistantReplySchema = z.union([comparisonReply, selectionReply])
export type WorkspaceAssistantReply = z.infer<typeof workspaceAssistantReplySchema>
export type AssistantCandidate = z.infer<typeof candidate>

type ComparisonDraft = Extract<z.infer<typeof comparisonReply>, { status: 'ready' }>

export function parseWorkspaceAssistantReply(text: string, request: WorkspaceAssistantRequest): WorkspaceAssistantReply | null {
  const json = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return null }
  if (request.task === 'comparison') {
    const result = comparisonReply.safeParse(raw)
    return result.success ? result.data : null
  }
  const result = selectionReply.safeParse(raw)
  if (!result.success) return null
  const keys = result.data.keys
  return new Set(keys).size === keys.length && keys.every((key) => request.candidates.some((row) => row.key === key)) ? result.data : null
}

export function comparisonAssistantContext(config: LicenseConfig) {
  return { layout: /^\d{1,2}-\d{1,2}-\d{1,2}$/.test(config.layout) ? config.layout : null, schedule: normalizeScheduleMode(config.schedule_mode) }
}

export function comparisonAssistantFactors(draft: ComparisonDraft, config: LicenseConfig): ScenarioComparisonFactors {
  const layouts: ScenarioComparisonFactors['layouts'] = []
  for (const entry of draft.plans) {
    if (entry === 'current') {
      if (!layouts.some((row) => row.layout === 'current')) layouts.push({ layout: 'current', plans: [] })
      continue
    }
    const { layout, allocation } = entry
    const preset = CONFIG_PRESETS[layout]
    const plan = allocation ? {
      trading: { lmd: allocation.lmd, orundum: allocation.orundum },
      manufacturing: { pureGold: allocation.pureGold, battleRecord: allocation.battleRecord, originiumShard: allocation.originiumShard },
    } : preset ? getCurrentScenarioProductionPlan(preset) : {
      trading: { lmd: SCENARIO_LAYOUT_COUNTS[layout].trading, orundum: 0 },
      manufacturing: { pureGold: 1, battleRecord: SCENARIO_LAYOUT_COUNTS[layout].manufacturing - 1, originiumShard: 0 },
    }
    const existing = layouts.find((row) => row.layout === layout)
    if (!existing) layouts.push({ layout, plans: [plan] })
    else if (!existing.plans.some((row) => JSON.stringify(row) === JSON.stringify(plan))) existing.plans.push(plan)
  }
  const currentSchedule = normalizeScheduleMode(config.schedule_mode)
  const schedules = draft.schedules.length ? draft.schedules : [currentSchedule === 'maa' || (draft.drones.length > 0 && currentSchedule === 'rotation') ? '8x3' : currentSchedule] as const
  return {
    layouts,
    maaSchedules: [...new Set(schedules)].filter((schedule) => schedule !== 'rotation'),
    includeRotation: schedules.includes('rotation'),
    droneStrategies: draft.drones.length ? [...new Set(draft.drones)] : ['auto'],
  }
}
