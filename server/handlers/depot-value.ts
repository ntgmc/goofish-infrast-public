import type {
  DepotValueItem,
  DepotValueRequest,
  DepotValueResponse,
  DepotValueSource,
  DepotValueUnpricedItem,
} from '../../src/lib/types'
import { APP_BUILD_META } from '../../src/lib/build-meta'
import { requireUserSession } from './user-auth'
import { decryptSklandCredential, SklandClient } from './skland-client'
import {
  getExpItemSanity,
  getNetLmdSanity,
  getYituliuPricing,
  round,
  type PricingState,
} from './material-value'

const MAX_BODY_BYTES = 1024 * 1024
const TOP_ITEM_LIMIT = 8
const UNPRICED_ITEM_LIMIT = 12
const LMD_ITEM_ID = '4001'
const UNPRICED_BY_POLICY = new Set(['3401', 'mod_unlock_token', 'mod_update_token_1', 'mod_update_token_2'])

type DepotInventoryItem = {
  id: string
  name: string
  count: number
}

type HandlerError = Error & {
  status?: number
}

const ITEM_NAMES: Record<string, string> = {
  '2001': '基础作战记录',
  '2002': '初级作战记录',
  '2003': '中级作战记录',
  '2004': '高级作战记录',
  '3003': '赤金',
  '3401': '家具零件',
  '4001': '龙门币',
  '30011': '源岩',
  '30012': '固源岩',
  '30013': '固源岩组',
  '30014': '提纯源岩',
  '30021': '代糖',
  '30022': '糖',
  '30023': '糖组',
  '30024': '糖聚块',
  '30031': '酯原料',
  '30032': '聚酸酯',
  '30033': '聚酸酯组',
  '30034': '聚酸酯块',
  '30041': '异铁碎片',
  '30042': '异铁',
  '30043': '异铁组',
  '30044': '异铁块',
  '30051': '双酮',
  '30052': '酮凝集',
  '30053': '酮凝集组',
  '30054': '酮阵列',
  '30061': '破损装置',
  '30062': '装置',
  '30063': '全新装置',
  '30064': '改量装置',
  '30073': '扭转醇',
  '30074': '白马醇',
  '30083': '轻锰矿',
  '30084': '三水锰矿',
  '30093': '研磨石',
  '30094': '五水研磨石',
  '30103': 'RMA70-12',
  '30104': 'RMA70-24',
  '30115': '聚合剂',
  '30125': '双极纳米片',
  '30135': 'D32钢',
  '30145': '晶体电子单元',
  '30155': '烧结核凝晶',
  '30165': '重相位对映体',
  '31013': '凝胶',
  '31014': '聚合凝胶',
  '31023': '炽合金',
  '31024': '炽合金块',
  '31033': '晶体元件',
  '31034': '晶体电路',
  '31043': '半自然溶剂',
  '31044': '精炼溶剂',
  '31053': '化合切削液',
  '31054': '切削原液',
  '31063': '转质盐组',
  '31064': '转质盐聚块',
  '31073': '褐素纤维',
  '31074': '固化纤维板',
  '31083': '环烃聚质',
  '31084': '环烃预制体',
  '31093': '类凝结核',
  '31094': '手性屈光体',
  '31103': '液化高能气体',
  '31104': '液化醚吸聚体',
  '31113': '电极单元',
  '32001': '芯片助剂',
  '3211': '先锋芯片',
  '3212': '先锋芯片组',
  '3221': '近卫芯片',
  '3222': '近卫芯片组',
  '3231': '重装芯片',
  '3232': '重装芯片组',
  '3241': '狙击芯片',
  '3242': '狙击芯片组',
  '3251': '术师芯片',
  '3252': '术师芯片组',
  '3261': '医疗芯片',
  '3262': '医疗芯片组',
  '3271': '辅助芯片',
  '3272': '辅助芯片组',
  '3281': '特种芯片',
  '3282': '特种芯片组',
  '3301': '技巧概要·卷1',
  '3302': '技巧概要·卷2',
  '3303': '技巧概要·卷3',
  mod_unlock_token: '模组数据块',
  mod_update_token_1: '数据增补条',
  mod_update_token_2: '数据增补仪',
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await readLimitedJsonBody(req) as Partial<DepotValueRequest>
    if (body.source === 'upload') {
      return jsonResponse(await buildDepotValueResponse(normalizeDepotInventory(body.inventory), 'upload'))
    }
    if (body.source === 'skland') {
      const inventory = await readSklandInventory(req, body.profile_id)
      return jsonResponse(await buildDepotValueResponse(inventory, 'skland'))
    }
    return jsonResponse({ error: '请指定 source 为 upload 或 skland。' }, 400)
  } catch (error) {
    console.error('depot value error:', error instanceof Error ? error.message : error)
    const status = isHandlerError(error) ? error.status ?? 500 : 500
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, status)
  }
}

