import { createHmac } from 'node:crypto'
import type {
  DepotValueItem,
  DepotValueRanking,
  DepotValueSampleContributionStatus,
  DepotValueResponse,
  DepotValueSource,
  DepotValueUnpricedItem,
  LicenseOperator,
} from '../../src/lib/types'
import { APP_BUILD_META } from '../../src/lib/build-meta'
import { MAX_DEPOT_ITEM_COUNT } from '../../src/lib/depot-value-constraints'
import { getValidatedJsonValue } from '../security/request-validation'
import { requireUserSession } from './user-auth'
import { requireSiteFeatures } from '../feature-gate'
import { convertSklandCharactersToOperators, decryptSklandCredential, SklandClient } from './skland-client'
import {
  getExpItemSanity,
  getNetLmdSanity,
  getYituliuPricing,
  round,
  type PricingState,
} from './material-value'
import {
  getDepotValueSampleStore,
  type DepotValueSampleRecord,
  type DepotValueSampleStore,
} from '../storage/depot-value-sample-store'

const TOP_ITEM_LIMIT = 8
const UNPRICED_ITEM_LIMIT = 12
const SAMPLE_WEIGHT_PRIOR_COUNT = 200
const DEPOT_CURVE_SANITY_SCALE = 30
const MIN_SAMPLE_PRICING_COVERAGE = 0.8
const LMD_ITEM_ID = '4001'
const UNPRICED_BY_POLICY = new Set(['3401', 'mod_unlock_token', 'mod_update_token_1', 'mod_update_token_2'])

type DepotInventoryItem = {
  id: string
  name: string
  count: number
}

type HandlerError = Error & {
  status?: number
  code?: string
}

type SklandDepotRead = {
  inventory: DepotInventoryItem[]
  sample: SklandSampleData | null
}

type SklandSampleData = {
  uid: string
  accountLevel: number | null
  operatorStats: DepotOperatorStats
}

type DepotOperatorStats = {
  operator_count: number
  elite2_count: number
  six_star_count: number
  six_star_e2_count: number
  e2_90_count: number
  operator_power_score: number
}

type DepotValueBuildOptions = {
  sample?: SklandSampleData | null
  contributorProfileId?: string | null
  sampleConsent?: boolean
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
  if (req.method !== 'POST' && req.method !== 'DELETE') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await readLimitedJsonBody(req)
    if (!isRecord(body)) return jsonResponse({ error: '请求体必须是对象。' }, 400)
    if (req.method === 'DELETE') return revokeDepotSample(req, body.profile_id)
    if (body.source === 'upload') {
      return jsonResponse(await buildDepotValueResponse(normalizeDepotInventory(body.inventory), 'upload'))
    }
    if (body.source === 'skland') {
      const gated = await requireSiteFeatures(['login', 'profiles', 'skland'])
      if (gated) return gated
      const sampleConsent = body.sample_consent === true
      const skland = await readSklandInventory(req, body.profile_id, sampleConsent)
      return jsonResponse(await buildDepotValueResponse(skland.inventory, 'skland', undefined, {
        sample: skland.sample,
        contributorProfileId: typeof body.profile_id === 'string' ? body.profile_id : null,
        sampleConsent,
      }))
    }
    return jsonResponse({ error: '请指定 source 为 upload 或 skland。' }, 400)
  } catch (error) {
    console.error('depot value error:', error instanceof Error ? error.message : error)
    const status = isHandlerError(error) ? error.status ?? 500 : 500
    const message = isHandlerError(error) ? error.message : 'Internal server error'
    return jsonResponse({ error: message, ...(isHandlerError(error) && error.code ? { code: error.code } : {}) }, status)
  }
}

async function revokeDepotSample(req: Request, profileIdValue: unknown): Promise<Response> {
  const auth = await requireUserSession(req)
  if (!auth) throw createError('请先登录。', 401)
  const profileId = typeof profileIdValue === 'string' ? profileIdValue.trim() : ''
  if (!profileId) throw createError('缺少 profile_id。', 400)
  if (!auth.profiles.some((profile) => profile.id === profileId)) throw createError('账号档案不存在。', 404)
  const deletedCount = await getDepotValueSampleStore()?.deleteForContributorProfile(profileId) ?? 0
  return jsonResponse({ revoked: true, deleted_count: deletedCount })
}

