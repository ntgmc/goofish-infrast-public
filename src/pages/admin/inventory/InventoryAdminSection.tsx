import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import { adminInventoryOverviewSchema, type AdminInventoryOverview as Overview } from '../../../lib/admin-inventory-contracts'
import { itemIconPath, type ItemDefinition } from '../../../lib/inventory-contracts'
import { AdminToast } from '../shared/AdminToast'
import { SectionLoader } from '../../../components/SessionLoader'
import { Field, itemKindLabel, type InventoryPanelProps } from './InventoryEditors'
import { InventoryPacksPanel } from './InventoryPacksPanel'
import { InventoryOnboardingPanel } from './InventoryOnboardingPanel'
import { InventoryDistributionPanel } from './InventoryDistributionPanel'
import { AdminTabs } from '../shared/AdminTabs'

const ADMIN_TABS = [
  { id: 'catalog', label: '道具目录', description: '维护系统道具的展示信息和发放状态' },
  { id: 'packs', label: '礼包管理', description: '配置礼包、随机宝箱和自选宝箱' },
  { id: 'onboarding', label: '新人任务', description: '配置三项固定引导任务及奖励' },
  { id: 'distribution', label: '发放中心', description: '单用户、批量发放与批次撤回' },
  { id: 'audit', label: '操作审计', description: '查看最近的后台道具操作' },
] as const
type AdminTab = typeof ADMIN_TABS[number]['id']