export function normalizeDepotInventory(value: unknown): DepotInventoryItem[] {
  if (!isRecord(value)) throw createError('仓库 JSON 必须是对象。', 400)
  if (Array.isArray(value.items)) return mergeDepotItems(parsePenguinDepotItems(value.items))
  return mergeDepotItems(parseFlatDepotItems(value))
}

export async function buildDepotValueResponse(
  items: DepotInventoryItem[],
  source: DepotValueSource,
  pricingState?: PricingState,
): Promise<DepotValueResponse> {
  const pricing = pricingState ?? await getYituliuPricing()
  const pricedItems: DepotValueItem[] = []
  const unpricedItems: DepotValueUnpricedItem[] = []

  for (const item of items) {
    const unitSanity = getDepotUnitSanity(item.id, pricing)
    if (unitSanity === null) {
      unpricedItems.push({ id: item.id, name: item.name, count: item.count })
      continue
    }
    pricedItems.push({
      id: item.id,
      name: item.name,
      count: item.count,
      unit_sanity: round(unitSanity, 6),
      equivalent_sanity: round(unitSanity * item.count, 2),
    })
  }

  const total = round(pricedItems.reduce((sum, item) => sum + item.equivalent_sanity, 0), 2)
  const warnings: string[] = []
  if (pricing.status === 'unavailable') {
    warnings.push('材料价值源暂不可用，当前仅统计龙门币和作战记录等固定口径物品。')
  }
  if (unpricedItems.length > 0) {
    warnings.push(`有 ${unpricedItems.length} 类物品暂无可靠理智估价，未计入总值。`)
  }

  return {
    source,
    item_count: items.length,
    priced_count: pricedItems.length,
    unpriced_count: unpricedItems.length,
    total_equivalent_sanity: total,
    percentile: estimateDepotPercentile(total),
    top_items: pricedItems
      .sort((left, right) => right.equivalent_sanity - left.equivalent_sanity || left.id.localeCompare(right.id))
      .slice(0, TOP_ITEM_LIMIT),
    unpriced_items: sortUnpricedItems(unpricedItems).slice(0, UNPRICED_ITEM_LIMIT),
    warnings,
    sources: {
      inventory: source,
      yituliu: pricing.status,
      lmd_exp: 'fixed_lmd_exp_36_per_10000',
      ranking: 'entertainment_curve_v1',
    },
    generated_at: new Date().toISOString(),
    build_meta: APP_BUILD_META,
  }
}

function parseFlatDepotItems(value: Record<string, unknown>): DepotInventoryItem[] {
  const entries = Object.entries(value)
  if (entries.length === 0) throw createError('仓库 JSON 不能为空。', 400)
  const items: DepotInventoryItem[] = []
  for (const [id, rawCount] of entries) {
    const count = normalizeCount(rawCount, `物品 ${id}`)
    if (count === 0) continue
    items.push({ id, name: getItemName(id), count })
  }
  if (items.length === 0) throw createError('仓库内没有数量大于 0 的物品。', 400)
  return items
}

function parsePenguinDepotItems(rawItems: unknown[]): DepotInventoryItem[] {
  if (rawItems.length === 0) throw createError('items 不能为空。', 400)
  const items: DepotInventoryItem[] = []
  rawItems.forEach((raw, index) => {
    if (!isRecord(raw)) throw createError(`items[${index}] 必须是对象。`, 400)
    const id = stringValue(raw.id ?? raw.itemId)
    if (!id) throw createError(`items[${index}] 缺少 id。`, 400)
    const count = normalizeCount(raw.have ?? raw.count ?? raw.quantity, `物品 ${id}`)
    if (count === 0) return
    const name = stringValue(raw.name) || getItemName(id)
    items.push({ id, name, count })
  })
  if (items.length === 0) throw createError('仓库内没有数量大于 0 的物品。', 400)
  return items
}