function normalizeDepotInventory(value: unknown): DepotInventoryItem[] {
  if (!isRecord(value)) throw createError('仓库 JSON 必须是对象。', 400)
  if (Array.isArray(value.items)) return mergeDepotItems(parsePenguinDepotItems(value.items))
  return mergeDepotItems(parseFlatDepotItems(value))
}

async function buildDepotValueResponse(
  items: DepotInventoryItem[],
  source: DepotValueSource,
  pricingState?: PricingState,
  options: DepotValueBuildOptions = {},
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
    const equivalentSanity = checkedRound(unitSanity * item.count, 2, `物品 ${item.id}`)
    pricedItems.push({
      id: item.id,
      name: item.name,
      count: item.count,
      unit_sanity: checkedRound(unitSanity, 6, `物品 ${item.id}`),
      equivalent_sanity: equivalentSanity,
    })
  }

  let totalRaw = 0
  for (const item of pricedItems) {
    totalRaw += item.equivalent_sanity
    assertFiniteValuation(totalRaw, '仓库总值')
  }
  const total = checkedRound(totalRaw, 2, '仓库总值')
  const pricingCoverage = calculatePricingCoverage(items, pricedItems)
  const warnings: string[] = []
  if (pricing.status === 'stale') {
    warnings.push('材料价值源刷新失败，当前使用有效期内的历史价格快照。')
  } else if (pricing.status === 'invalid') {
    warnings.push('材料价值源返回了无效数据，当前仅统计龙门币和作战记录等固定口径物品。')
  } else if (pricing.status === 'unavailable') {
    warnings.push('材料价值源暂不可用，当前仅统计龙门币和作战记录等固定口径物品。')
  }
  if (unpricedItems.length > 0) {
    warnings.push(`有 ${unpricedItems.length} 类物品暂无可靠理智估价，未计入总值。`)
  }
  const sampleStore = getDepotValueSampleStore()
  const contributionStatus = await saveDepotSampleIfRequested({
    source,
    total,
    itemCount: items.length,
    pricedCount: pricedItems.length,
    unpricedCount: unpricedItems.length,
    sample: options.sample ?? null,
    contributorProfileId: options.contributorProfileId ?? null,
    sampleConsent: options.sampleConsent === true,
    pricing,
    pricingCoverage,
    sampleStore,
    warnings,
  })
  const rankingResult = await buildDepotRanking(
    total,
    pricing.valuation_version,
    sampleStore,
    contributionStatus,
    warnings,
  )

  return {
    source,
    item_count: items.length,
    priced_count: pricedItems.length,
    unpriced_count: unpricedItems.length,
    total_equivalent_sanity: total,
    percentile: rankingResult.percentile,
    ranking: rankingResult.ranking,
    top_items: pricedItems
      .sort((left, right) => right.equivalent_sanity - left.equivalent_sanity || left.id.localeCompare(right.id))
      .slice(0, TOP_ITEM_LIMIT),
    unpriced_items: sortUnpricedItems(unpricedItems).slice(0, UNPRICED_ITEM_LIMIT),
    warnings,
    sources: {
      inventory: source,
      yituliu: pricing.status,
      pricing_snapshot_id: pricing.snapshot_id,
      pricing_fetched_at: pricing.fetched_at,
      pricing_age_ms: pricing.age_ms,
      valuation_version: pricing.valuation_version,
      pricing_coverage: pricingCoverage,
      lmd_exp: 'fixed_lmd_exp_36_per_10000',
      ranking: rankingResult.ranking.mode === 'sample_adjusted' ? 'sample_adjusted_curve_v1' : 'entertainment_curve_v1',
    },
    generated_at: new Date().toISOString(),
    build_meta: APP_BUILD_META,
  }
}

