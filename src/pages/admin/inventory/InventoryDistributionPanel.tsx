import { useState } from 'react'
import type { AdminInventoryCampaign as Campaign, AdminInventoryGiftVersion } from '../../../lib/admin-inventory-contracts'
import type { ItemDefinition } from '../../../lib/inventory-contracts'
import { canIssueItem, Field, type InventoryPanelProps } from './InventoryEditors'

type ItemDraft = { itemCode: string; giftVersionId: string; quantity: number; validityDays: number }
const initialItem = (): ItemDraft => ({ itemCode: 'priority_compute_coupon', giftVersionId: '', quantity: 1, validityDays: 0 })
const CAMPAIGN_STATUS: Record<Campaign['status'], string> = {
  draft: '草稿', queued: '等待发放', running: '正在发放', paused: '已暂停', completed: '已完成',
  completed_with_failures: '部分发放失败', cancelled: '已取消', reversing: '正在撤回', reversed: '已撤回',
}

export function InventoryDistributionPanel({ data, busy, run }: InventoryPanelProps) {
  const [grant, setGrant] = useState(initialItem)
  const [campaignDraft, setCampaignDraft] = useState(initialItem)
  const [userId, setUserId] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [lastGrantId, setLastGrantId] = useState<string | null>(null)
  const [revokeGrantId, setRevokeGrantId] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [targetMode, setTargetMode] = useState<'user_ids' | 'all_users'>('user_ids')
  const [targetUsers, setTargetUsers] = useState('')
  const [campaignReason, setCampaignReason] = useState('')
  const [rootPassword, setRootPassword] = useState('')
  const userIds = [...new Set(targetUsers.split(/[\s,，]+/).filter(Boolean))]
  const recipientCount = targetMode === 'all_users' ? data.user_count : userIds.length
  const totalQuantity = Number.isInteger(campaignDraft.quantity) ? recipientCount * campaignDraft.quantity : '—'
  const validItem = (draft: ItemDraft) => {
    const item = data.definitions.find((entry) => entry.code === draft.itemCode)
    return item && canIssueItem(item, data.gift_pack_versions)
      && (!draft.giftVersionId || data.gift_pack_versions.some((version) =>
        version.id === draft.giftVersionId && version.item_code === draft.itemCode && version.status === 'published'))
      && Number.isInteger(draft.quantity) && draft.quantity >= 1 && draft.quantity <= 10000
      && Number.isInteger(draft.validityDays) && draft.validityDays >= 0 && draft.validityDays <= 3650
  }
  const grantValid = userId.trim() && grantReason.trim().length >= 2 && validItem(grant)
  const campaignValid = recipientCount > 0 && campaignReason.trim().length >= 2 && validItem(campaignDraft)
    && (targetMode === 'all_users' ? rootPassword.length > 0 : userIds.length <= 10000 && userIds.every((id) => id.length <= 128))
  const payload = (draft: ItemDraft) => ({
    item_code: draft.itemCode, quantity: draft.quantity, validity_days: draft.validityDays,
    ...(draft.giftVersionId && { gift_pack_version_id: draft.giftVersionId }),
  })

  return <div className="min-w-0 space-y-6">
    <section className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <form className="tool-panel min-w-0 p-5" onSubmit={(event) => {
        event.preventDefault()
        if (!grantValid) return
        void run<{ grant_id: string | null }>('/api/admin/inventory', {
          action: 'grant', user_id: userId.trim(), ...payload(grant), reason: grantReason.trim(),
        }, '道具已发放。', { idempotencyScope: 'grant' }).then((response) => {
          if (response?.grant_id) {
            setLastGrantId(response.grant_id)
            setRevokeGrantId(response.grant_id)
          }
        })
      }}>
        <h3 className="text-base font-semibold text-ink-primary">单用户发放</h3>
        <Field label="用户 ID">
          <input className="tool-field mt-2 min-w-0" required maxLength={128} value={userId} onChange={(event) => setUserId(event.currentTarget.value)} />
        </Field>
        <ItemFields definitions={data.definitions} versions={data.gift_pack_versions} value={grant} onChange={setGrant} />
        <Field label="发放原因">
          <input className="tool-field mt-2 min-w-0" required minLength={2} maxLength={500} value={grantReason} onChange={(event) => setGrantReason(event.currentTarget.value)} />
        </Field>
        <button className="tool-primary-action mt-4" disabled={busy || !grantValid}>发放</button>
        {lastGrantId && <p className="tool-alert tool-alert--success mt-4 break-all text-xs" role="status">
          最近发放批次 ID：{lastGrantId}（已自动填入撤回表单）
        </p>}
      </form>
      <form className="tool-panel min-w-0 p-5" onSubmit={(event) => {
        event.preventDefault()
        if (!revokeGrantId.trim() || revokeReason.trim().length < 2) return
        void run('/api/admin/inventory', { action: 'revoke_grant', grant_id: revokeGrantId.trim(), reason: revokeReason.trim() },
          '尚未消费的余额已撤回。', { confirmation: `确认撤回批次 ${revokeGrantId.trim()} 的全部未消费余额？已消费资产不会恢复。` })
      }}>
        <h3 className="text-base font-semibold text-ink-primary">撤回发放批次</h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">只撤回该批次尚未消费的数量，不影响已消费道具、已开启礼包或永久档案权益。</p>
        <Field label="发放批次 ID">
          <input className="tool-field mt-2 min-w-0" required maxLength={128} value={revokeGrantId} onChange={(event) => setRevokeGrantId(event.currentTarget.value)} />
        </Field>
        <Field label="撤回原因">
          <input className="tool-field mt-2 min-w-0" required minLength={2} maxLength={500} value={revokeReason} onChange={(event) => setRevokeReason(event.currentTarget.value)} />
        </Field>
        <button className="tool-secondary-action mt-4" disabled={busy || !revokeGrantId.trim() || revokeReason.trim().length < 2}>撤回余额</button>
      </form>
    </section>

    <form className="tool-panel min-w-0 p-5 sm:p-6" onSubmit={(event) => {
      event.preventDefault()
      if (!campaignValid) return
      void run('/api/admin/inventory', {
        action: 'create_campaign', ...payload(campaignDraft), target_mode: targetMode,
        ...(targetMode === 'user_ids' ? { user_ids: userIds } : { root_password: rootPassword, confirmation: 'DISTRIBUTE TO ALL USERS' }),
        reason: campaignReason.trim(),
      }, '发放任务已创建，系统正在处理。', {
        idempotencyScope: 'create_campaign',
        confirmation: `确认向 ${recipientCount} 位用户各发放 ${campaignDraft.quantity} 个道具，共 ${recipientCount * campaignDraft.quantity} 个？`,
      }).then((response) => { if (response !== null) setRootPassword('') })
    }}>
      <h3 className="text-base font-semibold text-ink-primary">批量与全站发放</h3>
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <Field label="目标模式">
            <select className="tool-field mt-2 min-w-0" value={targetMode} onChange={(event) => {
              setTargetMode(event.currentTarget.value as typeof targetMode)
              setRootPassword('')
            }}>
              <option value="user_ids">指定用户 ID</option><option value="all_users">全站用户快照</option>
            </select>
          </Field>
          {targetMode === 'user_ids' ? <Field label="用户 ID（逗号、空格或换行分隔）">
            <textarea className="tool-field mt-2 min-h-28 min-w-0" required value={targetUsers} onChange={(event) => setTargetUsers(event.currentTarget.value)} />
          </Field> : <Field label="Root 口令">
            <input type="password" className="tool-field mt-2 min-w-0" required autoComplete="off" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} />
          </Field>}
        </div>
        <div className="min-w-0">
          <ItemFields definitions={data.definitions} versions={data.gift_pack_versions} value={campaignDraft} onChange={setCampaignDraft} />
          <Field label="管理员备注">
            <input className="tool-field mt-2 min-w-0" required minLength={2} maxLength={500} value={campaignReason} onChange={(event) => setCampaignReason(event.currentTarget.value)} />
          </Field>
        </div>
      </div>
      <div className="tool-alert mt-4">
        预计用户数：{recipientCount}；预计道具总量：{totalQuantity}。提交时会固定目标用户集合；之后注册的用户不会被包含。
      </div>
      <button className="tool-primary-action mt-4" disabled={busy || !campaignValid}>创建发放活动</button>
    </form>

    <section className="tool-panel min-w-0 p-5 sm:p-6">
      <h3 className="text-base font-semibold text-ink-primary">发放活动</h3>
      {data.campaigns.length === 0 && <p className="mt-4 text-sm text-ink-muted">暂无发放活动。</p>}
      <div className="mt-4 space-y-3">
        {data.campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} data={data} busy={busy} run={run} />)}
      </div>
    </section>
  </div>
}

