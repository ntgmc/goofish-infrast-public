import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CultivationData, CultivationStatistics } from '../../src/lib/cultivation-contract'
import { prtsSnapshotPath } from './catalog'

const DAY = 86400000
const distribution = z.record(z.string(), z.number().int().nonnegative())
const statisticsSchema = z.object({ success: z.literal(true), data: z.array(z.object({
  charId: z.string().regex(/^char_/), own: z.number().int().positive(), sampleSize: z.number().int().positive(),
  elite: distribution, skill1: distribution, skill2: distribution, skill3: distribution,
  modA: distribution, modB: distribution, modD: distribution, modX: distribution, modY: distribution,
})).min(1).max(2000) })
const savedSchema = z.object({ updatedAt: z.string().datetime(), payload: statisticsSchema })
type Community = NonNullable<CultivationData['community']>
let cache: Community | null = null
let nextAttempt = 0
let pending: Promise<Community> | null = null

export function parseCultivationStatistics(value: unknown): Record<string, CultivationStatistics> {
  const { data } = statisticsSchema.parse(value)
  return Object.fromEntries(data.map((row) => {
    const rate = (counts: Record<string, number>, ranks: number) => Array.from({ length: ranks }, (_, rank) => {
      const count = counts[String(rank)] ?? 0
      if (count > row.own || Object.values(counts).reduce((sum, value) => sum + value, 0) > row.own) throw new Error('一图流统计人数超过持有人数')
      return count / row.own
    })
    return [row.charId, { owned: row.own, sampleSize: row.sampleSize, elite: rate(row.elite, 3),
      skills: [row.skill1, row.skill2, row.skill3].map((skill) => rate(skill, 4)),
      modules: Object.fromEntries(['A', 'B', 'D', 'X', 'Y'].map((type) => [type, rate(row[`mod${type}` as 'modA'], 4)])),
    }]
  }))
}

export async function getCultivationStatistics(): Promise<Community> {
  if (cache && Date.now() < nextAttempt) return cache
  pending ??= refreshStatistics().finally(() => { pending = null })
  return pending
}

async function refreshStatistics(): Promise<Community> {
  const path = join(dirname(prtsSnapshotPath()), 'operator-statistics.json')
  if (!cache) {
    try {
      const saved = savedSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      cache = { updatedAt: saved.updatedAt, status: 'stale', operators: parseCultivationStatistics(saved.payload) }
    } catch { /* Missing or invalid caches are replaced by a validated response. */ }
  }
  if (cache?.updatedAt && Date.now() - Date.parse(cache.updatedAt) < DAY) {
    cache.status = 'fresh'
    nextAttempt = Date.parse(cache.updatedAt) + DAY
    return cache
  }
  try {
    const payload = statisticsSchema.parse(await fetchCultivationJson('https://auth.yituliu.cn/open/ak-operator-statistics/result'))
    const updatedAt = new Date().toISOString()
    cache = { status: 'fresh', updatedAt, operators: parseCultivationStatistics(payload) }
    nextAttempt = Date.now() + DAY
    await saveCultivationReference(path, { updatedAt, payload }).catch(() => undefined)
  } catch {
    cache = cache?.updatedAt ? { ...cache, status: 'stale' } : { status: 'unavailable', updatedAt: null, operators: {} }
    nextAttempt = Date.now() + 300000
  }
  return cache
}

export async function saveCultivationReference(path: string, payload: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(payload), { mode: 0o600, flag: 'wx' }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}

export async function fetchCultivationJson(url: string, maximumBytes = 5_000_000): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) { await response.body?.cancel(); throw new Error('养成参考数据暂不可用') }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('养成参考数据为空')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumBytes) { await reader.cancel(); throw new Error('养成参考数据响应过大') }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