export default function InventoryAdminSection() {
  const [data, setData] = useState<Overview | null>(null)
  const [activeTab, setActiveTab] = useState<AdminTab>('catalog')
  const [visited, setVisited] = useState<AdminTab[]>(['catalog'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pending = useRef(new Map<string, { requestJson: string; key: string }>())
  const inFlight = useRef(false)
  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null)
    try {
      const overview = adminInventoryOverviewSchema.parse(await adminApiJson<unknown>('/api/admin/items', { signal }))
      if (!signal?.aborted) setData(overview)
    } catch (caught) {
      if (!signal?.aborted) setError((caught as Error).message)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const run: InventoryPanelProps['run'] = async <T,>(url: string, json: Record<string, unknown>, success: string,
    options: { idempotencyScope?: string; confirmation?: string } = {}) => {
    if (inFlight.current || (options.confirmation && !window.confirm(options.confirmation))) return null
    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const requestJson = JSON.stringify(json)
      const previous = options.idempotencyScope ? pending.current.get(options.idempotencyScope) : null
      const key = options.idempotencyScope
        ? previous?.requestJson === requestJson ? previous.key : crypto.randomUUID()
        : null
      if (options.idempotencyScope && key) pending.current.set(options.idempotencyScope, { requestJson, key })
      const response = await adminApiJson<T>(url, { method: 'POST', json: key ? { ...json, idempotency_key: key } : json })
      if (options.idempotencyScope) pending.current.delete(options.idempotencyScope)
      setNotice(success)
      await load()
      return response
    } catch (caught) {
      setError((caught as Error).message)
      return null
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const selectTab = (tab: AdminTab) => {
    setActiveTab(tab)
    setVisited((current) => current.includes(tab) ? current : [...current, tab])
  }
  const refresh = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try { await load() }
    finally { inFlight.current = false; setBusy(false) }
  }

  if (!data && !error) return <SectionLoader label="正在加载道具管理…" />
  if (!data) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="alert">
    <p>{error}</p>
    {error && <button type="button" className="tool-secondary-action mt-4" disabled={busy} onClick={() => void refresh()}>重试加载</button>}
  </div>

  const props = { data, busy, run }
  return <div className="min-w-0 space-y-6" aria-busy={busy}>
    <section className="tool-panel min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tool-eyebrow">统一道具系统</p>
          <h2 className="mt-2 text-xl font-semibold text-ink-primary">道具与礼包</h2>
        </div>
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => void refresh()}>{busy ? '处理中…' : '刷新道具数据'}</button>
      </div>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-ink-secondary">选择道具并设置数量、有效期即可发放。礼包支持全部领取，宝箱支持随机或自选多项奖励；发布后可用于邀请奖励和新人任务。</p>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}
    </section>

    <nav aria-label="道具与礼包管理分区"><AdminTabs label="道具管理" items={ADMIN_TABS} value={activeTab} onChange={selectTab} disabled={busy} /></nav>
    <p className="text-sm text-ink-muted">{ADMIN_TABS.find((tab) => tab.id === activeTab)?.description}</p>

    {ADMIN_TABS.map((tab) => <fieldset key={tab.id} id={`inventory-admin-panel-${tab.id}`} role="tabpanel"
      aria-label={tab.label} hidden={activeTab !== tab.id} disabled={busy}
      tabIndex={0} className="m-0 min-w-0 border-0 p-0">
      {visited.includes(tab.id) && <>
        {tab.id === 'catalog' && <CatalogPanel {...props} />}
        {tab.id === 'packs' && <InventoryPacksPanel {...props} />}
        {tab.id === 'onboarding' && <InventoryOnboardingPanel {...props} />}
        {tab.id === 'distribution' && <InventoryDistributionPanel {...props} />}
        {tab.id === 'audit' && <AuditPanel data={data} />}
      </>}
    </fieldset>)}
  </div>
}

function CatalogPanel({ data, busy, run }: InventoryPanelProps) {
  const [itemCode, setItemCode] = useState(data.definitions[0]?.code ?? '')
  const [drafts, setDrafts] = useState<Record<string, ItemDefinition>>({})
  const item = drafts[itemCode] ?? data.definitions.find((entry) => entry.code === itemCode)
  const update = (changes: Partial<ItemDefinition>) => {
    if (item) setDrafts((current) => ({ ...current, [itemCode]: { ...item, ...changes } }))
  }
  return <section className="tool-panel min-w-0 p-5 sm:p-6">
    <h3 className="text-base font-semibold text-ink-primary">道具目录</h3>
    <div className="admin-selection mt-4"><aside className="admin-selection-index" aria-label="选择道具">{data.definitions.map((definition) => <button key={definition.code} type="button" aria-pressed={definition.code === itemCode} onClick={() => setItemCode(definition.code)}>
      <strong>{definition.name}</strong><small>{itemKindLabel(definition.kind)} · {definition.issuance_enabled ? '允许发放' : '停用'}</small>
    </button>)}</aside>
    {item && <form className="grid min-w-0 gap-3 lg:grid-cols-2" onSubmit={(event) => {
      event.preventDefault()
      const submittedItem = item
      void run('/api/admin/items', {
        action: 'update_item', item_code: submittedItem.code, name: submittedItem.name.trim(),
        description: submittedItem.description.trim(), issuance_enabled: submittedItem.issuance_enabled,
      }, '道具展示信息已更新。').then((response) => {
        if (response === null) return
        setDrafts((current) => {
          if (current[submittedItem.code] && current[submittedItem.code] !== submittedItem) return current
          const next = { ...current }
          delete next[submittedItem.code]
          return next
        })
      })
    }}>
      <Field label="编辑道具">
        <select className="tool-field mt-2 min-w-0" value={itemCode} onChange={(event) => setItemCode(event.currentTarget.value)}>
          {data.definitions.map((definition) => <option key={definition.code} value={definition.code}>{definition.name} · {definition.code}</option>)}
        </select>
      </Field>
      <Field label="名称"><input className="tool-field mt-2 min-w-0" required maxLength={80} value={item.name} onChange={(event) => update({ name: event.currentTarget.value })} /></Field>
      <Field label="说明"><textarea className="tool-field mt-2 min-h-20 min-w-0" required maxLength={500} value={item.description} onChange={(event) => update({ description: event.currentTarget.value })} /></Field>
      <div className="flex min-w-0 flex-col justify-between gap-3">
        <img src={itemIconPath(item.icon_key)} alt={`${item.name}图标`} width={48} height={48} className="mt-3 h-12 w-12 object-contain" />
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={item.issuance_enabled} onChange={(event) => update({ issuance_enabled: event.currentTarget.checked })} />允许新发放
        </label>
        <button className="tool-secondary-action" disabled={busy || !item.name.trim() || !item.description.trim()}>保存目录展示信息</button>
      </div>
    </form>}</div>
    {data.definitions.length === 0 && <p className="mt-4 text-sm text-ink-muted">暂无道具。</p>}
  </section>
}

function AuditPanel({ data }: { data: Overview }) {
  return <section className="tool-panel min-w-0 p-5 sm:p-6">
    <h3 className="text-base font-semibold text-ink-primary">最近审计</h3>
    {data.audits.length === 0 && <p className="mt-4 text-sm text-ink-muted">暂无操作记录。</p>}
    <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto text-xs text-ink-secondary">
      {data.audits.map((audit) => <li key={audit.id} className="tool-inset min-w-0 p-3">
        <details>
          <summary className="cursor-pointer break-words leading-5">{new Date(audit.created_at).toLocaleString('zh-CN')} · {audit.admin_username} · {audit.action} · {audit.target_type}/{audit.target_id} · {audit.reason}</summary>
          <div className="mt-2 grid min-w-0 gap-2 lg:grid-cols-2">
            <AuditJson label="变更前" value={audit.before_json} />
            <AuditJson label="变更后" value={audit.after_json} />
          </div>
        </details>
      </li>)}
    </ul>
  </section>
}

function AuditJson({ label, value }: { label: string; value: unknown }) {
  return <div className="min-w-0">
    <strong className="text-ink-primary">{label}</strong>
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2">{JSON.stringify(value, null, 2) ?? 'null'}</pre>
  </div>
}
