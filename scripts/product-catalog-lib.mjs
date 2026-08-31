export function validateCatalog(value) {
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
  if (publicSkus.length !== 5) throw new Error('公开 SKU 必须包含免费预览和四种单账号卡。')
  for (const [id, sku] of publicSkus) {
    if (!sku.label || !sku.price || !sku.original_display_price || !Number.isInteger(sku.default_discount_fold)
      || sku.default_discount_fold < 1 || sku.default_discount_fold > 10
      || !sku.account_scope || !sku.summary || !sku.audience) {
      throw new Error(`公开 SKU ${id} 缺少公开字段或默认折扣无效。`)
    }
    if (sku.display_price !== formatDiscountedPrice(sku.original_display_price, sku.default_discount_fold)) {
      throw new Error(`公开 SKU ${id} 的折后价格与原价/默认折扣不一致。`)
    }
  }
  if (value.skus.free_preview?.price?.amount !== 0) throw new Error('免费预览价格必须为 0。')
  const termSkus = [
    ['single_account_monthly', 12.9, 30, 10, '12.9 元 / 30 天', '12.9 元 / 30 天'],
    ['single_account_half_year', 24.9, 90, 10, '24.9 元 / 90 天', '24.9 元 / 90 天'],
    ['single_account_annual', 44.9, 365, 10, '44.9 元 / 365 天', '44.9 元 / 365 天'],
    ['single_account_lifetime', 59, null, 10, '59 元 / 长期', '59 元 / 长期'],
  ]
  for (const [id, amount, durationDays, discountFold, originalDisplayPrice, displayPrice] of termSkus) {
    const sku = value.skus[id]
    if (!sku?.public || sku.runtime_permission !== 'advanced' || sku.price?.amount !== amount || sku.duration_days !== durationDays
      || sku.default_discount_fold !== discountFold || sku.original_display_price !== originalDisplayPrice || sku.display_price !== displayPrice) {
      throw new Error(`${id} 价格、有效期或权限映射无效。`)
    }
  }
  if (value.runtime_permissions.ultimate.public || value.runtime_permissions.admin.public) throw new Error('ultimate/admin 不得公开。')
  if (value.runtime_permissions.metered_advanced.admin_issuable || value.runtime_permissions.metered_advanced.public) {
    throw new Error('metered_advanced 不得作为 CDK 权限签发或公开 SKU。')
  }
  const metered = value.policies.metered_billing
  if (metered?.pricing_version !== '2026-08-09-v4' || metered.personal?.label !== '积分单次排班' || metered.personal?.main_schedule_points !== '1000.00'
    || metered.personal?.incremental_recompute_points !== '700.00'
    || metered.personal?.scenario_comparison_points !== '300.00'
    || JSON.stringify(metered.schedule_quotas) !== JSON.stringify({ month: null, half_year: null, year: null, lifetime: null })
    || JSON.stringify(metered.scenario_quotas) !== JSON.stringify({ month: 1, half_year: 3, year: 8, lifetime: null })
    || metered.commercial?.label !== '商用版积分单次'
    || metered.commercial?.list_price_points !== '1500.00') {
    throw new Error('积分按次计价策略无效。')
  }
  const freePreview = value.policies.free_preview
  if (freePreview?.submission_window_hours !== 6 || freePreview?.max_submissions_per_window !== 2
    || freePreview?.monthly_reorder_checks !== 2) {
    throw new Error('免费预览权益必须为每 6 小时最多 2 次完整排班、每月 2 次变化影响预判。')
  }
  const tierSignature = (metered.commercial.tiers ?? [])
    .map((tier) => `${tier.level}:${tier.threshold_points}:${tier.discount_bps}:${tier.charge_points}`).join('|')
  if (tierSignature !== '1:10000.00:1000:1350.00|2:30000.00:1667:1250.00|3:50000.00:2333:1150.00|4:100000.00:2667:1100.00') {
    throw new Error('商用等级必须为 1万/3万/5万/10万与 1350/1250/1150/1100 积分。')
  }
  if (!Number.isInteger(value.policies.support.first_response_business_days) || value.policies.support.first_response_business_days <= 0) {
    throw new Error('客服 SLA 必须为正整数。')
  }
}

