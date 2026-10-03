import { useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminInventoryOverview, AdminInventoryGiftVersion } from '../../../lib/admin-inventory-contracts'
import { itemIconPath, normalizeExpiryPolicy, normalizeGiftPackOpeningRule } from '../../../lib/inventory-contracts'
import type { GiftPackContentInput, GiftPackOpeningRule, ItemDefinition } from '../../../lib/inventory-contracts'

export type InventoryPanelProps = {
  data: AdminInventoryOverview
  busy: boolean
  run: <T = unknown>(
    url: string,
    json: Record<string, unknown>,
    success: string,
    options?: { idempotencyScope?: string; confirmation?: string },
  ) => Promise<T | null>
}

export function initialContents(): GiftPackContentInput[] {
  return [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } }]
}

export function canIssueItem(item: ItemDefinition, versions: AdminInventoryGiftVersion[], allowGiftPacks = true): boolean {
  if (!item.issuance_enabled || item.kind === 'cosmetic' || item.kind === 'badge') return false
  return item.kind !== 'gift_pack' || (allowGiftPacks && versions.some((version) => version.item_code === item.code && version.status === 'published'))
}

export function validRewards(contents: GiftPackContentInput[], data: AdminInventoryOverview, allowGiftPacks = false): boolean {
  return contents.length <= 100 && contents.every((entry) => {
    const item = data.definitions.find((definition) => definition.code === entry.item_code)
    return item && canIssueItem(item, data.gift_pack_versions, allowGiftPacks)
      && Number.isInteger(entry.quantity) && entry.quantity >= 1 && entry.quantity <= 10000
      && normalizeExpiryPolicy(entry.expiry) !== null
  })
}

export function validOpeningRule(rule: GiftPackOpeningRule, contentCount: number): boolean {
  return contentCount > 0 && contentCount <= 100 && normalizeGiftPackOpeningRule(rule, contentCount) !== null
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mt-3 block min-w-0 text-sm text-ink-secondary">
    <span className="font-medium">{label}</span>
    {children}
  </label>
}

export function OpeningRuleFields({ rule, contentCount, onChange }: {
  rule: GiftPackOpeningRule
  contentCount: number
  onChange: (rule: GiftPackOpeningRule) => void
}) {
  return <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
    <Field label="奖励方式">
      <select className="tool-field mt-2 min-w-0" value={rule.mode} onChange={(event) => {
        const mode = event.currentTarget.value as GiftPackOpeningRule['mode']
        onChange(mode === 'all' ? { mode } : rule.mode === 'all' ? { mode, count: 1 } : { ...rule, mode })
      }}>
        <option value="all">礼包：领取全部奖励</option>
        <option value="random">宝箱：随机多选奖励</option>
        <option value="choice">宝箱：自选多选奖励</option>
      </select>
    </Field>
    {rule.mode !== 'all' && <Field label="每次领取项数">
      <input className="tool-field mt-2 min-w-0" type="number" required min={1} max={rule.allow_duplicates ? 100 : contentCount} step={1}
        value={Number.isNaN(rule.count) ? '' : rule.count} onChange={(event) => onChange({ ...rule, count: event.currentTarget.valueAsNumber })} />
      <span className="mt-2 block text-xs leading-5">从 {contentCount} 种奖励中领取，每次选中的数量按奖励列表设置。{rule.allow_duplicates ? '同一项可重复领取，领取项数可超过奖励种类数。' : '同一项只领取一次。'}</span>
    </Field>}
    {rule.mode !== 'all' && <label className="flex items-center gap-2 text-sm text-ink-secondary sm:col-span-2">
      <input type="checkbox" className="accent-brand-500" checked={rule.allow_duplicates === true}
        onChange={(event) => onChange({ mode: rule.mode, count: rule.count, ...(event.currentTarget.checked && { allow_duplicates: true }) })} />
      允许重复领取同一种奖励
    </label>}
    {!validOpeningRule(rule, contentCount) && <p className="text-xs text-warning-600 sm:col-span-2" role="status">
      请添加奖励，并将领取项数设为 1 到 {rule.mode !== 'all' && rule.allow_duplicates ? 100 : contentCount} 之间的整数。
    </p>}
  </div>
}