async function saveDepotSampleIfRequested({
  source,
  total,
  itemCount,
  pricedCount,
  unpricedCount,
  sample,
  contributorProfileId,
  sampleConsent,
  pricing,
  pricingCoverage,
  sampleStore,
  warnings,
}: {
  source: DepotValueSource
  total: number
  itemCount: number
  pricedCount: number
  unpricedCount: number
  sample: SklandSampleData | null
  contributorProfileId: string | null
  sampleConsent: boolean
  pricing: PricingState
  pricingCoverage: number
  sampleStore: DepotValueSampleStore | null
  warnings: string[]
}): Promise<DepotValueSampleContributionStatus> {
  if (source !== 'skland') return 'not_applicable'
  if (!sampleConsent) return 'declined'
  if (!sampleStore || !sample) return 'unavailable'
  if ((pricing.status !== 'fresh' && pricing.status !== 'stale')
    || !pricing.snapshot_id
    || !pricing.fetched_at
    || pricingCoverage < MIN_SAMPLE_PRICING_COVERAGE) {
    warnings.push(`本次价格覆盖率为 ${Math.round(pricingCoverage * 100)}%，未达到统计样本保存标准。`)
    return 'skipped'
  }

  try {
    const hashes = hashSklandUidCandidates(sample.uid)
    const currentHash = hashes[0]
    if (!currentHash) throw new Error('DEPOT_SAMPLE_HASH_SECRET is not configured')
    const now = new Date().toISOString()
    const record: DepotValueSampleRecord = {
      version: 2,
      uid_hash: currentHash.hash,
      uid_hash_key_version: currentHash.keyVersion,
      contributor_profile_id: contributorProfileId,
      valuation_version: pricing.valuation_version,
      pricing_snapshot_id: pricing.snapshot_id,
      pricing_fetched_at: pricing.fetched_at,
      pricing_status: pricing.status,
      pricing_coverage: pricingCoverage,
      complete: true,
      total_equivalent_sanity: total,
      account_level: sample.accountLevel,
      operator_power_score: sample.operatorStats.operator_power_score,
      operator_count: sample.operatorStats.operator_count,
      elite2_count: sample.operatorStats.elite2_count,
      six_star_count: sample.operatorStats.six_star_count,
      six_star_e2_count: sample.operatorStats.six_star_e2_count,
      e2_90_count: sample.operatorStats.e2_90_count,
      inventory_item_count: itemCount,
      priced_count: pricedCount,
      unpriced_count: unpricedCount,
      sample_json: {
        version: 2,
        source: 'skland',
        valuation_version: pricing.valuation_version,
        pricing_snapshot_id: pricing.snapshot_id,
        pricing_fetched_at: pricing.fetched_at,
        pricing_status: pricing.status,
        pricing_coverage: pricingCoverage,
        complete: true,
        total_equivalent_sanity: total,
        account_level: sample.accountLevel,
        operator_power_score: sample.operatorStats.operator_power_score,
        operator_count: sample.operatorStats.operator_count,
        elite2_count: sample.operatorStats.elite2_count,
        six_star_count: sample.operatorStats.six_star_count,
        six_star_e2_count: sample.operatorStats.six_star_e2_count,
        e2_90_count: sample.operatorStats.e2_90_count,
        inventory_item_count: itemCount,
        priced_count: pricedCount,
        unpriced_count: unpricedCount,
        sampled_at: now,
      },
      sampled_at: now,
      updated_at: now,
    }
    await sampleStore.save(record, hashes.slice(1).map((candidate) => candidate.hash))
    return 'saved'
  } catch (error) {
    console.warn('depot value sample save failed:', error instanceof Error ? error.message : error)
    warnings.push('假名化统计样本暂未保存，本次分析结果不受影响。')
    return 'unavailable'
  }
}

