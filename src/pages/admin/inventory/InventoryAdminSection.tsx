import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { GiftPackContentInput, ItemDefinition, OnboardingTaskCode } from '../../../lib/inventory-contracts'

type GiftVersion = { id: string; item_code: string; version: number; status: 'draft' | 'published' | 'retired'; contents: GiftPackContentInput[] }
type TaskConfig = { task_code: OnboardingTaskCode; version: number; enabled: boolean; rewards_json: GiftPackContentInput[] }
type Campaign = { id: string; item_code: string; status: string; recipient_count: number; granted_count: number; failed_count: number; pending_count: number }
type Audit = { id: string; admin_username: string; action: string; target_type: string; target_id: string; reason: string; created_at: string }
type Overview = { definitions: ItemDefinition[]; gift_pack_versions: GiftVersion[]; tasks: TaskConfig[]; campaigns: Campaign[]; audits: Audit[]; user_count: number }

const DEFAULT_CONTENTS = JSON.stringify([
  { item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } },
], null, 2)

export default function InventoryAdminSection() {
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [giftName, setGiftName] = useState('')
  const [giftDescription, setGiftDescription] = useState('')
  const [contents, setContents] = useState(DEFAULT_CONTENTS)
  const [taskCode, setTaskCode] = useState<OnboardingTaskCode>('welcome_inventory')
  const [taskEnabled, setTaskEnabled] = useState(false)
  const [taskRewards, setTaskRewards] = useState(DEFAULT_CONTENTS)
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
  const [versionContents, setVersionContents] = useState(DEFAULT_CONTENTS)
  const [lastGrantId, setLastGrantId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setData(await adminApiJson<Overview>('/api/admin/items')) }
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

  const run = async <T = unknown>(url: string, json: Record<string, unknown>, success: string): Promise<T | null> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await adminApiJson<T>(url, { method: 'POST', json })
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

  if (!data) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">正在加载道具管理…</div>

  return (
    <div className="space-y-6">
      <section className="tool-panel p-5 sm:p-6">
        <p className="tool-eyebrow">统一道具系统</p>
        <h2 className="mt-2 text-xl font-semibold text-ink-primary">道具与礼包</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-ink-secondary">系统效果代码不可编辑；礼包和新人任务发布后形成不可变版本。图标目前全部使用受控占位图，后续只需替换图标键映射。</p>
        {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
        {notice && <div className="tool-alert tool-alert--success mt-4" role="status">{notice}</div>}
      </section>

      <section className="tool-panel overflow-hidden p-5 sm:p-6">
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
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <form className="tool-panel p-5" onSubmit={(event) => {
          event.preventDefault()
          try {
            void run('/api/admin/items', {
              action: 'create_gift_pack', name: giftName, description: giftDescription,
              icon_key: 'generic_gift_pack', contents: parseContents(contents),
            }, '礼包草稿已创建。')
          } catch (caught) { setError((caught as Error).message) }
        }}>
          <h3 className="text-base font-semibold text-ink-primary">创建自定义礼包</h3>
          <Field label="礼包名称"><input className="tool-field mt-2 w-full" value={giftName} onChange={(event) => setGiftName(event.currentTarget.value)} /></Field>
          <Field label="说明"><textarea className="tool-field mt-2 min-h-20 w-full" value={giftDescription} onChange={(event) => setGiftDescription(event.currentTarget.value)} /></Field>
          <JsonField value={contents} onChange={setContents} />
          <button className="tool-primary-action mt-4" disabled={busy}>创建草稿</button>
        </form>

        <div className="tool-panel p-5">
          <h3 className="text-base font-semibold text-ink-primary">礼包版本</h3>
          <form className="mt-4 border-b border-surface-3 pb-4" onSubmit={(event) => {
            event.preventDefault()
            try { void run('/api/admin/items', { action: 'create_gift_pack_version', item_code: versionItemCode, contents: parseContents(versionContents) }, '礼包新版本草稿已创建。') }
            catch (caught) { setError((caught as Error).message) }
          }}>
            <Field label="基于礼包创建新版本"><select className="tool-field mt-2 w-full" value={versionItemCode} onChange={(event) => setVersionItemCode(event.currentTarget.value)}><option value="">请选择礼包</option>{data.definitions.filter((item) => item.kind === 'gift_pack').map((item) => <option key={item.code} value={item.code}>{item.name} · {item.code}</option>)}</select></Field>
            <JsonField value={versionContents} onChange={setVersionContents} label="新版本内容 JSON" />
            <button className="tool-secondary-action mt-3" disabled={busy || !versionItemCode}>创建新版本草稿</button>
          </form>
          <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto">
            {data.gift_pack_versions.map((version) => <article className="tool-inset p-3" key={version.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{version.item_code} · v{version.version}</span><span className="text-xs text-ink-muted">{version.status}</span></div>
              <p className="mt-2 text-xs leading-5 text-ink-secondary">{version.contents.map((entry) => `${entry.item_code} × ${entry.quantity}`).join('、') || '空草稿'}</p>
              {version.status === 'draft' && <button type="button" className="tool-secondary-action mt-3" disabled={busy} onClick={() => void run('/api/admin/items', { action: 'publish_gift_pack_version', version_id: version.id }, '礼包版本已发布。')}>发布</button>}
              {version.status === 'published' && <button type="button" className="tool-secondary-action mt-3" disabled={busy} onClick={() => void run('/api/admin/items', { action: 'retire_gift_pack_version', version_id: version.id }, '礼包版本已退役。')}>退役</button>}
            </article>)}
          </div>
        </div>
      </section>

      <form className="tool-panel p-5 sm:p-6" onSubmit={(event) => {
        event.preventDefault()
        try { void run('/api/admin/items', { action: 'configure_onboarding_task', task_code: taskCode, enabled: taskEnabled, rewards: parseContents(taskRewards) }, '新人任务配置版本已发布。') }
        catch (caught) { setError((caught as Error).message) }
      }}>
        <h3 className="text-base font-semibold text-ink-primary">固定新人任务</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-[240px_auto]">
          <div>
            <Field label="任务"><select className="tool-field mt-2 w-full" value={taskCode} onChange={(event) => setTaskCode(event.currentTarget.value as OnboardingTaskCode)}><option value="welcome_inventory">认识背包</option><option value="bind_skland">绑定森空岛</option><option value="first_main_schedule">首次主排班</option></select></Field>
            <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={taskEnabled} onChange={(event) => setTaskEnabled(event.currentTarget.checked)} />启用新版本</label>
            <p className="mt-3 text-xs text-ink-muted">当前版本：{data.tasks.find((task) => task.task_code === taskCode)?.version ?? '—'}；默认任务保持停用，奖励内容非空后才能启用。</p>
          </div>
          <JsonField value={taskRewards} onChange={setTaskRewards} label="奖励 JSON" />
        </div>
        <button className="tool-primary-action mt-4" disabled={busy}>发布任务配置</button>
      </form>

      <section className="grid gap-5 xl:grid-cols-2">
        <form className="tool-panel p-5" onSubmit={(event) => { event.preventDefault(); void (async () => {
          const response = await run<{ grant_id: string | null }>('/api/admin/inventory', {
            action: 'grant', user_id: userId, item_code: itemCode, quantity, validity_days: validityDays,
            ...(giftVersionId && { gift_pack_version_id: giftVersionId }), reason,
          }, '道具已发放。')
          if (response?.grant_id) {
            setLastGrantId(response.grant_id)
            setRevokeGrantId(response.grant_id)
          }
        })() }}>
          <h3 className="text-base font-semibold text-ink-primary">单用户发放</h3>
          <Field label="用户 ID"><input className="tool-field mt-2 w-full" value={userId} onChange={(event) => setUserId(event.currentTarget.value)} /></Field>
          <ItemFields definitions={data.definitions} versions={publishedVersions} itemCode={itemCode} setItemCode={setItemCode} giftVersionId={giftVersionId} setGiftVersionId={setGiftVersionId} quantity={quantity} setQuantity={setQuantity} validityDays={validityDays} setValidityDays={setValidityDays} />
          <Field label="发放原因"><input className="tool-field mt-2 w-full" value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></Field>
          <button className="tool-primary-action mt-4" disabled={busy}>发放</button>
          {lastGrantId && <p className="tool-alert tool-alert--success mt-4 break-all text-xs" role="status">最近发放批次 ID：{lastGrantId}（已自动填入撤回表单）</p>}
        </form>
        <form className="tool-panel p-5" onSubmit={(event) => { event.preventDefault(); void run('/api/admin/inventory', { action: 'revoke_grant', grant_id: revokeGrantId, reason }, '尚未消费的余额已撤回。') }}>
          <h3 className="text-base font-semibold text-ink-primary">撤回发放批次</h3>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">只撤回该批次尚未消费的数量，不影响已消费道具、已开启礼包或永久档案权益。</p>
          <Field label="发放批次 ID"><input className="tool-field mt-2 w-full" value={revokeGrantId} onChange={(event) => setRevokeGrantId(event.currentTarget.value)} /></Field>
          <button className="tool-secondary-action mt-4" disabled={busy}>撤回余额</button>
        </form>
      </section>

      <form className="tool-panel p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); void run('/api/admin/inventory', {
        action: 'create_campaign', item_code: itemCode, quantity, validity_days: validityDays, target_mode: targetMode,
        ...(giftVersionId && { gift_pack_version_id: giftVersionId }),
        ...(targetMode === 'user_ids' ? { user_ids: userIds } : { root_password: rootPassword, confirmation: 'DISTRIBUTE TO ALL USERS' }), reason,
      }, '发放活动已进入队列。') }}>
        <h3 className="text-base font-semibold text-ink-primary">批量与全站发放</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <Field label="目标模式"><select className="tool-field mt-2 w-full" value={targetMode} onChange={(event) => setTargetMode(event.currentTarget.value as typeof targetMode)}><option value="user_ids">指定用户 ID</option><option value="all_users">全站用户快照</option></select></Field>
            {targetMode === 'user_ids' ? <Field label="用户 ID（逗号、空格或换行分隔）"><textarea className="tool-field mt-2 min-h-28 w-full" value={targetUsers} onChange={(event) => setTargetUsers(event.currentTarget.value)} /></Field> : <Field label="Root 口令"><input type="password" className="tool-field mt-2 w-full" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} /></Field>}
          </div>
          <div><ItemFields definitions={data.definitions} versions={publishedVersions} itemCode={itemCode} setItemCode={setItemCode} giftVersionId={giftVersionId} setGiftVersionId={setGiftVersionId} quantity={quantity} setQuantity={setQuantity} validityDays={validityDays} setValidityDays={setValidityDays} /><Field label="管理员备注"><input className="tool-field mt-2 w-full" value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></Field></div>
        </div>
        <div className="tool-alert mt-4">预计用户数：{targetMode === 'all_users' ? data.user_count : userIds.length}；预计道具总量：{(targetMode === 'all_users' ? data.user_count : userIds.length) * quantity}。提交时会固定目标用户集合；之后注册的用户不会被包含。{selectedItem?.kind === 'gift_pack' ? '当前礼包必须选择已发布版本。' : ''}</div>
        <button className="tool-primary-action mt-4" disabled={busy}>创建发放活动</button>
      </form>

      <section className="tool-panel p-5 sm:p-6">
        <h3 className="text-base font-semibold text-ink-primary">发放活动</h3>
        <div className="mt-4 space-y-3">{data.campaigns.map((campaign) => <article key={campaign.id} className="tool-inset p-4">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-xs">{campaign.id}</span><strong className="text-sm">{campaign.status}</strong></div>
          <p className="mt-2 text-xs text-ink-secondary">{campaign.item_code} · 目标 {campaign.recipient_count} · 成功 {campaign.granted_count} · 失败 {campaign.failed_count} · 待处理 {campaign.pending_count}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(campaign.status === 'queued' || campaign.status === 'running') && <><CampaignAction action="pause_campaign" label="暂停" campaign={campaign} run={run} /><CampaignAction action="cancel_campaign" label="取消" campaign={campaign} run={run} /></>}
            {campaign.status === 'paused' && <CampaignAction action="resume_campaign" label="恢复" campaign={campaign} run={run} />}
            {campaign.status === 'completed' && <CampaignAction action="reverse_campaign" label="撤回未消费余额" campaign={campaign} run={run} />}
          </div>
        </article>)}</div>
      </section>

      <section className="tool-panel p-5 sm:p-6"><h3 className="text-base font-semibold text-ink-primary">最近审计</h3><ul className="mt-4 max-h-96 space-y-2 overflow-y-auto text-xs text-ink-secondary">{data.audits.map((audit) => <li key={audit.id} className="tool-inset p-3">{new Date(audit.created_at).toLocaleString('zh-CN')} · {audit.admin_username} · {audit.action} · {audit.target_type}/{audit.target_id} · {audit.reason}</li>)}</ul></section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mt-3 block text-sm text-ink-secondary"><span className="font-medium">{label}</span>{children}</label>
}

function JsonField({ value, onChange, label = '内容 JSON' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <Field label={label}><textarea className="tool-field mt-2 min-h-44 w-full font-mono text-xs" value={value} onChange={(event) => onChange(event.currentTarget.value)} /></Field>
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

function CampaignAction({ action, label, campaign, run }: { action: string; label: string; campaign: Campaign; run: (url: string, json: Record<string, unknown>, success: string) => Promise<unknown | null> }) {
  return <button type="button" className="tool-secondary-action" onClick={() => void run('/api/admin/inventory', { action, campaign_id: campaign.id, reason: `管理员${label}` }, `活动已${label}。`)}>{label}</button>
}

function parseContents(value: string): GiftPackContentInput[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('内容必须是 JSON 数组。')
  return parsed as GiftPackContentInput[]
}