export function RewardListEditor(props: {
  id: string
  label: string
  value: GiftPackContentInput[]
  definitions: ItemDefinition[]
  versions: AdminInventoryGiftVersion[]
  allowGiftPacks: boolean
  onChange: (value: GiftPackContentInput[]) => void
}) {
  const available = props.definitions.filter((item) =>
    canIssueItem(item, props.versions, props.allowGiftPacks) && !props.value.some((entry) => entry.item_code === item.code))
  const [candidateCode, setCandidateCode] = useState('')
  const selectedCandidate = available.some((item) => item.code === candidateCode) ? candidateCode : available[0]?.code ?? ''
  const update = (index: number, changes: Partial<GiftPackContentInput>) =>
    props.onChange(props.value.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry))
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= props.value.length) return
    const next = [...props.value]
    ;[next[index], next[target]] = [next[target], next[index]]
    props.onChange(next)
  }

  return <fieldset className="mt-4 min-w-0" aria-describedby={`${props.id}-help`}>
    <legend className="text-sm font-semibold text-ink-primary">{props.label}</legend>
    <p id={`${props.id}-help`} className="mt-1 text-xs leading-5 text-ink-muted">
      按顺序配置实际发放内容；每项都需明确数量和有效期。{props.allowGiftPacks ? '礼包会在保存时固定最新发布版本。' : '礼包不能嵌套其他礼包。'}
    </p>
    <div className="mt-3 space-y-3">
      {props.value.length === 0 && <div className="tool-inset p-5 text-center text-sm text-ink-muted">尚未添加任何道具</div>}
      {props.value.map((entry, index) => {
        const definition = props.definitions.find((item) => item.code === entry.item_code)
        const name = definition?.name ?? entry.item_code
        const published = definition?.kind === 'gift_pack'
          ? props.versions.filter((version) => version.item_code === entry.item_code && version.status === 'published')
            .sort((left, right) => right.version - left.version)[0]
          : null
        return <article key={entry.item_code} className="tool-inset min-w-0 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <img src={itemIconPath(definition?.icon_key ?? 'placeholder')} alt="" width={48} height={48} className="h-12 w-12 shrink-0 object-contain" />
            <div className="min-w-0">
              <strong className="block break-words text-sm text-ink-primary">{name}</strong>
              <span className="mt-1 block break-all font-mono text-[11px] text-ink-muted">{entry.item_code}</span>
              <span className="mt-1 block text-xs text-ink-secondary">{definition ? itemKindLabel(definition.kind) : '目录中已不存在'}</span>
              {published && <span className="mt-1 block text-xs text-ink-muted">保存时固定 v{published.version}</span>}
              {(!definition || !canIssueItem(definition, props.versions, props.allowGiftPacks)) && <span className="mt-1 block text-xs font-medium text-warning-600">
                当前道具不可用于新配置，请移除或更换。
              </span>}
            </div>
          </div>
          <div className="mt-1 grid min-w-0 gap-x-3 sm:grid-cols-2">
            <Field label="数量">
              <input aria-label={`${name}数量`} type="number" required min={1} max={10000} step={1}
                className="tool-field mt-2 min-w-0" value={Number.isNaN(entry.quantity) ? '' : entry.quantity}
                onChange={(event) => update(index, { quantity: event.currentTarget.valueAsNumber })} />
            </Field>
            <Field label="有效期">
              <select aria-label={`${name}有效期`} className="tool-field mt-2 min-w-0" value={entry.expiry.mode}
                onChange={(event) => update(index, { expiry: event.currentTarget.value === 'never' ? { mode: 'never' } : { mode: 'relative_days', days: 30 } })}>
                <option value="never">永久有效</option>
                <option value="relative_days">领取后若干天</option>
              </select>
            </Field>
            {entry.expiry.mode === 'relative_days' && <Field label="天数">
              <input aria-label={`${name}有效天数`} type="number" required min={1} max={3650} step={1}
                className="tool-field mt-2 min-w-0" value={Number.isNaN(entry.expiry.days) ? '' : entry.expiry.days}
                onChange={(event) => update(index, { expiry: { mode: 'relative_days', days: event.currentTarget.valueAsNumber } })} />
            </Field>}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className="tool-secondary-action" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`上移${name}`}>上移</button>
            <button type="button" className="tool-secondary-action" disabled={index === props.value.length - 1} onClick={() => move(index, 1)} aria-label={`下移${name}`}>下移</button>
            <button type="button" className="tool-secondary-action" onClick={() => props.onChange(props.value.filter((_, entryIndex) => entryIndex !== index))} aria-label={`删除${name}`}>删除</button>
          </div>
        </article>
      })}
    </div>
    <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor={`${props.id}-candidate`}>选择要添加的道具</label>
      <select id={`${props.id}-candidate`} className="tool-field min-w-0 flex-1" value={selectedCandidate}
        disabled={available.length === 0 || props.value.length >= 100} onChange={(event) => setCandidateCode(event.currentTarget.value)}>
        {available.length === 0 ? <option value="">没有更多可添加道具</option>
          : available.map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}
      </select>
      <button type="button" className="tool-secondary-action shrink-0" disabled={!selectedCandidate || props.value.length >= 100} onClick={() => {
        if (!selectedCandidate) return
        props.onChange([...props.value, { item_code: selectedCandidate, quantity: 1, expiry: { mode: 'never' } }])
        setCandidateCode('')
      }}>添加道具</button>
    </div>
  </fieldset>
}

export function RewardSummary({ contents, definitions }: { contents: GiftPackContentInput[]; definitions: ItemDefinition[] }) {
  if (contents.length === 0) return <p className="mt-2 text-xs text-ink-muted">空草稿</p>
  return <ul className="mt-2 space-y-1 break-words text-xs leading-5 text-ink-secondary">
    {contents.map((entry) => <li key={entry.item_code}>
      {definitions.find((item) => item.code === entry.item_code)?.name ?? entry.item_code} ×{entry.quantity} · {entry.expiry.mode === 'never' ? '永久有效' : `领取后 ${entry.expiry.days} 天`}
    </li>)}
  </ul>
}

export function itemKindLabel(kind: ItemDefinition['kind']): string {
  switch (kind) {
    case 'consumable': return '消耗券'
    case 'capacity_upgrade': return '档案扩容'
    case 'gift_pack': return '礼包'
    case 'cosmetic': return '主题装扮（暂未开放）'
    case 'badge': return '成就勋章（暂未开放）'
    case 'license_voucher': return '授权凭证'
  }
}