async function buildDepotRanking(
  totalSanity: number,
  valuationVersion: string,
  sampleStore: DepotValueSampleStore | null,
  contributionStatus: DepotValueSampleContributionStatus,
  warnings: string[],
): Promise<{ percentile: number; ranking: DepotValueRanking }> {
  const curvePercentile = estimateDepotCurvePercentile(totalSanity)
  const curveRanking: DepotValueRanking = {
    mode: 'curve',
    sample_count: 0,
    sample_weight: 0,
    curve_percentile: curvePercentile,
    sample_percentile: null,
    contribution_status: contributionStatus,
  }
  if (!sampleStore) return { percentile: curvePercentile, ranking: curveRanking }

  try {
    const distribution = await sampleStore.getDistribution(totalSanity, valuationVersion)
    if (distribution.sample_count <= 0) return { percentile: curvePercentile, ranking: curveRanking }
    const samplePercentile = ((distribution.less_count + distribution.equal_count * 0.5) / distribution.sample_count) * 100
    const sampleWeight = distribution.sample_count / (distribution.sample_count + SAMPLE_WEIGHT_PRIOR_COUNT)
    const percentile = clampPercentile(Math.round(
      curvePercentile * (1 - sampleWeight) + samplePercentile * sampleWeight,
    ))
    return {
      percentile,
      ranking: {
        mode: 'sample_adjusted',
        sample_count: distribution.sample_count,
        sample_weight: round(sampleWeight, 4),
        curve_percentile: curvePercentile,
        sample_percentile: round(samplePercentile, 2),
        contribution_status: contributionStatus,
      },
    }
  } catch (error) {
    console.warn('depot value sample ranking failed:', error instanceof Error ? error.message : error)
    warnings.push('真实样本库暂不可用，本次使用估算曲线。')
    return { percentile: curvePercentile, ranking: curveRanking }
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
      existing.count = normalizeCount(existing.count + item.count, `物品 ${item.id}`)
      if (existing.name === getItemName(existing.id) && item.name !== existing.name) existing.name = item.name
      continue
    }
    byId.set(item.id, { ...item })
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function calculatePricingCoverage(items: DepotInventoryItem[], pricedItems: DepotValueItem[]): number {
  const eligibleIds = new Set(items.filter((item) => !UNPRICED_BY_POLICY.has(item.id)).map((item) => item.id))
  if (eligibleIds.size === 0) return 1
  const coveredCount = pricedItems.filter((item) => eligibleIds.has(item.id)).length
  return round(coveredCount / eligibleIds.size, 4)
}

function checkedRound(value: number, digits: number, label: string): number {
  assertFiniteValuation(value, label)
  const rounded = round(value, digits)
  assertFiniteValuation(rounded, label)
  return rounded
}

function assertFiniteValuation(value: number, label: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw createError(`${label} 超出可安全计算范围。`, 400, 'count_out_of_range')
  }
}

async function readSklandInventory(
  req: Request,
  profileId: unknown,
  includeSample: boolean,
): Promise<SklandDepotRead> {
  const auth = await requireUserSession(req)
  if (!auth) throw createError('请先登录。', 401)
  if (typeof profileId !== 'string' || !profileId.trim()) throw createError('缺少 profile_id。', 400)
  const profile = auth.profiles.find((item) => item.id === profileId.trim())
  if (!profile) throw createError('账号档案不存在。', 404)
  if (profile.status !== 'active') throw createError('账号档案状态不可用。', 400)
  const binding = profile.skland_binding
  if (!binding?.encrypted_cred) throw createError('当前账号尚未绑定森空岛。', 404)

  const client = new SklandClient(decryptSklandCredential(binding.encrypted_cred))
  const playerInfoPromise = includeSample
    ? client.getGamePlayerInfo(binding.uid)
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }))
    : Promise.resolve(null)
  const [calInfo, calPlayer] = await Promise.all([
    client.getCultivateInfo(),
    client.getCultivatePlayer(binding.uid),
  ])
  const playerInfo = await playerInfoPromise
  const inventory = mergeDepotItems(readSklandPlayerItems(calInfo, calPlayer))
  let sample: SklandSampleData | null = null
  if (playerInfo?.ok) {
    try {
      sample = buildSklandSampleData(binding.uid, playerInfo.value)
    } catch (error) {
      console.warn('depot value skland sample parse failed:', error instanceof Error ? error.message : error)
    }
  } else if (playerInfo && !playerInfo.ok) {
    console.warn('depot value skland sample fetch failed:', playerInfo.error instanceof Error ? playerInfo.error.message : playerInfo.error)
  }
  return { inventory, sample }
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

