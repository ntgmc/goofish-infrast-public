import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { fetchJson, loadPlanningAssets } from '../../scripts/prts-planning-lib.mjs'
import { prtsSnapshotPath, prtsSnapshotSchema, type PrtsSnapshot } from './catalog'
import { saveCultivationReference } from './references'

const DAY = 86400000
const gameShaSchema = z.string().regex(/^[0-9a-f]{40}$/)
const commitSchema = z.object({ object: z.object({ sha: gameShaSchema }) })
const projectCatalogSchema = prtsSnapshotSchema.extend({ gameSha: gameShaSchema, catalogVersion: z.literal(2) }).refine((snapshot) =>
  Object.keys(snapshot.operators).length > 0 && Object.entries(snapshot.operators).every(([id, operator]) =>
    snapshot.costs.cultivate[id.replace(/^char_/, '')] && (!operator.baseId || snapshot.operators[operator.baseId])),
  '养成资料缺少干员或消耗表',
)
let cached: { path: string; data: PrtsSnapshot; nextAttempt: number } | null = null

export async function readProjectCatalog(signal: AbortSignal, requiredIds: string[] = []): Promise<PrtsSnapshot> {
  signal.throwIfAborted()
  const coversOwned = (data: PrtsSnapshot) => requiredIds.every((id) => data.operators[id])
  const path = join(dirname(prtsSnapshotPath()), 'project-game-data.json')
  if (cached?.path === path && Date.now() < cached.nextAttempt && coversOwned(cached.data)) return cached.data
  if (cached?.path !== path) {
    cached = null
    try {
      const data = projectCatalogSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      cached = { path, data, nextAttempt: Date.parse(data.updatedAt) + DAY }
    } catch { /* A missing or invalid public cache is populated on demand. */ }
    if (cached && Date.now() < cached.nextAttempt && coversOwned(cached.data)) return cached.data
  }
  try {
    const { object: { sha } } = commitSchema.parse(await fetchJson('https://api.github.com/repos/Kengxxiao/ArknightsGameData/git/ref/heads/master', { signal }))
    const assets = await loadPlanningAssets(sha, signal, true)
    const data = projectCatalogSchema.parse({ ...assets, gameSha: sha, catalogVersion: 2, version: 1, updatedAt: new Date().toISOString(), cursor: 0, reconcilePage: 1, homeworks: [], warnings: [] })
    if (!coversOwned(data)) throw new Error('养成资料缺少已持有干员')
    signal.throwIfAborted()
    cached = { path, data, nextAttempt: Date.now() + DAY }
    await saveCultivationReference(path, data).catch(() => undefined)
    return data
  } catch (error) {
    signal.throwIfAborted()
    if (!cached || !coversOwned(cached.data)) throw error
    const data = { ...cached.data, warnings: ['养成资料更新暂不可用，当前使用上次资料。'] }
    cached = { path, data, nextAttempt: Date.now() + 300000 }
    return data
  }
}
