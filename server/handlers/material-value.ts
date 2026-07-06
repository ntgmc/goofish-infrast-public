import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const YITULIU_ITEM_VALUE_URL = 'https://backend.yituliu.cn/item/v7/value'
const YITULIU_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const YITULIU_RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000
const YITULIU_CACHE_FILE_VERSION = 1
const PURE_GOLD_ITEM_ID = '3003'
const TRADE_PURE_GOLD_PER_LMD = 2 / 1000

export const FIXED_SANITY_PER_LMD_GROSS = 36 / 10000
export const FIXED_SANITY_PER_EXP = 36 / 10000
export const EXP_ITEM_VALUES: Record<string, number> = {
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
  status: 'ok' | 'unavailable'
  prices: Map<string, number>
}

let yituliuCache: { expiresAt: number; state: PricingState } | null = null

export async function getYituliuPricing(): Promise<PricingState> {
  const now = Date.now()
  if (yituliuCache && now < yituliuCache.expiresAt) return yituliuCache.state

  const diskCache = await readYituliuDiskCache()
  if (diskCache && now < diskCache.expiresAt) {
    yituliuCache = { expiresAt: diskCache.expiresAt, state: diskCache.state }
    return diskCache.state
  }

  const remoteCache = await fetchYituliuPricing()
  if (remoteCache) {
    yituliuCache = { expiresAt: remoteCache.expiresAt, state: remoteCache.state }
    await writeYituliuDiskCache(remoteCache)
    return remoteCache.state
  }

  if (diskCache) {
    logYituliuDebug({
      event: 'using_stale_disk_cache',
      cache_fetched_at: new Date(diskCache.fetchedAt).toISOString(),
      price_count: diskCache.state.prices.size,
    })
    yituliuCache = { expiresAt: Date.now() + YITULIU_RETRY_AFTER_FAILURE_MS, state: diskCache.state }
    return diskCache.state
  }

  const state = { status: 'unavailable' as const, prices: new Map<string, number>() }
  yituliuCache = { expiresAt: Date.now() + YITULIU_RETRY_AFTER_FAILURE_MS, state }
  return state
}

export function resetYituliuPricingMemoryCacheForTest(): void {
  yituliuCache = null
}

async function fetchYituliuPricing(): Promise<{ fetchedAt: number; expiresAt: number; state: PricingState } | null> {
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
      const bodyText = await response.text().catch(() => '')
      logYituliuDebug({
        event: 'http_error',
        ...responseMeta,
        body_excerpt: bodyTextExcerpt(bodyText),
      })
      loggedFailure = true
      throw new Error(`yituliu ${response.status}`)
    }
    const data = await response.json()
    const prices = buildYituliuPriceMap(data)
    if (prices.size === 0) {
      logYituliuDebug({
        event: 'empty_price_map',
        ...responseMeta,
        ...summarizeYituliuPayload(data, prices.size),
      })
      return null
    }
    const fetchedAt = Date.now()
    const state = { status: 'ok' as const, prices }
    return { fetchedAt, expiresAt: fetchedAt + YITULIU_CACHE_TTL_MS, state }
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
    return null
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
    const state = { status: 'ok' as const, prices }
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

async function writeYituliuDiskCache(cache: { fetchedAt: number; state: PricingState }): Promise<void> {
  try {
    const cachePath = getYituliuCachePath()
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, `${JSON.stringify({
      version: YITULIU_CACHE_FILE_VERSION,
      fetched_at: new Date(cache.fetchedAt).toISOString(),
      prices: [...cache.state.prices.entries()].sort(([left], [right]) => left.localeCompare(right)),
    })}\n`, 'utf8')
  } catch (error) {
    logYituliuDebug({
      event: 'disk_cache_write_failed',
      cache_path: getYituliuCachePath(),
      error_name: error instanceof Error ? error.name : typeof error,
      error_message: error instanceof Error ? error.message : String(error),
    })
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

export function buildYituliuPriceMap(data: unknown): Map<string, number> {
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

function bodyTextExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 1000)
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

function collectArraysByKey(value: unknown, key: string, arrays: unknown[][] = [], depth = 0): unknown[][] {
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
