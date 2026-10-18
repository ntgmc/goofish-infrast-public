import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { CULTIVATION_DAY_MS, cultivationDayStart } from './cache-policy.ts'

const record = z.record(z.string(), z.unknown())
export const prtsSnapshotSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  cursor: z.number().int().nonnegative(),
  reconcilePage: z.number().int().positive(),
  homeworks: z.array(z.object({
    id: z.number().int().positive(),
    hash: z.string().min(1),
    stageId: z.string(),
    mode: z.number().int().min(1).max(3),
    content: record,
    uploadedAt: z.string().datetime().optional(),
    likes: z.number().int().nonnegative().optional(),
    dislikes: z.number().int().nonnegative().optional(),
    views: z.number().int().nonnegative().optional(),
    hotScore: z.number().nonnegative().optional(),
  })),
  operators: z.record(z.string(), z.object({ name: z.string(), rarity: z.number().int().min(1).max(6), skills: z.array(z.string()), profession: z.string().optional() })),
  stages: z.record(z.string(), z.object({ name: z.string(), activity: z.string(), category: z.string(), permanent: z.boolean(), open: z.boolean().nullable().optional() })).optional(),
  costs: z.object({
    cultivate: z.record(z.string(), record),
    levels: z.object({ maxLevel: z.array(z.array(z.number())), characterExp: z.array(z.array(z.number())), characterUpgradeCost: z.array(z.array(z.number())), eliteCost: z.array(z.array(z.number())) }),
    modules: z.object({ equipDict: z.record(z.string(), record), charEquip: z.record(z.string(), z.array(z.string())) }),
  }),
  recipes: z.record(z.string(), z.object({ count: z.number().positive(), items: z.record(z.string(), z.number().nonnegative()) })),
  farms: z.record(z.string(), z.array(z.object({ stage: z.string(), sanity: z.number().positive(), quantity: z.number().positive(), days: z.array(z.number().int().min(1).max(7)).min(1) }))),
  itemNames: z.record(z.string(), z.string()),
  itemIcons: z.record(z.string(), z.string()).optional(),
  potionValues: z.record(z.string(), z.number().positive()),
  warnings: z.array(z.string()),
})
export type PrtsSnapshot = z.infer<typeof prtsSnapshotSchema>

export function prtsSnapshotPath() {
  return resolve(process.env.MAA_PRTS_PLANNING_PATH?.trim() || '.cache/cultivation/prts-planning.json')
}

let cached: { path: string; modified: number; size: number; data: PrtsSnapshot; nextCheck: number } | null = null
let pending: { path: string; data: Promise<PrtsSnapshot> } | null = null
export async function readPrtsSnapshot(): Promise<PrtsSnapshot> {
  const path = prtsSnapshotPath(), now = Date.now()
  const previous = cached?.path === path ? cached : null
  if (previous && now < previous.nextCheck) return previous.data
  if (pending?.path === path) return pending.data
  let data!: Promise<PrtsSnapshot>
  data = (async () => {
    try {
      const info = await stat(path)
      const snapshot = previous?.modified === info.mtimeMs && previous.size === info.size
        ? previous.data : prtsSnapshotSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (pending?.data === data) cached = { path, modified: info.mtimeMs, size: info.size, data: snapshot, nextCheck: cultivationDayStart() + CULTIVATION_DAY_MS }
      return snapshot
    } catch (error) {
      if (!previous) throw error
      if (pending?.data === data) cached = { ...previous, nextCheck: Date.now() + 300000 }
      return previous.data
    }
  })().finally(() => { if (pending?.data === data) pending = null })
  pending = { path, data }
  return data
}

export function releasePrtsSnapshot(): void {
  cached = null
  pending = null
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}
