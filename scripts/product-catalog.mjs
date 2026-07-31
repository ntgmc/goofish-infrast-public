import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'product/catalog.json')
const pricePath = resolve(root, 'PRICE.md')
const checkOnly = process.argv.includes('--check')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

validateCatalog(catalog)
const generated = renderPrice(catalog)
if (checkOnly) {
  const current = await readFile(pricePath, 'utf8')
  if (normalize(current) !== normalize(generated)) {
    throw new Error('PRICE.md 与 product/catalog.json 不一致，请运行 npm run generate:catalog。')
  }
  console.log('product catalog checks ok')
} else {
  await writeFile(pricePath, generated, 'utf8')
  console.log('PRICE.md generated from product/catalog.json')
}

function validateCatalog(value) {
  if (value.schema_version !== 1) throw new Error('catalog schema_version 必须为 1。')
  const permissions = Object.keys(value.runtime_permissions ?? {})
  for (const required of ['recommended', 'growth', 'advanced', 'metered_advanced', 'ultimate', 'admin']) {
    if (!permissions.includes(required)) throw new Error(`缺少运行时权限 ${required}。`)
  }
  const capabilitySet = new Set(Object.keys(value.capabilities ?? {}))
  if (capabilitySet.size === 0) throw new Error('capabilities 不能为空。')
  for (const [permission, profile] of Object.entries(value.runtime_permissions)) {
    for (const capability of profile.capabilities ?? []) {
      if (!capabilitySet.has(capability)) throw new Error(`${permission} 引用了未知 capability ${capability}。`)
    }
  }
  const publicSkus = Object.entries(value.skus ?? {}).filter(([, sku]) => sku.public)
  if (publicSkus.length !== 2) throw new Error('公开 SKU 必须且只能有两个。')
  for (const [id, sku] of publicSkus) {
    if (!sku.label || !sku.price || !sku.account_scope || !sku.summary || !sku.audience) throw new Error(`公开 SKU ${id} 缺少公开字段。`)
  }
  if (value.skus.free_preview?.price?.amount !== 0) throw new Error('免费预览价格必须为 0。')
  const lifetime = value.skus.single_account_lifetime
  if (lifetime?.price?.amount !== 49 || lifetime.runtime_permission !== 'advanced') throw new Error('终身版必须为 49 元并映射 advanced。')
  if (value.runtime_permissions.ultimate.public || value.runtime_permissions.admin.public) throw new Error('ultimate/admin 不得公开。')
  if (value.runtime_permissions.metered_advanced.admin_issuable || value.runtime_permissions.metered_advanced.public) {
    throw new Error('metered_advanced 不得作为 CDK 权限签发或公开 SKU。')
  }
  const metered = value.policies.metered_billing
  if (!metered?.pricing_version || metered.personal?.main_schedule_points !== '600.00'
    || metered.commercial?.list_price_points !== '1000.00') {
    throw new Error('积分按次计价策略无效。')
  }
  const tierSignature = (metered.commercial.tiers ?? [])
    .map((tier) => `${tier.level}:${tier.threshold_points}:${tier.discount_bps}`).join('|')
  if (tierSignature !== '1:10000.00:1000|2:30000.00:2000|3:50000.00:3000|4:100000.00:4000') {
    throw new Error('商用等级必须为 1万/3万/5万/10万与 10%/20%/30%/40% 折扣。')
  }
  if (!Number.isInteger(value.policies.support.first_response_business_days) || value.policies.support.first_response_business_days <= 0) {
    throw new Error('客服 SLA 必须为正整数。')
  }
}

function renderPrice(value) {
  const free = value.skus.free_preview
  const lifetime = value.skus.single_account_lifetime
  const freePolicy = value.policies.free_preview
  const support = value.policies.support
  const metered = value.policies.metered_billing
  return `<!-- 此文件由 product/catalog.json 生成，请勿手工编辑。运行 npm run generate:catalog 更新。 -->
# 价格与权益说明

## 版本

| 版本 | 价格 | 核心内容 | 适合用户 |
| --- | ---: | --- | --- |
| ${free.label} | 0 元 | ${free.summary} | ${free.audience} |
| ${lifetime.label} | ${lifetime.price.amount} 元 | ${lifetime.summary} | ${lifetime.audience} |
| 普通按次 | ${metered.personal.main_schedule_points} 积分/成功主排班 | 高级版单次结果，不含场景对比 | 低频个人用户；约第 9 次起终身版更划算 |
| 商用按次 | 600–900 积分/成功主排班 | 累计获得 10,000 积分自动解锁，Lv1–Lv4 自动折扣 | 已获授权处理多个 UID 的服务商 |

## 按次排班规则

- 普通按次档案每个网站账号终身最多 1 个，每次成功主排班扣除 ${metered.personal.main_schedule_points} 积分。
- 商用标价 ${metered.commercial.list_price_points} 积分；Lv1–Lv4 实扣依次为 ${metered.commercial.tiers.map((tier) => formatDiscountedPoints(metered.commercial.list_price_points, tier.discount_bps)).join(' / ')} 积分，最低价不低于个人按次价。
- 仅成功且结果已持久化的主排班扣费；排队时预留，失败、取消、队列过期或死信会释放预留。
- 按次档案包含高级版单次结果、MAA JSON、完整计算 JSON、练度建议和 ROI，但不开放场景对比实验室或 trusted 优化器选项。
- 商用档案仅可处理已获授权的数据；不得转售 MaaTool 账号或 CDK，档案和积分不可转让。

## 免费预览规则

- ${free.account_scope}。
- 首次领取后拥有 1 个免费完整排班权益；首次完整生成后进入 ${freePolicy.revision_window_hours} 小时确认期，确认期内最多生成 ${freePolicy.revision_limit} 次完整方案，总次数包含首次生成。
- 权益锁定后仍可刷新同 UID 的森空岛干员数据、查看历史方案，并且每月可检测是否值得重排 ${freePolicy.monthly_reorder_checks} 次。
- 检测结果为“强烈建议重排”时，当月额外允许 ${freePolicy.strong_reorder_bonus} 次完整免费生成；该生成不再开启新的确认期。

## 单账号终身版账号规则

${value.policies.public_disclosures.map((line) => `- ${line}`).join('\n')}
- 人工核验材料齐全后，客服将在 ${support.first_response_business_days} 个工作日内首次响应；工作日按${support.business_day_definition}计算，最终核验与解冻时间视复杂度而定。

## 功能对比

| 功能 | 免费预览 | 单账号终身版 CDK |
| --- | --- | --- |
${value.policies.public_feature_comparison.map((row) => `| ${row.feature} | ${row.free_preview} | ${row.single_account_lifetime} |`).join('\n')}

## 售后与申诉

- 通过${support.channel}提交：${support.required_information.join('、')}。
- 请勿发送：${support.forbidden_information.join('、')}。
- 材料齐全后 ${support.first_response_business_days} 个工作日内首次响应；核验和解冻完成时间视复杂度而定，不承诺固定完成时限。
`
}

function normalize(value) {
  return value.replace(/\r\n/g, '\n').trimEnd()
}

function formatDiscountedPoints(value, discountBps) {
  const [whole, fraction = ''] = value.split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  const discounted = (minor * BigInt(10000 - discountBps) + 5000n) / 10000n
  return `${discounted / 100n}.${String(discounted % 100n).padStart(2, '0')}`
}
