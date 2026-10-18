import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync, gunzipSync } from 'node:zlib'
import { defaultCultivationQuery, type CultivationQuery } from '../../src/lib/cultivation-contract'
import { syncPrtsPlanning } from '../../scripts/prts-planning-sync.mjs'
import { cultivationDayStart } from './cache-policy'
import { prtsSnapshotPath, prtsSnapshotSchema, readPrtsSnapshot, releasePrtsSnapshot, type PrtsSnapshot } from './catalog'
import { compactRecommendations, packPreparedEvidence, unpackPreparedEvidence, type PublicRecommendations } from './public-evidence'
import { calculateCultivationRecommendations, prepareRecommendations } from './recommendations'

type SnapshotRow = { revision: string; source_path: string; updated_at: string; catalog: Uint8Array; prepared: Uint8Array }
type QueryRow = { day: number; result: Uint8Array }
const MAX_HOT_BYTES = 4 * 1024 * 1024
let catalogCache: { revision: string; path: string; data: PrtsSnapshot } | null = null
const hot = new Map<string, Uint8Array>()
let hotBytes = 0

export function publicEvidencePath(): string { return `${prtsSnapshotPath()}.evidence-v1.sqlite` }

function evidenceQuery(query: CultivationQuery): CultivationQuery {
  return { ...defaultCultivationQuery, scope: query.scope, days: query.days, coverage: query.coverage, stageId: query.stageId,
    activity: query.activity, category: query.category, includeClosed: query.includeClosed,
    includeAlternatives: query.includeAlternatives, includeUncertain: query.includeUncertain, rarityGroup: 'all' }
}
function queryKey(query: CultivationQuery) { return JSON.stringify(evidenceQuery(query)) }
function encode(value: unknown) { return gzipSync(JSON.stringify(value)) }
function decode<T>(value: Uint8Array): T { return JSON.parse(gunzipSync(value, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8')) as T }
function openRead(): DatabaseSync { return new DatabaseSync(publicEvidencePath(), { readOnly: true }) }

export function hasStoredRecommendation(query: CultivationQuery, allowStale = false): boolean {
  let database: DatabaseSync | undefined
  try {
    database = openRead()
    const row = database.prepare('SELECT day FROM queries WHERE query_key = ?').get(queryKey(query)) as { day: number } | undefined
    return Boolean(row && (allowStale || row.day === cultivationDayStart()))
  } catch { return false }
  finally { database?.close() }
}

export function readPublicCatalog(): PrtsSnapshot | null {
  let database: DatabaseSync | undefined
  try {
    database = openRead()
    return readCatalog(database).data
  } catch { return null }
  finally { database?.close() }
}

function readCatalog(database: DatabaseSync) {
  const info = database.prepare('SELECT revision FROM snapshot WHERE id = 1').get() as { revision: string } | undefined
  if (!info) throw new Error('Public evidence is not prepared')
  const path = publicEvidencePath()
  if (catalogCache?.path !== path || catalogCache.revision !== info.revision) {
    const row = database.prepare('SELECT catalog FROM snapshot WHERE id = 1').get() as { catalog: Uint8Array }
    catalogCache = { path, revision: info.revision, data: prtsSnapshotSchema.parse(decode(row.catalog)) }
    hot.clear(); hotBytes = 0
  }
  return catalogCache
}

export function readStoredRecommendations(query: CultivationQuery) {
  const database = openRead()
  try {
    // One read transaction prevents a publication between the catalog and query reads.
    database.exec('BEGIN')
    const catalog = readCatalog(database)
    const key = queryKey(query)
    const row = database.prepare('SELECT day FROM queries WHERE query_key = ?').get(key) as Omit<QueryRow, 'result'> | undefined
    if (!row) throw new Error('Public recommendation query is not prepared')
    const hotKey = `${catalog.path}:${catalog.revision}:${row.day}:${key}`
    let value = hot.get(hotKey)
    if (!value) {
      const payload = database.prepare('SELECT result FROM queries WHERE query_key = ?').get(key) as Pick<QueryRow, 'result'>
      value = payload.result
      if (value.byteLength <= MAX_HOT_BYTES) { hot.set(hotKey, value); hotBytes += value.byteLength }
    } else { hot.delete(hotKey); hot.set(hotKey, value) }
    while (hot.size > 2 || hotBytes > MAX_HOT_BYTES) {
      const oldest = hot.keys().next().value!
      hotBytes -= hot.get(oldest)!.byteLength
      hot.delete(oldest)
    }
    const recommendation = decode<PublicRecommendations>(value)
    if (!Array.isArray(recommendation.samples) || !Array.isArray(recommendation.groups) || !Array.isArray(recommendation.recommendations)) throw new Error('Invalid public recommendation cache')
    return { snapshot: catalog.data, recommendation }
  } catch (error) {
    hot.clear(); hotBytes = 0; catalogCache = null
    throw error
  } finally { database.close() }
}

// This function runs only in a temporary builder. No original homework or prepared graph enters the reader.
export async function buildPublicEvidence(query: CultivationQuery, signal: AbortSignal, refresh = false): Promise<void> {
  const path = publicEvidencePath()
  await mkdir(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  try {
    database.exec(`PRAGMA journal_mode = WAL; PRAGMA cache_size = -2048; PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL,
        source_path TEXT NOT NULL, updated_at TEXT NOT NULL, catalog BLOB NOT NULL, prepared BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS queries (query_key TEXT PRIMARY KEY, day INTEGER NOT NULL, result BLOB NOT NULL,
        touched INTEGER NOT NULL);`)
    database.exec('BEGIN IMMEDIATE')
    let saved = database.prepare('SELECT * FROM snapshot WHERE id = 1').get() as SnapshotRow | undefined
    const sourcePath = prtsSnapshotPath()
    if (saved?.source_path !== sourcePath) saved = undefined
    let catalog!: PrtsSnapshot, prepared!: ReturnType<typeof prepareRecommendations>
    const identify = (info: { mtimeMs: number; size: number }) => createHash('sha256').update(`${sourcePath}:${info.mtimeMs}:${info.size}`).digest('hex')
    let info = saved && !refresh ? null : await stat(sourcePath)
    let revision = info ? identify(info) : saved!.revision
    if (refresh) {
      const updatedAt = saved?.revision === revision ? saved.updated_at : (await readPrtsSnapshot()).updatedAt
      releasePrtsSnapshot()
      if (Date.parse(updatedAt) < cultivationDayStart()) {
        await syncPrtsPlanning({ signal })
        info = await stat(sourcePath)
        revision = identify(info)
      }
    }
    signal.throwIfAborted()
    const day = cultivationDayStart()
    const current = database.prepare('SELECT day FROM queries WHERE query_key = ?').get(queryKey(query)) as { day: number } | undefined
    if (refresh && saved?.revision === revision && current?.day === day) {
      database.exec('COMMIT')
      return
    }
    if (saved?.revision === revision) {
      try {
        catalog = prtsSnapshotSchema.parse(decode(saved.catalog))
        prepared = unpackPreparedEvidence(decode(saved.prepared), catalog)
      } catch { saved = undefined }
    }
    if (saved?.revision !== revision) {
      if (!info) { info = await stat(sourcePath); revision = identify(info) }
      const original = await readPrtsSnapshot()
      prepared = prepareRecommendations(original)
      catalog = { ...original, homeworks: [], warnings: [...original.warnings,
        ...(original.homeworks.some((row) => !row.uploadedAt) ? ['部分作业缺少发布时间，暂不参与推荐；请重新导入作业数据或等待同步补齐。'] : [])] }
      const after = await stat(sourcePath)
      if (!info || after.mtimeMs !== info.mtimeMs || after.size !== info.size) throw new Error('Public snapshot changed while building evidence')
      signal.throwIfAborted()
      database.prepare(`INSERT INTO snapshot VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, source_path=excluded.source_path,
          updated_at=excluded.updated_at, catalog=excluded.catalog, prepared=excluded.prepared`)
        .run(revision, sourcePath, catalog.updatedAt, encode(catalog), encode(packPreparedEvidence(prepared)))
      database.exec('DELETE FROM queries')
      releasePrtsSnapshot()
    }
    const result = encode(compactRecommendations(calculateCultivationRecommendations(catalog, evidenceQuery(query), day, prepared)))
    signal.throwIfAborted()
    database.prepare(`INSERT INTO queries VALUES (?, ?, ?, ?)
      ON CONFLICT(query_key) DO UPDATE SET day=excluded.day, result=excluded.result, touched=excluded.touched`)
      .run(queryKey(query), day, result, Date.now())
    // Disk queries are also bounded; rebuilding an evicted combination uses the persisted compact evidence.
    database.exec(`DELETE FROM queries WHERE query_key IN (
      SELECT query_key FROM (SELECT query_key, row_number() OVER (ORDER BY touched DESC, rowid DESC) AS position,
        sum(length(result)) OVER (ORDER BY touched DESC, rowid DESC) AS total FROM queries)
      WHERE position > 64 OR (position > 1 AND total > 67108864))`)
    database.exec('COMMIT')
  } finally { database.close(); releasePrtsSnapshot() }
}
