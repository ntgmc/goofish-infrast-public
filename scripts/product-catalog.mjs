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
  for (const required of ['recommended', 'growth', 'advanced', 'ultimate', 'admin']) {
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
  for (const number of [value.policies.lifetime_operator_updates.window_days, value.policies.lifetime_operator_updates.max_updates, value.policies.support.first_response_business_days]) {
    if (!Number.isInteger(number) || number <= 0) throw new Error('更新窗口、次数和 SLA 必须为正整数。')
  }
}

function renderPrice(value) {
  const free = value.skus.free_preview
  const lifetime = value.skus.single_account_lifetime
  const freePolicy = value.policies.free_preview
  const update = value.policies.lifetime_operator_updates
  const support = value.policies.support
  return `<!-- 此文件由 product/catalog.json 生成，请勿手工编辑。运行 npm run generate:catalog 更新。 -->
# 价格与权益说明

## 版本

| 版本 | 价格 | 核心内容 | 适合用户 |
| --- | ---: | --- | --- |
| ${free.label} | 0 元 | ${free.summary} | ${free.audience} |
| ${lifetime.label} | ${lifetime.price.amount} 元 | ${lifetime.summary} | ${lifetime.audience} |

## 免费预览规则

- ${free.account_scope}。
- 首次领取后拥有 1 个免费完整排班权益；首次完整生成后进入 ${freePolicy.revision_window_hours} 小时确认期，确认期内最多生成 ${freePolicy.revision_limit} 次完整方案，总次数包含首次生成。
- 权益锁定后仍可刷新同 UID 的森空岛干员数据、查看历史方案，并且每月可检测是否值得重排 ${freePolicy.monthly_reorder_checks} 次。
- 检测结果为“强烈建议重排”时，当月额外允许 ${freePolicy.strong_reorder_bonus} 次完整免费生成；该生成不再开启新的确认期。

## 单账号终身版账号与更新规则

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
