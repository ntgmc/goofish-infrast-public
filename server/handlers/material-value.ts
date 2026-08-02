import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { APP_BUILD_META } from '../../src/lib/build-meta'

const YITULIU_ITEM_VALUE_URL = 'https://backend.yituliu.cn/item/v7/value'
const YITULIU_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const YITULIU_RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000
const YITULIU_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000
const YITULIU_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const YITULIU_CACHE_FILE_VERSION = 2
const VALUATION_MODEL_VERSION = 2
const MAX_PRICE_PAYLOAD_NODES = 100_000
const PURE_GOLD_ITEM_ID = '3003'
const TRADE_PURE_GOLD_PER_LMD = 2 / 1000

const FIXED_SANITY_PER_LMD_GROSS = 36 / 10000
const FIXED_SANITY_PER_EXP = 36 / 10000
export const EXP_ITEM_VALUES: Readonly<Record<string, number>> = {
  '2001': 200,
  '2002': 400,
  '2003': 1000,
  '2004': 2000,
}

const YITULIU_ITEM_VALUE_CONFIG = {
  source: 'penguin',
  version: 'v1.0',
  useActivityAverageStage: false,
  useActivityAverageStageAndUnlimitedItem: false,
  sampleSize: 300,
  stageBlacklist: [],
  stageWhitelist: [],
  lmdPricingStrategy: 'LMD_PRICING_CE-6',
  lmdCoefficient: 1,
  expPricingStrategy: 'EXP_PRICING_BASE_LVL_3_TRADING_POST',
  expCoefficient: 145 / 229,
}

export type PricingState = {
  status: 'fresh' | 'stale' | 'unavailable' | 'invalid'
  prices: Map<string, number>
  fetched_at: string | null
  age_ms: number | null
  snapshot_id: string | null
  valuation_version: string
}

type PricingSnapshot = {
  fetchedAt: number
  expiresAt: number
  state: PricingState
}

type RemotePricingResult =
  | { ok: true; snapshot: PricingSnapshot }
  | { ok: false; status: 'unavailable' | 'invalid' }

class InvalidPricingPayloadError extends Error {}

let yituliuCache: { expiresAt: number; state: PricingState } | null = null
let yituliuRefreshPromise: Promise<PricingState> | null = null

export async function getYituliuPricing(): Promise<PricingState> {
  const now = Date.now()
  if (yituliuCache && now < yituliuCache.expiresAt) return refreshPricingAge(yituliuCache.state, now)
  yituliuRefreshPromise ??= refreshYituliuPricing(now).finally(() => {
    yituliuRefreshPromise = null
  })
  return yituliuRefreshPromise
}

async function refreshYituliuPricing(now: number): Promise<PricingState> {
  const diskCache = await readYituliuDiskCache()
  if (diskCache && now < diskCache.expiresAt) {
    const state = createPricingState('fresh', diskCache.state.prices, diskCache.fetchedAt, diskCache.state.snapshot_id)
    yituliuCache = { expiresAt: diskCache.expiresAt, state }
    return refreshPricingAge(state, now)
  }

  const remoteCache = await fetchYituliuPricing()
  if (remoteCache.ok) {
    yituliuCache = { expiresAt: remoteCache.snapshot.expiresAt, state: remoteCache.snapshot.state }
    await writeYituliuDiskCache(remoteCache.snapshot)
    return remoteCache.snapshot.state
  }

  if (diskCache && now - diskCache.fetchedAt <= getMaximumStaleAgeMs()) {
    const state = createPricingState('stale', diskCache.state.prices, diskCache.fetchedAt, diskCache.state.snapshot_id)
    logYituliuDebug({
      event: 'using_stale_disk_cache',
      cache_fetched_at: new Date(diskCache.fetchedAt).toISOString(),
      cache_age_ms: now - diskCache.fetchedAt,
      price_count: state.prices.size,
    })
    yituliuCache = { expiresAt: now + YITULIU_RETRY_AFTER_FAILURE_MS, state }
    return refreshPricingAge(state, now)
  }

  if (diskCache) {
    logYituliuDebug({
      event: 'stale_disk_cache_rejected',
      cache_fetched_at: new Date(diskCache.fetchedAt).toISOString(),
      cache_age_ms: now - diskCache.fetchedAt,
      maximum_stale_age_ms: getMaximumStaleAgeMs(),
    })
  }
  const state = createPricingState(remoteCache.status, new Map(), null, null)
  yituliuCache = { expiresAt: now + YITULIU_RETRY_AFTER_FAILURE_MS, state }
  return state
}

