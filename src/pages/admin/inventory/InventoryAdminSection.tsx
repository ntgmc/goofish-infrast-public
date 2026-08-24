import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import {
  adminInventoryOverviewSchema,
  type AdminInventoryCampaign as Campaign,
  type AdminInventoryGiftVersion as GiftVersion,
  type AdminInventoryOverview as Overview,
} from '../../../lib/admin-inventory-contracts'
import { itemIconPath } from '../../../lib/inventory-contracts'
import type { ExpiryPolicy, GiftPackContentInput, ItemDefinition, OnboardingTaskCode } from '../../../lib/inventory-contracts'
import { AdminToast } from '../shared/AdminToast'

type AdminTab = 'catalog' | 'packs' | 'onboarding' | 'distribution' | 'audit'
type TaskDraft = { enabled: boolean; rewards: GiftPackContentInput[] }

const DEFAULT_CONTENTS: GiftPackContentInput[] = [
  { item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } },
]

const ADMIN_TABS: Array<{ id: AdminTab; label: string; description: string }> = [
  { id: 'catalog', label: '道具目录', description: '维护系统道具的展示信息和发放状态' },
  { id: 'packs', label: '礼包管理', description: '创建礼包并管理不可变内容版本' },
  { id: 'onboarding', label: '新人任务', description: '配置三项固定引导任务及奖励' },
  { id: 'distribution', label: '发放中心', description: '单用户、批量发放与批次撤回' },
  { id: 'audit', label: '操作审计', description: '查看最近的后台道具操作' },
]

const TASK_LABELS: Record<OnboardingTaskCode, string> = {
  welcome_inventory: '认识网站',
  bind_skland: '绑定森空岛',
  first_main_schedule: '首次主排班',
}

function initialContents(): GiftPackContentInput[] {
  return DEFAULT_CONTENTS.map((entry) => ({ ...entry, expiry: { ...entry.expiry } }))
}