export function renderPrice(value) {
  const publicSkus = Object.entries(value.skus).filter(([, sku]) => sku.public)
  const freePolicy = value.policies.free_preview
  const support = value.policies.support
  const metered = value.policies.metered_billing
  const personalPoints = metered.personal.main_schedule_points
  const incrementalPoints = metered.personal.incremental_recompute_points
  const scenarioPoints = metered.personal.scenario_comparison_points
  const scenarioQuotas = metered.scenario_quotas
  const commercialCharges = metered.commercial.tiers.map((tier) => tier.charge_points)
  const commercialLowest = commercialCharges.at(-1)
  const commercialHighest = commercialCharges[0]
  const monthly = value.skus.single_account_monthly
  const version = value.skus.single_account_half_year
  const annual = value.skus.single_account_annual
  const lifetime = value.skus.single_account_lifetime
  return `<!-- 此文件由 product/catalog.json 生成，请勿手工编辑。运行 npm run generate:catalog 更新。 -->
# 价格与权益说明

## 版本

| 版本 | 价格 | 核心内容 | 适合用户 |
| --- | ---: | --- | --- |
${publicSkus.map(([, sku]) => `| ${tableCell(sku.label)} | ${tableCell(formatPublicPrice(sku))} | ${tableCell(sku.summary)} | ${tableCell(sku.audience)} |`).join('\n')}
| ${tableCell(metered.personal.label)} | ${personalPoints} 积分/成功主排班 | 高级版单次结果，不含场景对比 | 低频个人用户；按成功任务使用，不锁定长期权益 |
| 个人增量重算 | ${incrementalPoints} 积分/成功重算 | 绑定同一 UID 的已有成功结果，用于练度提高或新增干员后的重新优化 | 已有方案、只需跟进干员数据变化的个人用户 |
| 场景对比包 | ${scenarioPoints} 积分/成功对比 | 一次最多比较 3 个额外基建配置，输出效率指标、差距与适用条件 | 想比较多种基建配置但不需要长期权益的用户 |
| ${tableCell(metered.commercial.label)} | ${commercialLowest}–${commercialHighest} 积分/成功主排班 | 标价 ${metered.commercial.list_price_points} 积分，累计等级自动折扣 | 已获授权处理多个 UID 的服务商 |

## 维护方案选购建议

- 30 天尝鲜维护包：${monthly.display_price}，适合近期练度变化较多、想集中验证方案的用户。
- 90 天版本维护卡：${version.display_price}，适合覆盖一个版本周期并持续调整方案的用户。
- 365 天年度维护卡：${annual.display_price}，适合全年维护同一 UID 的用户。
- 终身卡：${lifetime.display_price}，长期使用和高频重新优化的用户更划算；所有个人维护方案都只绑定一个游戏 UID。

## 权益口径

- 完整个人排班：根据当前干员和配置生成一份可直接使用的新轮换方案。
- 变化影响预判：对比当前数据与最近一次成功排班，只返回是否建议重新生成、预计收益区间、受影响设施和关键干员，不生成新排班。
- 个人增量重算：绑定同一档案的已有成功结果，重新计算并生成一份完整的新排班；付费 CDK 已包含，个人按次档案按成功任务计费。

## 按次排班规则

- ${metered.personal.label}档案每个网站账号终身最多 1 个，每次成功主排班扣除 ${metered.personal.main_schedule_points} 积分（约 10 元）。
- 个人增量重算每次成功扣除 ${incrementalPoints} 积分（约 7 元），必须绑定同一档案的一份已有成功结果；当前版本绑定历史基线并重新执行完整计算，暂未复用底层计算缓存。
- 场景对比包每次成功扣除 ${scenarioPoints} 积分（约 3 元），一次最多提交 3 个额外基建配置；已有场景券仍可替代积分包且不会重复消耗。
- ${metered.commercial.label}标价 ${metered.commercial.list_price_points} 积分；Lv1–Lv4 实扣依次为 ${commercialCharges.join(' / ')} 积分，最低价不低于个人按次价。
- 仅成功且结果已持久化的主排班扣费；排队时预留，失败、取消、队列过期或死信会释放预留。
- 按次档案包含高级版单次结果、MAA JSON、完整计算 JSON、练度建议和 ROI；同一数据快照的格式导出不重复收费，但不开放场景对比实验室或 trusted 优化器选项。
- 商用档案仅可处理已获授权的数据；不得转售 MaaTool 账号或 CDK，档案和积分不可转让。

## 免费预览规则

- ${value.skus.free_preview.account_scope}。
- 每 ${freePolicy.submission_window_hours} 小时最多提交 ${freePolicy.max_submissions_per_window} 次完整个人排班；同一档案同时最多有 ${freePolicy.max_active_jobs_per_profile} 个排班正在等待或计算。
- 系统有空闲资源时会自动开始免费排班；繁忙时会先处理付费排班，你的排班会继续等待。
- 如果计算途中系统变得繁忙，你的排班会自动重新排队并重新计算，无需再次提交；完成时间可能会延后。
- 已有成功排班后，每月可进行 ${freePolicy.monthly_reorder_checks} 次变化影响预判；预判不生成新排班，也不占用每 ${freePolicy.submission_window_hours} 小时 ${freePolicy.max_submissions_per_window} 次的完整排班提交次数。
- 每月预判次数用尽后，可使用一张变化预判券增加 1 次；使用券仍只返回判断结果，不生成新排班。

## 单账号卡账号规则

- 完整个人排班：30 天、90 天和 365 天卡均可在有效期内不限次数生成，终身卡可长期不限次数生成。
- 个人增量重算：所有有效付费 CDK 均已包含，绑定同一档案的已有成功结果后即可不限次数使用。
- 场景对比额度：30 天卡 ${scenarioQuotas.month} 次、90 天卡 ${scenarioQuotas.half_year} 次、365 天卡 ${scenarioQuotas.year} 次，终身卡无限；每次最多提交 3 个额外基建配置。周期卡额度用完后不能继续提交场景对比，个人按次档案可购买 ${scenarioPoints} 积分场景对比包。

${value.policies.public_disclosures.map((line) => `- ${line}`).join('\n')}
- 人工核验材料齐全后，客服将在 ${support.first_response_business_days} 个工作日内首次响应；工作日按${support.business_day_definition}计算，最终核验与解冻时间视复杂度而定。

## 功能对比

| 功能 | ${publicSkus.map(([, sku]) => tableCell(sku.label)).join(' | ')} |
| --- | ${publicSkus.map(() => '---').join(' | ')} |
${value.policies.public_feature_comparison.map((row) => `| ${tableCell(row.feature)} | ${publicSkus.map(([id]) => tableCell(row[id] ?? '—')).join(' | ')} |`).join('\n')}

## 售后与申诉

- 通过${support.channel}提交：${support.required_information.join('、')}。
- 请勿发送：${support.forbidden_information.join('、')}。
- 材料齐全后 ${support.first_response_business_days} 个工作日内首次响应；核验和解冻完成时间视复杂度而定，不承诺固定完成时限。
`
}

export function tableCell(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')
}

function formatPublicPrice(sku) {
  if (sku.default_discount_fold >= 10) return sku.display_price
  return `${sku.display_price}<br>原价 ${sku.original_display_price} · ${sku.default_discount_fold} 折`
}

function formatDiscountedPrice(originalPrice, discountFold) {
  const match = /^(\d+(?:\.\d{1,2})?)(\s*元(?:\s*\/\s*\S.*)?)$/.exec(String(originalPrice).trim())
  if (!match) return originalPrice
  const amount = Math.round((Number(match[1]) * discountFold / 10) * 100) / 100
  const amountText = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/0+$/, '')
  return `${amountText}${match[2]}`
}