async function fetchYituliuPricing(): Promise<RemotePricingResult> {
  const startedAt = Date.now()
  let loggedFailure = false
  try {
    const response = await fetch(YITULIU_ITEM_VALUE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify(YITULIU_ITEM_VALUE_CONFIG),
      signal: AbortSignal.timeout(25000),
    })
    const responseMeta = {
      url: YITULIU_ITEM_VALUE_URL,
      response_url: response.url,
      http_status: response.status,
      ok: response.ok,
      content_type: response.headers.get('content-type'),
      elapsed_ms: Date.now() - startedAt,
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      logYituliuDebug({
        event: 'http_error',
        ...responseMeta,
      })
      loggedFailure = true
      throw new Error(`yituliu ${response.status}`)
    }
    const data = await readBoundedJsonResponse(response)
    const prices = buildYituliuPriceMap(data)
    if (prices.size === 0) {
      logYituliuDebug({
        event: 'empty_price_map',
        ...responseMeta,
        ...summarizeYituliuPayload(data, prices.size),
      })
      return { ok: false, status: 'invalid' }
    }
    const fetchedAt = Date.now()
    const state = createPricingState('fresh', prices, fetchedAt, null)
    return { ok: true, snapshot: { fetchedAt, expiresAt: fetchedAt + YITULIU_CACHE_TTL_MS, state } }
  } catch (error) {
    if (!loggedFailure) {
      logYituliuDebug({
        event: 'request_failed',
        url: YITULIU_ITEM_VALUE_URL,
        elapsed_ms: Date.now() - startedAt,
        error_name: error instanceof Error ? error.name : typeof error,
        error_message: error instanceof Error ? error.message : String(error),
      })
    }
    return { ok: false, status: error instanceof InvalidPricingPayloadError ? 'invalid' : 'unavailable' }
  }
}