export default function InventoryAdminSection() {
  const [data, setData] = useState<Overview | null>(null)
  const [activeTab, setActiveTab] = useState<AdminTab>('catalog')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [giftName, setGiftName] = useState('')
  const [giftDescription, setGiftDescription] = useState('')
  const [contents, setContents] = useState<GiftPackContentInput[]>(initialContents)
  const [taskCode, setTaskCode] = useState<OnboardingTaskCode>('welcome_inventory')
  const [taskDrafts, setTaskDrafts] = useState<Partial<Record<OnboardingTaskCode, TaskDraft>>>({})
  const [itemCode, setItemCode] = useState('priority_compute_coupon')
  const [giftVersionId, setGiftVersionId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [validityDays, setValidityDays] = useState(0)
  const [reason, setReason] = useState('')
  const [userId, setUserId] = useState('')
  const [revokeGrantId, setRevokeGrantId] = useState('')
  const [targetMode, setTargetMode] = useState<'user_ids' | 'all_users'>('user_ids')
  const [targetUsers, setTargetUsers] = useState('')
  const [rootPassword, setRootPassword] = useState('')
  const [editItemCode, setEditItemCode] = useState('priority_compute_coupon')
  const [editItemName, setEditItemName] = useState('')
  const [editItemDescription, setEditItemDescription] = useState('')
  const [editItemIssuance, setEditItemIssuance] = useState(true)
  const [versionItemCode, setVersionItemCode] = useState('')
  const [versionContents, setVersionContents] = useState<GiftPackContentInput[]>(initialContents)
  const [lastGrantId, setLastGrantId] = useState<string | null>(null)
  const pendingIdempotencyRef = useRef(new Map<string, { requestJson: string; key: string }>())

  const load = useCallback(async () => {
    setError(null)
    try { setData(adminInventoryOverviewSchema.parse(await adminApiJson<unknown>('/api/admin/items'))) }
    catch (caught) { setError((caught as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const item = data?.definitions.find((entry) => entry.code === editItemCode)
    if (!item) return
    setEditItemName(item.name)
    setEditItemDescription(item.description)
    setEditItemIssuance(item.issuance_enabled)
  }, [data, editItemCode])

  useEffect(() => {
    if (!data) return
    setTaskDrafts((current) => {
      const next = { ...current }
      for (const task of data.tasks) {
        next[task.task_code] ??= {
          enabled: task.enabled,
          rewards: task.rewards_json.map((reward) => ({ ...reward, expiry: { ...reward.expiry } })),
        }
      }
      return next
    })
  }, [data])

  const run = async <T = unknown>(
    url: string,
    json: Record<string, unknown>,
    success: string,
    options: { idempotencyScope?: string; confirmation?: string } = {},
  ): Promise<T | null> => {
    if (options.confirmation && !window.confirm(options.confirmation)) return null
    const requestJson = JSON.stringify(json)
    const pending = options.idempotencyScope
      ? pendingIdempotencyRef.current.get(options.idempotencyScope)
      : null
    const idempotencyKey = options.idempotencyScope
      ? pending?.requestJson === requestJson ? pending.key : crypto.randomUUID()
      : null
    if (options.idempotencyScope && idempotencyKey) {
      pendingIdempotencyRef.current.set(options.idempotencyScope, { requestJson, key: idempotencyKey })
    }
    const request = idempotencyKey ? { ...json, idempotency_key: idempotencyKey } : json
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await adminApiJson<T>(url, { method: 'POST', json: request })
      if (options.idempotencyScope) pendingIdempotencyRef.current.delete(options.idempotencyScope)
      setNotice(success)
      await load()
      return response
    } catch (caught) {
      setError((caught as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const publishedVersions = useMemo(
    () => data?.gift_pack_versions.filter((version) => version.status === 'published') ?? [],
    [data],
  )
  const selectedItem = data?.definitions.find((item) => item.code === itemCode)
  const userIds = [...new Set(targetUsers.split(/[\s,]+/).filter(Boolean))]
  const selectedTask = data?.tasks.find((task) => task.task_code === taskCode)
  const selectedTaskDraft = taskDrafts[taskCode] ?? {
    enabled: selectedTask?.enabled ?? false,
    rewards: selectedTask?.rewards_json ?? [],
  }

  if (!data) return <div className="tool-panel p-6 text-sm text-ink-secondary" role={error ? 'alert' : 'status'}>
    <p>{error ?? '正在加载道具管理…'}</p>
    {error && <button type="button" className="tool-secondary-action mt-4" onClick={() => void load()}>重试加载</button>}
  </div>

  return (
    <div className="space-y-6">
      <section className="tool-panel p-5 sm:p-6">
        <p className="tool-eyebrow">统一道具系统</p>
        <h2 className="mt-2 text-xl font-semibold text-ink-primary">道具与礼包</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-ink-secondary">系统效果代码不可编辑；礼包和新人任务发布后形成不可变版本。图标目前全部使用受控占位图，后续只需替换图标键映射。</p>
        {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
        {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}
      </section>

      <nav className="tool-panel overflow-x-auto p-2" aria-label="道具与礼包管理分区">
        <div className="flex min-w-max gap-2" role="tablist">
          {ADMIN_TABS.map((tab) => <button
            key={tab.id}
            id={`inventory-admin-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`inventory-admin-panel-${tab.id}`}
            className={`min-w-32 rounded-xl px-4 py-3 text-left transition ${activeTab === tab.id ? 'bg-accent-500 text-white shadow-sm' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span aria-hidden="true" className={`mt-1 hidden text-xs sm:block ${activeTab === tab.id ? 'text-white/80' : 'text-ink-muted'}`}>{tab.description}</span>
          </button>)}
        </div>
      </nav>

      {activeTab === 'catalog' && <section id="inventory-admin-panel-catalog" role="tabpanel" aria-labelledby="inventory-admin-tab-catalog" className="tool-panel overflow-hidden p-5 sm:p-6">
        <h3 className="text-base font-semibold text-ink-primary">道具目录</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-ink-muted"><tr><th className="p-2">代码</th><th className="p-2">名称</th><th className="p-2">类型</th><th className="p-2">效果</th><th className="p-2">发放状态</th></tr></thead>
            <tbody>{data.definitions.map((item) => <tr key={item.code} className="border-t border-surface-3"><td className="p-2 font-mono text-xs">{item.code}</td><td className="p-2">{item.name}</td><td className="p-2">{item.kind}</td><td className="p-2 font-mono text-xs">{item.effect_code}</td><td className="p-2">{item.issuance_enabled ? '允许' : '停用'}</td></tr>)}</tbody>
          </table>
        </div>
        <form className="mt-5 grid gap-3 border-t border-surface-3 pt-5 lg:grid-cols-2" onSubmit={(event) => {
          event.preventDefault()
          void run('/api/admin/items', {
            action: 'update_item', item_code: editItemCode, name: editItemName,
            description: editItemDescription, issuance_enabled: editItemIssuance,
          }, '道具展示信息已更新。')
        }}>
          <Field label="编辑道具"><select className="tool-field mt-2 w-full" value={editItemCode} onChange={(event) => setEditItemCode(event.currentTarget.value)}>{data.definitions.map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select></Field>
          <Field label="名称"><input className="tool-field mt-2 w-full" value={editItemName} onChange={(event) => setEditItemName(event.currentTarget.value)} /></Field>
          <Field label="说明"><textarea className="tool-field mt-2 min-h-20 w-full" value={editItemDescription} onChange={(event) => setEditItemDescription(event.currentTarget.value)} /></Field>
          <div className="flex flex-col justify-between gap-3">
            <p className="mt-3 text-xs text-ink-muted">图标键：{data.definitions.find((item) => item.code === editItemCode)?.icon_key ?? 'placeholder'}（当前所有键映射到同一占位图）</p>
            <label className="flex items-center gap-2 text-sm text-ink-secondary"><input type="checkbox" checked={editItemIssuance} onChange={(event) => setEditItemIssuance(event.currentTarget.checked)} />允许新发放</label>
            <button className="tool-secondary-action" disabled={busy}>保存目录展示信息</button>
          </div>
        </form>
      </section>}

      {activeTab === 'packs' && <section id="inventory-admin-panel-packs" role="tabpanel" aria-labelledby="inventory-admin-tab-packs" className="grid gap-5 xl:grid-cols-2">
        <form className="tool-panel p-5" onSubmit={(event) => {
          event.preventDefault()
          void run('/api/admin/items', {
            action: 'create_gift_pack', name: giftName, description: giftDescription,
            icon_key: 'generic_gift_pack', contents,
          }, '礼包草稿已创建。', { idempotencyScope: 'create_gift_pack' })
        }}>
          <h3 className="text-base font-semibold text-ink-primary">创建自定义礼包</h3>
          <Field label="礼包名称"><input className="tool-field mt-2 w-full" value={giftName} onChange={(event) => setGiftName(event.currentTarget.value)} /></Field>
          <Field label="说明"><textarea className="tool-field mt-2 min-h-20 w-full" value={giftDescription} onChange={(event) => setGiftDescription(event.currentTarget.value)} /></Field>
          <RewardListEditor id="new-pack-contents" label="礼包内容" value={contents} definitions={data.definitions} versions={data.gift_pack_versions} allowGiftPacks={false} onChange={setContents} />
          <button className="tool-primary-action mt-4" disabled={busy || contents.length === 0}>创建草稿</button>
        </form>

        <div className="tool-panel p-5">
          <h3 className="text-base font-semibold text-ink-primary">礼包版本</h3>
          <form className="mt-4 border-b border-surface-3 pb-4" onSubmit={(event) => {
            event.preventDefault()
            void run('/api/admin/items', { action: 'create_gift_pack_version', item_code: versionItemCode, contents: versionContents }, '礼包新版本草稿已创建。', { idempotencyScope: 'create_gift_pack_version' })
          }}>
            <Field label="基于礼包创建新版本"><select className="tool-field mt-2 w-full" value={versionItemCode} onChange={(event) => setVersionItemCode(event.currentTarget.value)}><option value="">请选择礼包</option>{data.definitions.filter((item) => item.kind === 'gift_pack').map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select></Field>
            <RewardListEditor id="new-version-contents" label="新版本内容" value={versionContents} definitions={data.definitions} versions={data.gift_pack_versions} allowGiftPacks={false} onChange={setVersionContents} />
            <button className="tool-secondary-action mt-3" disabled={busy || !versionItemCode || versionContents.length === 0}>创建新版本草稿</button>
          </form>
          <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto">
            {data.gift_pack_versions.map((version) => <article className="tool-inset p-3" key={version.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-ink-primary">{data.definitions.find((item) => item.code === version.item_code)?.name ?? version.item_code} · v{version.version}</strong><span className="text-xs text-ink-muted">{giftVersionStatusLabel(version.status)}</span></div>
              <p className="mt-1 break-all font-mono text-[11px] text-ink-muted">{version.item_code}</p>
              <RewardSummary contents={version.contents} definitions={data.definitions} />
              {version.status === 'draft' && <button type="button" className="tool-secondary-action mt-3" disabled={busy} onClick={() => void run('/api/admin/items', { action: 'publish_gift_pack_version', version_id: version.id }, '礼包版本已发布。')}>发布</button>}
              {version.status === 'published' && <button type="button" className="tool-secondary-action mt-3" disabled={busy} onClick={() => void run('/api/admin/items', { action: 'retire_gift_pack_version', version_id: version.id }, '礼包版本已退役。')}>退役</button>}
            </article>)}
          </div>
        </div>
      </section>}

      {activeTab === 'onboarding' && <form id="inventory-admin-panel-onboarding" role="tabpanel" aria-labelledby="inventory-admin-tab-onboarding" className="tool-panel p-5 sm:p-6" onSubmit={(event) => {
        event.preventDefault()
        void run('/api/admin/items', { action: 'configure_onboarding_task', task_code: taskCode, enabled: selectedTaskDraft.enabled, rewards: selectedTaskDraft.rewards }, '新人任务配置版本已发布。')
      }}>
        <h3 className="text-base font-semibold text-ink-primary">固定新人任务</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-[240px_auto]">
          <div>
            <Field label="任务"><select className="tool-field mt-2 w-full" value={taskCode} onChange={(event) => setTaskCode(event.currentTarget.value as OnboardingTaskCode)}>{Object.entries(TASK_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></Field>
            <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedTaskDraft.enabled} onChange={(event) => {
              const enabled = event.currentTarget.checked
              setTaskDrafts((current) => ({ ...current, [taskCode]: { enabled, rewards: current[taskCode]?.rewards ?? selectedTaskDraft.rewards } }))
            }} />新版本启用</label>
            <p className="mt-3 text-xs text-ink-muted">当前 v{selectedTask?.version ?? '—'} {selectedTask?.enabled ? '已启用' : '已停用'}。启用新版本前必须配置奖励。</p>
          </div>
          <RewardListEditor
            id={`task-rewards-${taskCode}`}
            label={`${TASK_LABELS[taskCode]}奖励`}
            value={selectedTaskDraft.rewards}
            definitions={data.definitions}
            versions={data.gift_pack_versions}
            allowGiftPacks
            onChange={(rewards) => setTaskDrafts((current) => ({ ...current, [taskCode]: { enabled: current[taskCode]?.enabled ?? selectedTaskDraft.enabled, rewards } }))}
          />
        </div>
        <button className="tool-primary-action mt-4" disabled={busy || selectedTaskDraft.rewards.length === 0}>{selectedTaskDraft.enabled ? '发布并启用' : '发布停用版本'}</button>
      </form>}

      {activeTab === 'distribution' && <div id="inventory-admin-panel-distribution" role="tabpanel" aria-labelledby="inventory-admin-tab-distribution" className="space-y-6">
      <section className="grid gap-5 xl:grid-cols-2">
        <form className="tool-panel p-5" onSubmit={(event) => { event.preventDefault(); void (async () => {
          const response = await run<{ grant_id: string | null }>('/api/admin/inventory', {
            action: 'grant', user_id: userId, item_code: itemCode, quantity, validity_days: validityDays,
            ...(giftVersionId && { gift_pack_version_id: giftVersionId }), reason,
          }, '道具已发放。', { idempotencyScope: 'grant' })
          if (response?.grant_id) {
            setLastGrantId(response.grant_id)
            setRevokeGrantId(response.grant_id)
          }
        })() }}>
          <h3 className="text-base font-semibold text-ink-primary">单用户发放</h3>
          <Field label="用户 ID"><input className="tool-field mt-2 w-full" value={userId} onChange={(event) => setUserId(event.currentTarget.value)} /></Field>
          <ItemFields definitions={data.definitions} versions={publishedVersions} itemCode={itemCode} setItemCode={setItemCode} giftVersionId={giftVersionId} setGiftVersionId={setGiftVersionId} quantity={quantity} setQuantity={setQuantity} validityDays={validityDays} setValidityDays={setValidityDays} />
          <Field label="发放原因"><input className="tool-field mt-2 w-full" value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></Field>
          <button className="tool-primary-action mt-4" disabled={busy || reason.trim().length < 2}>发放</button>
          {lastGrantId && <p className="tool-alert tool-alert--success mt-4 break-all text-xs" role="status">最近发放批次 ID：{lastGrantId}（已自动填入撤回表单）</p>}
        </form>
        <form className="tool-panel p-5" onSubmit={(event) => { event.preventDefault(); void run('/api/admin/inventory', { action: 'revoke_grant', grant_id: revokeGrantId, reason }, '尚未消费的余额已撤回。', { confirmation: `确认撤回批次 ${revokeGrantId} 的全部未消费余额？已消费资产不会恢复。` }) }}>
          <h3 className="text-base font-semibold text-ink-primary">撤回发放批次</h3>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">只撤回该批次尚未消费的数量，不影响已消费道具、已开启礼包或永久档案权益。</p>
          <Field label="发放批次 ID"><input className="tool-field mt-2 w-full" value={revokeGrantId} onChange={(event) => setRevokeGrantId(event.currentTarget.value)} /></Field>
          <button className="tool-secondary-action mt-4" disabled={busy || reason.trim().length < 2}>撤回余额</button>
        </form>
      </section>

      <form className="tool-panel p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); void run('/api/admin/inventory', {
        action: 'create_campaign', item_code: itemCode, quantity, validity_days: validityDays, target_mode: targetMode,
        ...(giftVersionId && { gift_pack_version_id: giftVersionId }),
        ...(targetMode === 'user_ids' ? { user_ids: userIds } : { root_password: rootPassword, confirmation: 'DISTRIBUTE TO ALL USERS' }), reason,
      }, '发放活动已进入队列。', { idempotencyScope: 'create_campaign' }) }}>
        <h3 className="text-base font-semibold text-ink-primary">批量与全站发放</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <Field label="目标模式"><select className="tool-field mt-2 w-full" value={targetMode} onChange={(event) => setTargetMode(event.currentTarget.value as typeof targetMode)}><option value="user_ids">指定用户 ID</option><option value="all_users">全站用户快照</option></select></Field>
            {targetMode === 'user_ids' ? <Field label="用户 ID（逗号、空格或换行分隔）"><textarea className="tool-field mt-2 min-h-28 w-full" value={targetUsers} onChange={(event) => setTargetUsers(event.currentTarget.value)} /></Field> : <Field label="Root 口令"><input type="password" className="tool-field mt-2 w-full" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} /></Field>}
          </div>
          <div><ItemFields definitions={data.definitions} versions={publishedVersions} itemCode={itemCode} setItemCode={setItemCode} giftVersionId={giftVersionId} setGiftVersionId={setGiftVersionId} quantity={quantity} setQuantity={setQuantity} validityDays={validityDays} setValidityDays={setValidityDays} /><Field label="管理员备注"><input className="tool-field mt-2 w-full" value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></Field></div>
        </div>
        <div className="tool-alert mt-4">预计用户数：{targetMode === 'all_users' ? data.user_count : userIds.length}；预计道具总量：{(targetMode === 'all_users' ? data.user_count : userIds.length) * quantity}。提交时会固定目标用户集合；之后注册的用户不会被包含。{selectedItem?.kind === 'gift_pack' ? '当前礼包必须选择已发布版本。' : ''}</div>
        <button className="tool-primary-action mt-4" disabled={busy || reason.trim().length < 2}>创建发放活动</button>
      </form>

      <section className="tool-panel p-5 sm:p-6">
        <h3 className="text-base font-semibold text-ink-primary">发放活动</h3>
        <div className="mt-4 space-y-3">{data.campaigns.map((campaign) => <article key={campaign.id} className="tool-inset p-4">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-xs">{campaign.id}</span><strong className="text-sm">{campaign.status}</strong></div>
          <p className="mt-2 text-xs text-ink-secondary">{campaign.item_code} · 目标 {campaign.recipient_count} · 成功 {campaign.granted_count} · 失败 {campaign.failed_count} · 待处理 {campaign.pending_count} · 处理中 {campaign.processing_count} · 跳过 {campaign.skipped_count} · 已撤回 {campaign.revoked_count}</p>
          {campaign.failed_recipients.length > 0 && <details className="mt-3 text-xs text-ink-secondary">
            <summary className="cursor-pointer font-medium text-warning-700">查看失败收件人与原因</summary>
            <ul className="mt-2 space-y-2">{campaign.failed_recipients.map((recipient) => <li key={recipient.user_id} className="rounded-lg border border-surface-3 p-2">
              <span className="font-mono">{recipient.user_id}</span> · 已尝试 {recipient.attempt_count} 次 · {recipient.error_message ?? '未知错误'}
            </li>)}</ul>
            <button type="button" className="tool-secondary-action mt-2" onClick={() => downloadCampaignFailures(campaign)}>导出失败 CSV</button>
          </details>}
          {campaign.target_mode === 'all_users' && (campaign.status === 'completed' || campaign.status === 'completed_with_failures') && <Field label="全站撤回 Root 口令"><input type="password" className="tool-field mt-2 w-full" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} /></Field>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(campaign.status === 'queued' || campaign.status === 'running') && <><CampaignAction action="pause_campaign" label="暂停" campaign={campaign} run={run} rootPassword={rootPassword} /><CampaignAction action="cancel_campaign" label="取消" campaign={campaign} run={run} rootPassword={rootPassword} /></>}
            {campaign.status === 'paused' && <CampaignAction action="resume_campaign" label="恢复" campaign={campaign} run={run} rootPassword={rootPassword} />}
            {campaign.status === 'completed_with_failures' && <button type="button" className="tool-secondary-action" onClick={() => void run('/api/admin/inventory', { action: 'retry_campaign_failures', campaign_id: campaign.id, reason: '管理员重试失败收件人' }, '失败收件人已重新入队。', { confirmation: `确认重试活动 ${campaign.id} 的 ${campaign.failed_count} 个失败收件人？` })}>重试失败收件人</button>}
            {(campaign.status === 'completed' || campaign.status === 'completed_with_failures') && <CampaignAction action="reverse_campaign" label="撤回未消费余额" campaign={campaign} run={run} rootPassword={rootPassword} />}
          </div>
        </article>)}</div>
      </section>
      </div>}

      {activeTab === 'audit' && <section id="inventory-admin-panel-audit" role="tabpanel" aria-labelledby="inventory-admin-tab-audit" className="tool-panel p-5 sm:p-6"><h3 className="text-base font-semibold text-ink-primary">最近审计</h3><ul className="mt-4 max-h-96 space-y-2 overflow-y-auto text-xs text-ink-secondary">{data.audits.map((audit) => <li key={audit.id} className="tool-inset p-3"><details><summary className="cursor-pointer">{new Date(audit.created_at).toLocaleString('zh-CN')} · {audit.admin_username} · {audit.action} · {audit.target_type}/{audit.target_id} · {audit.reason}</summary><div className="mt-2 grid gap-2 lg:grid-cols-2"><AuditJson label="变更前" value={audit.before_json} /><AuditJson label="变更后" value={audit.after_json} /></div></details></li>)}</ul></section>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mt-3 block text-sm text-ink-secondary"><span className="font-medium">{label}</span>{children}</label>
}

function ItemFields(props: {
  definitions: ItemDefinition[]; versions: GiftVersion[]; itemCode: string; setItemCode: (value: string) => void
  giftVersionId: string; setGiftVersionId: (value: string) => void; quantity: number; setQuantity: (value: number) => void
  validityDays: number; setValidityDays: (value: number) => void
}) {
  const gift = props.definitions.find((item) => item.code === props.itemCode)?.kind === 'gift_pack'
  return <>
    <Field label="道具"><select className="tool-field mt-2 w-full" value={props.itemCode} onChange={(event) => { props.setItemCode(event.currentTarget.value); props.setGiftVersionId('') }}>{props.definitions.filter((item) => item.issuance_enabled && item.kind !== 'cosmetic' && item.kind !== 'badge').map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select></Field>
    {gift && <Field label="礼包版本"><select className="tool-field mt-2 w-full" value={props.giftVersionId} onChange={(event) => props.setGiftVersionId(event.currentTarget.value)}><option value="">请选择已发布版本</option>{props.versions.filter((version) => version.item_code === props.itemCode).map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}</select></Field>}
    <div className="grid grid-cols-2 gap-3"><Field label="数量"><input type="number" min={1} max={10000} className="tool-field mt-2 w-full" value={props.quantity} onChange={(event) => props.setQuantity(Number(event.currentTarget.value))} /></Field><Field label="有效天数（0 永久）"><input type="number" min={0} max={3650} className="tool-field mt-2 w-full" value={props.validityDays} onChange={(event) => props.setValidityDays(Number(event.currentTarget.value))} /></Field></div>
  </>
}

function CampaignAction({ action, label, campaign, run, rootPassword }: { action: string; label: string; campaign: Campaign; run: (url: string, json: Record<string, unknown>, success: string, options?: { idempotencyScope?: string; confirmation?: string }) => Promise<unknown | null>; rootPassword: string }) {
  const destructive = action === 'pause_campaign' || action === 'cancel_campaign' || action === 'reverse_campaign'
  const requiresRoot = action === 'reverse_campaign' && campaign.target_mode === 'all_users'
  const confirmation = destructive
    ? `确认对活动 ${campaign.id} 执行“${label}”？目标 ${campaign.recipient_count} 人，当前成功 ${campaign.granted_count} 人。`
    : undefined
  return <button type="button" className="tool-secondary-action" disabled={requiresRoot && !rootPassword} onClick={() => void run('/api/admin/inventory', {
    action,
    campaign_id: campaign.id,
    reason: `管理员${label}`,
    ...(requiresRoot && { root_password: rootPassword }),
  }, `活动已${label}。`, { confirmation })}>{label}</button>
}

function RewardListEditor(props: {
  id: string
  label: string
  value: GiftPackContentInput[]
  definitions: ItemDefinition[]
  versions: GiftVersion[]
  allowGiftPacks: boolean
  onChange: (value: GiftPackContentInput[]) => void
}) {
  const candidates = props.definitions.filter((item) => {
    if (!item.issuance_enabled || item.kind === 'cosmetic' || item.kind === 'badge') return false
    if (item.kind !== 'gift_pack') return true
    return props.allowGiftPacks && props.versions.some((version) => version.item_code === item.code && version.status === 'published')
  })
  const available = candidates.filter((item) => !props.value.some((entry) => entry.item_code === item.code))
  const [candidateCode, setCandidateCode] = useState('')
  const selectedCandidate = available.some((item) => item.code === candidateCode) ? candidateCode : available[0]?.code ?? ''

  const update = (index: number, changes: Partial<GiftPackContentInput>) => {
    props.onChange(props.value.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry))
  }
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= props.value.length) return
    const next = [...props.value]
    ;[next[index], next[target]] = [next[target], next[index]]
    props.onChange(next)
  }

  return <fieldset className="mt-4 min-w-0" aria-describedby={`${props.id}-help`}>
    <legend className="text-sm font-semibold text-ink-primary">{props.label}</legend>
    <p id={`${props.id}-help`} className="mt-1 text-xs leading-5 text-ink-muted">按顺序配置实际发放内容；每项都需明确数量和有效期。{props.allowGiftPacks ? '礼包会在保存时固定最新发布版本。' : '礼包不能嵌套其他礼包。'}</p>
    <div className="mt-3 space-y-3">
      {props.value.length === 0 && <div className="tool-inset p-5 text-center text-sm text-ink-muted">尚未添加任何道具</div>}
      {props.value.map((entry, index) => {
        const definition = props.definitions.find((item) => item.code === entry.item_code)
        const expiryMode = entry.expiry.mode
        const published = definition?.kind === 'gift_pack'
          ? props.versions.filter((version) => version.item_code === entry.item_code && version.status === 'published').sort((left, right) => right.version - left.version)[0]
          : null
        return <article key={entry.item_code} className="tool-inset p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <img src={itemIconPath(definition?.icon_key ?? 'placeholder')} alt="" width={52} height={52} className="h-13 w-13 shrink-0 object-contain" />
              <div className="min-w-0">
                <strong className="block truncate text-sm text-ink-primary">{definition?.name ?? entry.item_code}</strong>
                <span className="mt-1 block break-all font-mono text-[11px] text-ink-muted">{entry.item_code}</span>
                <span className="mt-1 block text-xs text-ink-secondary">{definition ? itemKindLabel(definition.kind) : '目录中已不存在'}</span>
                {published && <span className="mt-1 block text-xs text-ink-muted">保存时固定 v{published.version}</span>}
                {(!definition || !definition.issuance_enabled || (definition.kind === 'gift_pack' && !published)) && <span className="mt-1 block text-xs font-medium text-warning-600">当前道具不可用于新配置，请移除或更换。</span>}
              </div>
            </div>
            <div className="grid min-w-0 flex-[1.4] gap-3 sm:grid-cols-[110px_minmax(130px,1fr)_100px]">
              <Field label="数量"><input aria-label={`${definition?.name ?? entry.item_code}数量`} type="number" min={1} max={10000} className="tool-field mt-2 w-full" value={entry.quantity} onChange={(event) => update(index, { quantity: Number(event.currentTarget.value) })} /></Field>
              <Field label="有效期"><select aria-label={`${definition?.name ?? entry.item_code}有效期`} className="tool-field mt-2 w-full" value={expiryMode} onChange={(event) => update(index, { expiry: event.currentTarget.value === 'never' ? { mode: 'never' } : { mode: 'relative_days', days: 30 } })}><option value="never">永久有效</option><option value="relative_days">领取后若干天</option></select></Field>
              {expiryMode === 'relative_days' && <Field label="天数"><input aria-label={`${definition?.name ?? entry.item_code}有效天数`} type="number" min={1} max={3650} className="tool-field mt-2 w-full" value={entry.expiry.days} onChange={(event) => update(index, { expiry: { mode: 'relative_days', days: Number(event.currentTarget.value) } })} /></Field>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className="tool-secondary-action" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`上移${definition?.name ?? entry.item_code}`}>上移</button>
            <button type="button" className="tool-secondary-action" disabled={index === props.value.length - 1} onClick={() => move(index, 1)} aria-label={`下移${definition?.name ?? entry.item_code}`}>下移</button>
            <button type="button" className="tool-secondary-action" onClick={() => props.onChange(props.value.filter((_, entryIndex) => entryIndex !== index))} aria-label={`删除${definition?.name ?? entry.item_code}`}>删除</button>
          </div>
        </article>
      })}
    </div>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor={`${props.id}-candidate`}>选择要添加的道具</label>
      <select id={`${props.id}-candidate`} className="tool-field min-w-0 flex-1" value={selectedCandidate} disabled={available.length === 0} onChange={(event) => setCandidateCode(event.currentTarget.value)}>
        {available.length === 0 ? <option value="">没有更多可添加道具</option> : available.map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}
      </select>
      <button type="button" className="tool-secondary-action shrink-0" disabled={!selectedCandidate} onClick={() => {
        if (!selectedCandidate) return
        props.onChange([...props.value, { item_code: selectedCandidate, quantity: 1, expiry: { mode: 'never' } }])
        setCandidateCode('')
      }}>添加道具</button>
    </div>
  </fieldset>
}

function RewardSummary({ contents, definitions }: { contents: GiftPackContentInput[]; definitions: ItemDefinition[] }) {
  if (contents.length === 0) return <p className="mt-2 text-xs text-ink-muted">空草稿</p>
  return <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-secondary">
    {contents.map((entry) => <li key={`${entry.item_code}:${expiryKey(entry.expiry)}`}>{definitions.find((item) => item.code === entry.item_code)?.name ?? entry.item_code} ×{entry.quantity} · {formatExpiry(entry.expiry)}</li>)}
  </ul>
}

function giftVersionStatusLabel(status: GiftVersion['status']): string {
  if (status === 'draft') return '草稿'
  if (status === 'published') return '已发布'
  return '已退役'
}

function itemKindLabel(kind: ItemDefinition['kind']): string {
  if (kind === 'consumable') return '消耗券'
  if (kind === 'capacity_upgrade') return '档案扩容'
  if (kind === 'gift_pack') return '礼包'
  if (kind === 'cosmetic') return '主题装扮（预留）'
  if (kind === 'badge') return '成就勋章（预留）'
  if (kind === 'license_voucher') return '授权凭证'
  return assertNever(kind)
}

function AuditJson({ label, value }: { label: string; value: unknown }) {
  return <div><strong className="text-ink-primary">{label}</strong><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2">{JSON.stringify(value, null, 2) ?? 'null'}</pre></div>
}

function downloadCampaignFailures(campaign: Campaign): void {
  const rows = [
    ['user_id', 'attempt_count', 'processed_at', 'error_message'],
    ...campaign.failed_recipients.map((recipient) => [
      recipient.user_id,
      String(recipient.attempt_count),
      recipient.processed_at ?? '',
      recipient.error_message ?? '',
    ]),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `inventory-campaign-${campaign.id}-failures.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function assertNever(value: never): never {
  throw new Error(`Unsupported item kind: ${String(value)}`)
}

function formatExpiry(expiry: ExpiryPolicy): string {
  return expiry.mode === 'never' ? '永久有效' : `领取后 ${expiry.days} 天`
}

function expiryKey(expiry: ExpiryPolicy): string {
  return expiry.mode === 'never' ? 'never' : `days:${expiry.days}`
}
