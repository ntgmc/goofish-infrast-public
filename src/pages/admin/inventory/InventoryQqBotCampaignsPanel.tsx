import { useId, useState } from 'react'
import { qqBotCampaignInputSchema } from '../../../lib/qqbot-reward-contracts'
import { canIssueItem, Field, type InventoryPanelProps } from './InventoryEditors'

export function InventoryQqBotCampaignsPanel({ data, busy, run }: InventoryPanelProps) {
  const itemFieldId = useId()
  const [groupId, setGroupId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [validityDays, setValidityDays] = useState(30)
  const [joinDays, setJoinDays] = useState(0)
  const [joinedBefore, setJoinedBefore] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const candidates = data.definitions.filter((item) => canIssueItem(item, data.gift_pack_versions))
  const date = (value: string) => value ? new Date(`${value}T00:00:00+08:00`).toISOString() : null
  const input = qqBotCampaignInputSchema.safeParse({
    group_id: groupId.trim(), campaign_id: campaignId.trim(), item_code: itemCode,
    quantity, validity_days: validityDays, min_join_days: joinDays,
    joined_before: date(joinedBefore), ends_at: date(endsAt),
  })
  const valid = input.success && candidates.some((item) => item.code === itemCode)
    && (!input.data.ends_at || Date.parse(input.data.ends_at) > Date.now())

  return <div className="min-w-0 space-y-6">
    <form className="tool-panel min-w-0 p-5 sm:p-6" onSubmit={(event) => {
      event.preventDefault()
      if (!valid || !input.success) return
      void run('/api/admin/inventory', { action: 'create_qqbot_campaign', ...input.data },
        '群活动已创建，成员可在对应 QQ 群领取。', { idempotencyScope: 'create_qqbot_campaign' })
    }}>
      <h3 className="text-base font-semibold text-ink-primary">创建 QQ 群活动</h3>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">成员在指定群发送领取命令，每人限领一次。群号须已配置为 Bot 网站通知群。</p>
      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="QQ 群号"><input className="tool-field mt-2 min-w-0" required inputMode="numeric" maxLength={20} pattern="[1-9][0-9]*" value={groupId} onChange={(event) => setGroupId(event.currentTarget.value)} /></Field>
        <div className="min-w-0"><Field label="活动编号"><input className="tool-field mt-2 min-w-0" required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" placeholder="welcome7" value={campaignId} onChange={(event) => setCampaignId(event.currentTarget.value)} /></Field><p className="mt-1 text-xs text-ink-muted">英文字母、数字、下划线或短横线；同群内不可重复。</p></div>
        <div className="min-w-0"><label htmlFor={itemFieldId} className="mt-3 block text-sm font-medium text-ink-secondary">奖励道具</label><select id={itemFieldId} className="tool-field mt-2 min-w-0" required value={itemCode} onChange={(event) => setItemCode(event.currentTarget.value)}>
          <option value="">请选择可发放道具</option>{candidates.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>{data.definitions.find((item) => item.code === itemCode)?.kind === 'gift_pack' && <p className="mt-1 text-xs text-ink-muted">创建时固定最新已发布礼包版本。</p>}</div>
        <Field label="每人数量"><input type="number" className="tool-field mt-2 min-w-0" required min={1} max={10000} step={1} value={Number.isNaN(quantity) ? '' : quantity} onChange={(event) => setQuantity(event.currentTarget.valueAsNumber)} /></Field>
        <Field label="到账后有效天数（0 永久）"><input type="number" className="tool-field mt-2 min-w-0" required min={0} max={3650} step={1} value={Number.isNaN(validityDays) ? '' : validityDays} onChange={(event) => setValidityDays(event.currentTarget.valueAsNumber)} /></Field>
        <Field label="入群满多少天（0 不限）"><input type="number" className="tool-field mt-2 min-w-0" required min={0} max={36500} step={1} value={Number.isNaN(joinDays) ? '' : joinDays} onChange={(event) => setJoinDays(event.currentTarget.valueAsNumber)} /></Field>
        <Field label="入群早于日期（可选）"><input type="date" className="tool-field mt-2 min-w-0" value={joinedBefore} onChange={(event) => setJoinedBefore(event.currentTarget.value)} /></Field>
        <Field label="结束日期（可选）"><input type="date" className="tool-field mt-2 min-w-0" value={endsAt} onChange={(event) => setEndsAt(event.currentTarget.value)} /></Field>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink-secondary">入群条件须同时满足；天数按满 24 小时计算，日期按北京时间当天 00:00 截止。未绑定奖励由 Bot 保留，绑定后自动补发。</p>
      <button className="tool-primary-action mt-4" disabled={busy || !valid}>创建群活动</button>
    </form>
    <section className="tool-panel min-w-0 p-5 sm:p-6">
      <h3 className="text-base font-semibold text-ink-primary">最近群活动</h3>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">创建后可开启或停用。更换奖励或条件时使用新编号；停用不会取消已领取的待发奖励。</p>
      {data.qqbot_campaigns.length === 0 && <p className="mt-4 text-sm text-ink-muted">暂无群活动。</p>}
      <div className="mt-4 space-y-4">{data.qqbot_campaigns.map((campaign) => {
        const ended = campaign.ends_at !== null && Date.parse(campaign.ends_at) <= Date.now()
        const label = campaign.enabled ? '停用' : '开启'
        const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
        return <article key={`${campaign.group_id}:${campaign.campaign_id}`} className="tool-inset min-w-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
            <h4 className="break-all font-semibold text-ink-primary">{campaign.campaign_id}</h4><p className="mt-1 break-all text-xs text-ink-muted">QQ 群 {campaign.group_id} · {ended ? '已结束' : campaign.enabled ? '已开启' : '已停用'}</p>
          </div><button type="button" className="tool-secondary-action" disabled={busy || (ended && !campaign.enabled)} onClick={() => void run('/api/admin/inventory', {
            action: 'set_qqbot_campaign_status', group_id: campaign.group_id, campaign_id: campaign.campaign_id,
            enabled: !campaign.enabled, expected_revision: campaign.revision,
          }, `群活动已${label}。`)}>{label}</button></div>
          <p className="mt-3 break-words text-sm text-ink-secondary">{data.definitions.find((item) => item.code === campaign.item_code)?.name ?? campaign.item_code} × {campaign.quantity} · {campaign.validity_days ? `到账后 ${campaign.validity_days} 天有效` : '永久有效'}</p>
          <p className="mt-2 text-xs leading-6 text-ink-secondary">{campaign.min_join_days ? `入群满 ${campaign.min_join_days} 天` : '入群天数不限'}{campaign.joined_before && ` · 入群早于 ${timestamp(campaign.joined_before)}`}{campaign.ends_at && ` · 结束于 ${timestamp(campaign.ends_at)}`}（北京时间）</p>
          <p className="mt-2 break-all text-sm text-ink-primary">领取命令：<code>领取网站活动 {campaign.campaign_id}</code></p>
        </article>
      })}</div>
    </section>
  </div>
}