function buildSklandSampleData(uid: string, gamePlayerInfo: unknown): SklandSampleData {
  return {
    uid,
    accountLevel: readAccountLevel(gamePlayerInfo),
    operatorStats: summarizeOperators(convertSklandCharactersToOperators(gamePlayerInfo)),
  }
}

function summarizeOperators(operators: LicenseOperator[]): DepotOperatorStats {
  const owned = operators.filter((operator) => operator.own !== false)
  let operatorPowerScore = 0
  let elite2Count = 0
  let sixStarCount = 0
  let sixStarE2Count = 0
  let e2MaxLevelCount = 0

  for (const operator of owned) {
    const rarity = numberValue(operator.rarity) ?? 0
    const elite = numberValue(operator.elite) ?? 0
    const level = Math.max(0, Math.min(90, numberValue(operator.level) ?? 0))
    const isElite2 = elite >= 2
    const isSixStar = rarity >= 5
    operatorPowerScore += (rarity + 1) * (elite * 100 + level)
    if (isElite2) elite2Count += 1
    if (isSixStar) sixStarCount += 1
    if (isSixStar && isElite2) sixStarE2Count += 1
    if (isElite2 && level >= 90) e2MaxLevelCount += 1
  }

  return {
    operator_count: owned.length,
    elite2_count: elite2Count,
    six_star_count: sixStarCount,
    six_star_e2_count: sixStarE2Count,
    e2_90_count: e2MaxLevelCount,
    operator_power_score: round(operatorPowerScore, 2),
  }
}

function readAccountLevel(value: unknown): number | null {
  const paths = [
    ['data', 'status', 'level'],
    ['data', 'player', 'level'],
    ['data', 'level'],
    ['data', 'user', 'level'],
    ['status', 'level'],
    ['player', 'level'],
    ['level'],
    ['user', 'level'],
  ]
  for (const path of paths) {
    const level = numberValue(readPath(value, path))
    if (level !== null && level >= 0) return Math.floor(level)
  }
  return null
}

function hashSklandUidCandidates(uid: string): Array<{ hash: string; keyVersion: string }> {
  const candidates = [
    {
      secret: process.env.DEPOT_SAMPLE_HASH_SECRET?.trim(),
      keyVersion: process.env.DEPOT_SAMPLE_HASH_KEY_VERSION?.trim() || '1',
    },
    {
      secret: process.env.DEPOT_SAMPLE_HASH_SECRET_PREVIOUS?.trim(),
      keyVersion: process.env.DEPOT_SAMPLE_HASH_PREVIOUS_KEY_VERSION?.trim() || 'previous',
    },
  ]
  return candidates.flatMap(({ secret, keyVersion }) => secret
    ? [{ hash: createHmac('sha256', secret).update(`skland:${uid}`).digest('hex'), keyVersion }]
    : [])
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

function estimateDepotCurvePercentile(totalSanity: number): number {
  const points = [
    { sanity: 0, percentile: 1 },
    { sanity: 500, percentile: 45 },
    { sanity: 1000, percentile: 60 },
    { sanity: 2000, percentile: 75 },
    { sanity: 4000, percentile: 88 },
    { sanity: 8000, percentile: 95 },
    { sanity: 15000, percentile: 99 },
  ].map((point) => ({
    ...point,
    sanity: point.sanity * DEPOT_CURVE_SANITY_SCALE,
  }))
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
  return getValidatedJsonValue(req)
}

function normalizeCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw createError(`${label} 的数量必须是安全整数。`, 400, 'count_out_of_range')
  }
  if (value < 0 || value > MAX_DEPOT_ITEM_COUNT) {
    throw createError(`${label} 的数量必须在 0 到 ${MAX_DEPOT_ITEM_COUNT} 之间。`, 400, 'count_out_of_range')
  }
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

function createError(message: string, status: number, code?: string): HandlerError {
  const error = new Error(message) as HandlerError
  error.status = status
  error.code = code
  return error
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
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

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}