function mergeDepotItems(items: DepotInventoryItem[]): DepotInventoryItem[] {
  const byId = new Map<string, DepotInventoryItem>()
  for (const item of items) {
    const existing = byId.get(item.id)
    if (existing) {
      existing.count += item.count
      if (existing.name === getItemName(existing.id) && item.name !== existing.name) existing.name = item.name
      continue
    }
    byId.set(item.id, { ...item })
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

async function readSklandInventory(req: Request, profileId: unknown): Promise<DepotInventoryItem[]> {
  const auth = await requireUserSession(req)
  if (!auth) throw createError('请先登录。', 401)
  if (typeof profileId !== 'string' || !profileId.trim()) throw createError('缺少 profile_id。', 400)
  const profile = auth.profiles.find((item) => item.id === profileId.trim())
  if (!profile) throw createError('账号档案不存在。', 404)
  if (profile.status !== 'active') throw createError('账号档案状态不可用。', 400)
  const binding = profile.skland_binding
  if (!binding?.encrypted_cred) throw createError('当前账号尚未绑定森空岛。', 404)

  const client = new SklandClient(decryptSklandCredential(binding.encrypted_cred))
  const [calInfo, calPlayer] = await Promise.all([
    client.getCultivateInfo(),
    client.getCultivatePlayer(binding.uid),
  ])
  return mergeDepotItems(readSklandPlayerItems(calInfo, calPlayer))
}

function readSklandPlayerItems(calInfo: unknown, calPlayer: unknown): DepotInventoryItem[] {
  const itemMeta = createItemMeta(unwrapDataRecord(calInfo).items)
  const playerItems = unwrapDataRecord(calPlayer).items
  if (!Array.isArray(playerItems)) throw createError('森空岛养成库存为空或格式异常。', 400)
  return playerItems.flatMap((raw, index) => {
    if (!isRecord(raw)) throw createError(`森空岛库存 items[${index}] 格式异常。`, 400)
    const id = stringValue(raw.id ?? raw.itemId)
    if (!id) throw createError(`森空岛库存 items[${index}] 缺少 id。`, 400)
    const count = normalizeSklandCount(raw.count ?? raw.have ?? raw.quantity, `物品 ${id}`)
    if (count === 0) return []
    const meta = isRecord(itemMeta[id]) ? itemMeta[id] : {}
    return [{ id, name: stringValue(meta.name ?? raw.name) || getItemName(id), count }]
  })
}

function getDepotUnitSanity(id: string, pricing: PricingState): number | null {
  if (UNPRICED_BY_POLICY.has(id)) return null
  const expSanity = getExpItemSanity(id)
  if (expSanity !== null) return expSanity
  if (id === LMD_ITEM_ID) return getNetLmdSanity(pricing)
  const materialSanity = pricing.prices.get(id)
  return materialSanity && materialSanity > 0 ? materialSanity : null
}

function sortUnpricedItems(items: DepotValueUnpricedItem[]): DepotValueUnpricedItem[] {
  return [...items].sort((left, right) => (
    Number(UNPRICED_BY_POLICY.has(right.id)) - Number(UNPRICED_BY_POLICY.has(left.id))
    || right.count - left.count
    || left.id.localeCompare(right.id)
  ))
}

function estimateDepotPercentile(totalSanity: number): number {
  const points = [
    { sanity: 0, percentile: 1 },
    { sanity: 500, percentile: 45 },
    { sanity: 1000, percentile: 60 },
    { sanity: 2000, percentile: 75 },
    { sanity: 4000, percentile: 88 },
    { sanity: 8000, percentile: 95 },
    { sanity: 15000, percentile: 99 },
  ]
  if (!Number.isFinite(totalSanity) || totalSanity <= 0) return 1
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]
    const right = points[index]
    if (totalSanity <= right.sanity) {
      const ratio = (Math.log1p(totalSanity) - Math.log1p(left.sanity)) / (Math.log1p(right.sanity) - Math.log1p(left.sanity))
      return clampPercentile(Math.round(left.percentile + ratio * (right.percentile - left.percentile)))
    }
  }
  return 99
}

function clampPercentile(value: number): number {
  return Math.max(1, Math.min(99, value))
}

function createItemMeta(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const map: Record<string, unknown> = {}
    for (const item of value) {
      if (!isRecord(item)) continue
      const id = stringValue(item.id ?? item.itemId)
      if (id) map[id] = item
    }
    return map
  }
  return isRecord(value) ? value : {}
}

function unwrapDataRecord(value: unknown): Record<string, unknown> {
  const record = isRecord(value) ? value : {}
  return isRecord(record.data) ? record.data : record
}

function readLimitedJsonBody(req: Request): Promise<unknown> {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw createError('仓库 JSON 不能超过 1 MB。', 413)
  }
  return req.text().then((text) => {
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      throw createError('仓库 JSON 不能超过 1 MB。', 413)
    }
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
      throw createError('JSON 格式不正确，请检查文件内容。', 400)
    }
  })
}

function normalizeCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw createError(`${label} 的数量必须是数字。`, 400)
  }
  if (value < 0) throw createError(`${label} 的数量不能为负数。`, 400)
  return value
}

function normalizeSklandCount(value: unknown, label: string): number {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return normalizeCount(parsed, label)
  }
  return normalizeCount(value, label)
}

function getItemName(id: string): string {
  return ITEM_NAMES[id] ?? `物品 ${id}`
}

function createError(message: string, status: number): HandlerError {
  const error = new Error(message) as HandlerError
  error.status = status
  return error
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

function isHandlerError(value: unknown): value is HandlerError {
  return value instanceof Error && typeof (value as HandlerError).status === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