async function readYituliuDiskCache(): Promise<{ fetchedAt: number; expiresAt: number; state: PricingState } | null> {
  try {
    const raw = await readFile(getYituliuCachePath(), 'utf8')
    const payload = JSON.parse(raw) as unknown
    if (!isRecord(payload) || payload.version !== YITULIU_CACHE_FILE_VERSION) return null
    const fetchedAtText = stringValue(payload.fetched_at)
    const fetchedAt = Date.parse(fetchedAtText)
    if (!Number.isFinite(fetchedAt)) return null
    const prices = readSerializedPrices(payload.prices)
    if (prices.size === 0) return null
    const expectedSnapshotId = createPricingSnapshotId(prices)
    const snapshotId = stringValue(payload.snapshot_id)
    if (!snapshotId || snapshotId !== expectedSnapshotId) return null
    const state = createPricingState('fresh', prices, fetchedAt, snapshotId)
    return { fetchedAt, expiresAt: fetchedAt + YITULIU_CACHE_TTL_MS, state }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      logYituliuDebug({
        event: 'disk_cache_read_failed',
        cache_path: getYituliuCachePath(),
        error_name: error instanceof Error ? error.name : typeof error,
        error_message: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

async function writeYituliuDiskCache(cache: PricingSnapshot): Promise<void> {
  let temporaryPath = ''
  try {
    const cachePath = getYituliuCachePath()
    await mkdir(dirname(cachePath), { recursive: true })
    temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
    const payload = `${JSON.stringify({
      version: YITULIU_CACHE_FILE_VERSION,
      fetched_at: new Date(cache.fetchedAt).toISOString(),
      snapshot_id: cache.state.snapshot_id,
      prices: [...cache.state.prices.entries()].sort(([left], [right]) => left.localeCompare(right)),
    })}\n`
    const file = await open(temporaryPath, 'wx', 0o600)
    try {
      await file.writeFile(payload, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, cachePath)
    temporaryPath = ''
  } catch (error) {
    logYituliuDebug({
      event: 'disk_cache_write_failed',
      cache_path: getYituliuCachePath(),
      error_name: error instanceof Error ? error.name : typeof error,
      error_message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
  }
}

function readSerializedPrices(value: unknown): Map<string, number> {
  const prices = new Map<string, number>()
  if (!Array.isArray(value)) return prices
  for (const row of value) {
    if (!Array.isArray(row) || row.length < 2) continue
    const itemId = stringValue(row[0])
    const price = numberValue(row[1])
    if (itemId && price && price > 0) prices.set(itemId, price)
  }
  return prices
}

function getYituliuCachePath(): string {
  const configured = process.env.MAA_MATERIAL_VALUE_CACHE_PATH?.trim()
  return configured || join(process.cwd(), '.cache', 'material-value', 'yituliu-item-value-v1.json')
}

function getMaximumStaleAgeMs(): number {
  const configured = Number(process.env.MAA_MATERIAL_VALUE_MAX_STALE_MS)
  return Number.isFinite(configured) && configured >= 0 ? configured : YITULIU_MAX_STALE_MS
}

function createPricingState(
  status: PricingState['status'],
  prices: Map<string, number>,
  fetchedAt: number | null,
  snapshotId: string | null,
): PricingState {
  const resolvedSnapshotId = prices.size > 0 ? snapshotId || createPricingSnapshotId(prices) : null
  return {
    status,
    prices,
    fetched_at: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
    age_ms: fetchedAt === null ? null : Math.max(0, Date.now() - fetchedAt),
    snapshot_id: resolvedSnapshotId,
    valuation_version: [
      `depot-v${VALUATION_MODEL_VERSION}`,
      APP_BUILD_META.data_version,
      resolvedSnapshotId || status,
    ].join(':'),
  }
}

function refreshPricingAge(state: PricingState, now: number): PricingState {
  if (!state.fetched_at) return state
  const fetchedAt = Date.parse(state.fetched_at)
  if (!Number.isFinite(fetchedAt)) return state
  return { ...state, age_ms: Math.max(0, now - fetchedAt) }
}

function createPricingSnapshotId(prices: Map<string, number>): string {
  const normalized = [...prices.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, price]) => [itemId, round(price, 8)])
  return createHash('sha256').update(JSON.stringify({
    config: YITULIU_ITEM_VALUE_CONFIG,
    fixed_sanity_per_lmd_gross: FIXED_SANITY_PER_LMD_GROSS,
    fixed_sanity_per_exp: FIXED_SANITY_PER_EXP,
    trade_pure_gold_per_lmd: TRADE_PURE_GOLD_PER_LMD,
    prices: normalized,
  })).digest('hex')
}

async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new InvalidPricingPayloadError(`unexpected content type: ${contentType || 'missing'}`)
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > YITULIU_RESPONSE_MAX_BYTES) {
    throw new InvalidPricingPayloadError(`response exceeds ${YITULIU_RESPONSE_MAX_BYTES} bytes`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new InvalidPricingPayloadError('response body is missing')
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (totalBytes > YITULIU_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new InvalidPricingPayloadError(`response exceeds ${YITULIU_RESPONSE_MAX_BYTES} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    throw new InvalidPricingPayloadError(error instanceof Error ? error.message : 'invalid JSON')
  }
}

export function buildYituliuPriceMap(data: unknown): Map<string, number> {
  assertPricingPayloadBudget(data)
  const prices = new Map<string, number>()
  const itemValueRows = readYituliuItemValueRows(data)
  for (const item of itemValueRows) {
    if (!isRecord(item)) continue
    const itemId = stringValue(item.itemId ?? item.id)
    const price = numberValue(item.itemValueAp ?? item.itemValue)
    if (itemId && price && price > 0) setLowerPrice(prices, itemId, price)
  }

  const lists = collectArraysByKey(data, 'recommendedStageList')
  for (const list of lists) {
    for (const item of list) {
      if (!isRecord(item)) continue
      const nestedItem = isRecord(item.item) ? item.item : null
      const itemId = stringValue(item.itemId ?? item.materialId ?? item.id ?? nestedItem?.id)
      const stages = Array.isArray(item.stageResultList) ? item.stageResultList : []
      const price = minPositive(stages.map((stage) => isRecord(stage) ? numberValue(stage.apExpect) : null))
      if (itemId && price) setLowerPrice(prices, itemId, price)
    }
  }
  const stageLists = collectArraysByKey(data, 'stageResultList')
  for (const list of stageLists) {
    for (const stage of list) {
      if (!isRecord(stage)) continue
      const nestedItem = isRecord(stage.item) ? stage.item : null
      const itemId = stringValue(stage.itemId ?? stage.materialId ?? stage.id ?? nestedItem?.id)
      const price = numberValue(stage.apExpect)
      if (itemId && price && price > 0) setLowerPrice(prices, itemId, price)
    }
  }
  return prices
}

export function getExpItemSanity(itemId: string): number | null {
  const exp = EXP_ITEM_VALUES[itemId]
  return exp ? exp * FIXED_SANITY_PER_EXP : null
}

export function getExpSanity(experience: number): number {
  return experience * FIXED_SANITY_PER_EXP
}

export function getNetLmdSanity(pricing: PricingState): number {
  const pureGoldSanity = pricing.prices.get(PURE_GOLD_ITEM_ID) ?? getFixedPureGoldSanity()
  return Math.max(0, FIXED_SANITY_PER_LMD_GROSS - pureGoldSanity * TRADE_PURE_GOLD_PER_LMD)
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function getFixedPureGoldSanity(): number {
  return FIXED_SANITY_PER_EXP * YITULIU_ITEM_VALUE_CONFIG.expCoefficient * (50 / 3) * 24
}

function logYituliuDebug(payload: Record<string, unknown>): void {
  console.warn('[material-value yituliu debug]', JSON.stringify(payload))
}

function summarizeYituliuPayload(data: unknown, priceCount: number): Record<string, unknown> {
  const root = isRecord(data) ? data : null
  const nestedData = root && isRecord(root.data) ? root.data : null
  const itemValueRows = readYituliuItemValueRows(data)
  const recommendedStageLists = collectArraysByKey(data, 'recommendedStageList')
  const stageResultLists = collectArraysByKey(data, 'stageResultList')
  return {
    root_type: describeValueType(data),
    root_keys: root ? Object.keys(root).slice(0, 40) : [],
    response_code: numberValue(root?.code),
    response_msg: stringValue(root?.msg ?? root?.message) || undefined,
    data_type: describeValueType(nestedData),
    data_keys: nestedData ? Object.keys(nestedData).slice(0, 40) : [],
    item_value_row_count: itemValueRows.length,
    item_value_sample_keys: firstRecordKeys([itemValueRows]),
    recommended_stage_list_count: recommendedStageLists.length,
    recommended_stage_item_count: countNestedItems(recommendedStageLists),
    recommended_stage_sample_keys: firstRecordKeys(recommendedStageLists),
    stage_result_list_count: stageResultLists.length,
    stage_result_item_count: countNestedItems(stageResultLists),
    stage_result_sample_keys: firstRecordKeys(stageResultLists),
    price_count: priceCount,
  }
}

function readYituliuItemValueRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (!isRecord(data)) return []
  if (Array.isArray(data.data)) return data.data
  if (isRecord(data.data)) {
    for (const key of ['items', 'itemList', 'list', 'records']) {
      const value = data.data[key]
      if (Array.isArray(value)) return value
    }
  }
  for (const key of ['items', 'itemList', 'list', 'records']) {
    const value = data[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function countNestedItems(arrays: unknown[][]): number {
  return arrays.reduce((total, list) => total + list.length, 0)
}

function firstRecordKeys(arrays: unknown[][]): string[] {
  for (const list of arrays) {
    const item = list.find(isRecord)
    if (item) return Object.keys(item).slice(0, 40)
  }
  return []
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function collectArraysByKey(
  value: unknown,
  key: string,
  arrays: unknown[][] = [],
  depth = 0,
): unknown[][] {
  if (depth > 8 || !value || typeof value !== 'object') return arrays
  if (Array.isArray(value)) {
    for (const item of value) collectArraysByKey(item, key, arrays, depth + 1)
    return arrays
  }
  const record = value as Record<string, unknown>
  if (Array.isArray(record[key])) arrays.push(record[key] as unknown[])
  for (const child of Object.values(record)) collectArraysByKey(child, key, arrays, depth + 1)
  return arrays
}

function assertPricingPayloadBudget(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let visited = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    visited += 1
    if (visited > MAX_PRICE_PAYLOAD_NODES) {
      throw new InvalidPricingPayloadError(`price payload exceeds ${MAX_PRICE_PAYLOAD_NODES} nodes`)
    }
    if (current.depth > 8) throw new InvalidPricingPayloadError('price payload is nested too deeply')
    if (!current.value || typeof current.value !== 'object') continue
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 })
  }
}

function setLowerPrice(prices: Map<string, number>, itemId: string, price: number): void {
  const existing = prices.get(itemId)
  if (!existing || price < existing) prices.set(itemId, price)
}

function minPositive(values: (number | null)[]): number | null {
  const positives = values.filter((value): value is number => typeof value === 'number' && value > 0)
  return positives.length > 0 ? Math.min(...positives) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function errorCode(value: unknown): string {
  return isRecord(value) && typeof value.code === 'string' ? value.code : ''
}