function ItemFields({ definitions, versions, value, onChange }: {
  definitions: ItemDefinition[]
  versions: AdminInventoryGiftVersion[]
  value: ItemDraft
  onChange: (value: ItemDraft) => void
}) {
  const candidates = definitions.filter((item) => canIssueItem(item, versions))
  const selected = candidates.find((item) => item.code === value.itemCode)
  const published = versions.filter((version) => version.item_code === value.itemCode && version.status === 'published')
    .sort((left, right) => right.version - left.version)
  return <>
    <Field label="道具">
      <select className="tool-field mt-2 min-w-0" required value={selected ? value.itemCode : ''}
        onChange={(event) => onChange({ ...value, itemCode: event.currentTarget.value, giftVersionId: '' })}>
        <option value="">请选择可发放道具</option>
        {candidates.map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}
      </select>
    </Field>
    {selected?.kind === 'gift_pack' && <Field label="礼包版本">
      <select className="tool-field mt-2 min-w-0" value={value.giftVersionId} onChange={(event) => onChange({ ...value, giftVersionId: event.currentTarget.value })}>
        <option value="">自动使用最新已发布版本{published[0] ? `（v${published[0].version}）` : ''}</option>
        {published.map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}
      </select>
    </Field>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Field label="数量">
        <input type="number" required min={1} max={10000} step={1} className="tool-field mt-2 min-w-0" value={Number.isNaN(value.quantity) ? '' : value.quantity}
          onChange={(event) => onChange({ ...value, quantity: event.currentTarget.valueAsNumber })} />
      </Field>
      <Field label="有效天数（0 永久）">
        <input type="number" required min={0} max={3650} step={1} className="tool-field mt-2 min-w-0" value={Number.isNaN(value.validityDays) ? '' : value.validityDays}
          onChange={(event) => onChange({ ...value, validityDays: event.currentTarget.valueAsNumber })} />
      </Field>
    </div>
  </>
}

function CampaignCard({ campaign, data, busy, run }: InventoryPanelProps & { campaign: Campaign }) {
  const [rootPassword, setRootPassword] = useState('')
  const completed = campaign.status === 'completed' || campaign.status === 'completed_with_failures'
  const requiresRoot = campaign.target_mode === 'all_users'
  const action = (operation: 'pause' | 'resume' | 'cancel' | 'reverse', label: string) =>
    void run('/api/admin/inventory', {
      action: `${operation}_campaign`, campaign_id: campaign.id, reason: `管理员${label}`,
      ...(operation === 'reverse' && requiresRoot && { root_password: rootPassword }),
    }, `活动已${label}。`, {
      confirmation: operation === 'resume' ? undefined
        : `确认对活动 ${campaign.id} 执行“${label}”？目标 ${campaign.recipient_count} 人，当前成功 ${campaign.granted_count} 人。`,
    }).then((response) => { if (response !== null) setRootPassword('') })

  return <article className="tool-inset min-w-0 p-4">
    <div className="flex flex-wrap justify-between gap-2">
      <span className="break-all font-mono text-xs">{campaign.id}</span>
      <strong className="text-sm">{CAMPAIGN_STATUS[campaign.status]}</strong>
    </div>
    <p className="mt-2 break-words text-xs leading-5 text-ink-secondary">
      {data.definitions.find((item) => item.code === campaign.item_code)?.name ?? campaign.item_code} · 目标 {campaign.recipient_count} · 成功 {campaign.granted_count} · 失败 {campaign.failed_count} · 待处理 {campaign.pending_count} · 处理中 {campaign.processing_count} · 跳过 {campaign.skipped_count} · 已撤回 {campaign.revoked_count}
    </p>
    {campaign.failed_recipients.length > 0 && <details className="mt-3 text-xs text-ink-secondary">
      <summary className="cursor-pointer font-medium text-warning-700">查看失败收件人与原因</summary>
      <ul className="mt-2 space-y-2">{campaign.failed_recipients.map((recipient) => <li key={recipient.user_id} className="break-words rounded-lg border border-surface-3 p-2">
        <span className="break-all font-mono">{recipient.user_id}</span> · 已尝试 {recipient.attempt_count} 次 · {recipient.error_message ?? '未知错误'}
      </li>)}</ul>
      <button type="button" className="tool-secondary-action mt-2" onClick={() => downloadCampaignFailures(campaign)}>导出失败 CSV</button>
    </details>}
    {requiresRoot && completed && <Field label="全站撤回 Root 口令">
      <input type="password" className="tool-field mt-2 min-w-0" autoComplete="off" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} />
    </Field>}
    <div className="mt-3 flex flex-wrap gap-2">
      {(campaign.status === 'queued' || campaign.status === 'running') && <>
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => action('pause', '暂停')}>暂停</button>
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => action('cancel', '取消')}>取消</button>
      </>}
      {campaign.status === 'paused' && <>
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => action('resume', '恢复')}>恢复</button>
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => action('cancel', '取消')}>取消</button>
      </>}
      {campaign.status === 'completed_with_failures' && <button type="button" className="tool-secondary-action" disabled={busy} onClick={() =>
        void run('/api/admin/inventory', { action: 'retry_campaign_failures', campaign_id: campaign.id, reason: '管理员重试失败收件人' },
          '失败记录已重新提交处理。', { confirmation: `确认重试活动 ${campaign.id} 的 ${campaign.failed_count} 个失败收件人？` })}>重试失败收件人</button>}
      {completed && <button type="button" className="tool-secondary-action" disabled={busy || (requiresRoot && !rootPassword)}
        onClick={() => action('reverse', '撤回未消费余额')}>撤回未消费余额</button>}
    </div>
  </article>
}

function downloadCampaignFailures(campaign: Campaign): void {
  const rows = [
    ['user_id', 'attempt_count', 'processed_at', 'error_message'],
    ...campaign.failed_recipients.map((recipient) => [
      recipient.user_id, String(recipient.attempt_count), recipient.processed_at ?? '', recipient.error_message ?? '',
    ]),
  ]
  const csv = rows.map((row) => row.map((value) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return `"${safe.replace(/"/g, '""')}"`
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `inventory-campaign-${campaign.id}-failures.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
