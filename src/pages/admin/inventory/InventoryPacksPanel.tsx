import { useState } from 'react'
import type { GiftPackOpeningRule } from '../../../lib/inventory-contracts'
import {
  Field, initialContents, OpeningRuleFields, RewardListEditor, RewardSummary, validOpeningRule, validRewards,
  type InventoryPanelProps,
} from './InventoryEditors'

export function InventoryPacksPanel({ data, busy, run }: InventoryPanelProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [contents, setContents] = useState(initialContents)
  const [openingRule, setOpeningRule] = useState<GiftPackOpeningRule>({ mode: 'all' })
  const [versionItemCode, setVersionItemCode] = useState('')
  const [versionContents, setVersionContents] = useState(initialContents)
  const [versionOpeningRule, setVersionOpeningRule] = useState<GiftPackOpeningRule>({ mode: 'all' })
  const packValid = name.trim().length > 0 && description.trim().length > 0
    && validOpeningRule(openingRule, contents.length) && validRewards(contents, data)
  const versionValid = versionItemCode && validOpeningRule(versionOpeningRule, versionContents.length)
    && validRewards(versionContents, data)

  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
    <form className="tool-panel min-w-0 p-5" onSubmit={(event) => {
      event.preventDefault()
      if (!packValid) return
      const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'draft'
      void run('/api/admin/items', {
        action: 'create_gift_pack', name: name.trim(), description: description.trim(),
        icon_key: 'generic_gift_pack', contents, opening_rule: openingRule, publish,
      }, publish ? '礼包或宝箱已发布，可直接配置为奖励。' : '礼包草稿已创建。', { idempotencyScope: 'create_gift_pack' })
    }}>
      <h3 className="text-base font-semibold text-ink-primary">创建礼包或宝箱</h3>
      <Field label="礼包名称">
        <input className="tool-field mt-2 min-w-0" required maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} />
      </Field>
      <Field label="说明">
        <textarea className="tool-field mt-2 min-h-20 min-w-0" required maxLength={500} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
      </Field>
      <RewardListEditor id="new-pack-contents" label="礼包内容" value={contents} definitions={data.definitions}
        versions={data.gift_pack_versions} allowGiftPacks={false} onChange={setContents} />
      <OpeningRuleFields rule={openingRule} contentCount={contents.length} onChange={setOpeningRule} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="tool-primary-action" disabled={busy || !packValid}>创建并发布</button>
        <button value="draft" className="tool-secondary-action" disabled={busy || !packValid}>创建草稿</button>
      </div>
    </form>

    <section className="tool-panel min-w-0 p-5">
      <h3 className="text-base font-semibold text-ink-primary">礼包版本</h3>
      <form className="mt-4 border-b border-surface-3 pb-4" onSubmit={(event) => {
        event.preventDefault()
        if (!versionValid) return
        const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'draft'
        void run('/api/admin/items', {
          action: 'create_gift_pack_version', item_code: versionItemCode, contents: versionContents,
          opening_rule: versionOpeningRule, publish,
        }, publish ? '新版本已发布。' : '礼包新版本草稿已创建。', { idempotencyScope: 'create_gift_pack_version' })
      }}>
        <Field label="基于礼包创建新版本">
          <select className="tool-field mt-2 min-w-0" required value={versionItemCode} onChange={(event) => {
            const code = event.currentTarget.value
            setVersionItemCode(code)
            const latest = data.gift_pack_versions.filter((version) => version.item_code === code)
              .sort((left, right) => right.version - left.version)[0]
            setVersionContents(latest?.contents.map((content) => ({ ...content, expiry: { ...content.expiry } })) ?? initialContents())
            setVersionOpeningRule(latest?.opening_rule ?? { mode: 'all' })
          }}>
            <option value="">请选择礼包或宝箱</option>
            {data.definitions.filter((item) => item.kind === 'gift_pack').map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </Field>
        <RewardListEditor id="new-version-contents" label="新版本内容" value={versionContents} definitions={data.definitions}
          versions={data.gift_pack_versions} allowGiftPacks={false} onChange={setVersionContents} />
        <OpeningRuleFields rule={versionOpeningRule} contentCount={versionContents.length} onChange={setVersionOpeningRule} />
        <div className="mt-3 flex flex-wrap gap-3">
          <button className="tool-primary-action" disabled={busy || !versionValid}>发布新版本</button>
          <button value="draft" className="tool-secondary-action" disabled={busy || !versionValid}>创建新版本草稿</button>
        </div>
      </form>
      <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto">
        {data.gift_pack_versions.length === 0 && <p className="text-sm text-ink-muted">暂无礼包版本。</p>}
        {data.gift_pack_versions.map((version) => <article className="tool-inset min-w-0 p-3" key={version.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="break-words text-sm text-ink-primary">{data.definitions.find((item) => item.code === version.item_code)?.name ?? version.item_code} · v{version.version}</strong>
            <span className="text-xs text-ink-muted">{{ draft: '草稿', published: '已发布', retired: '已退役' }[version.status]}</span>
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-ink-muted">{version.item_code}</p>
          <RewardSummary contents={version.contents} definitions={data.definitions} />
          <p className="mt-2 text-xs text-ink-secondary">
            {version.opening_rule.mode === 'all' ? '领取全部奖励' : `${version.opening_rule.mode === 'random' ? '随机获得' : '自行选择'} ${version.opening_rule.count} 项奖励，${version.opening_rule.allow_duplicates ? '可重复领取同一种' : '每种只领取一次'}`}
          </p>
          {version.status === 'draft' && <button type="button" className="tool-secondary-action mt-3" disabled={busy}
            onClick={() => void run('/api/admin/items', { action: 'publish_gift_pack_version', version_id: version.id }, '礼包版本已发布。')}>发布</button>}
          {version.status === 'published' && <button type="button" className="tool-secondary-action mt-3" disabled={busy}
            onClick={() => void run('/api/admin/items', { action: 'retire_gift_pack_version', version_id: version.id }, '礼包版本已退役。', {
              confirmation: `确认退役礼包 v${version.version}？退役后不能再用于新发放。`,
            })}>退役</button>}
        </article>)}
      </div>
    </section>
  </div>
}
