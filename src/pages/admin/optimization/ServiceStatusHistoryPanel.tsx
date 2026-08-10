import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import ServiceStatusBadge from '../../../components/ServiceStatusBadge'
import { copy } from '../../../copy'
import EcsCostControlPanel from './EcsCostControlPanel'
import { calculateServiceStatusCostEstimate } from '../../../lib/service-status-cost'
import { createDefaultServiceStatusCostConfig, type AdminServiceStatusResponse, type ServiceStatusCostConfig, type StatusIncidentImpact, type StatusIncidentState } from '../../../lib/service-status'

const EMPTY: AdminServiceStatusResponse = {
  generated_at: new Date(0).toISOString(), status: 'unavailable', queue: null,
  components: [{ id: 'optimization', status: 'unavailable' }], thresholds: { queue_congested_at: 5, queue_overloaded_at: 20 },
  history: { from: new Date(0).toISOString(), to: new Date(0).toISOString(), interval: 'hour', complete: false, buckets: [] }, incidents: [],
  cost: { config: createDefaultServiceStatusCostConfig(), estimate: calculateServiceStatusCostEstimate(createDefaultServiceStatusCostConfig(), []), recommendation: { generated_at: new Date(0).toISOString(), source_sample_count: 0, confidence: 'none', valley_worker_instances: 0, peak_windows: [], hourly_worker_instances: Array.from({ length: 24 }, () => 0), rationale: [] } },
}

export default function ServiceStatusHistoryPanel() {
  const [data, setData] = useState<AdminServiceStatusResponse>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [impact, setImpact] = useState<StatusIncidentImpact>('minor')
  const [status, setStatus] = useState<StatusIncidentState>('investigating')
  const [busy, setBusy] = useState(false)
  const [updateBodies, setUpdateBodies] = useState<Record<string, string>>({})
  const [updateStates, setUpdateStates] = useState<Record<string, StatusIncidentState>>({})
  const [costDraft, setCostDraft] = useState<ServiceStatusCostConfig>(EMPTY.cost.config)
  const [costSaving, setCostSaving] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const value = await adminApiJson<AdminServiceStatusResponse>('/api/admin/service-status?view=history', { fallbackMessage: '加载状态历史失败' })
      const next = value?.history ? normalizeAdminStatusResponse(value) : EMPTY
      setData(next); setCostDraft(next.cost.config); setError(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '加载状态历史失败') }
    finally { setRefreshing(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveCost = async () => {
    setCostSaving(true)
    try {
      await adminApiJson('/api/admin/service-status', {
        method: 'POST',
        json: {
          action: 'save_cost_config', component_id: costDraft.component_id, billing_model: costDraft.billing_model,
          currency: costDraft.currency, hourly_price_cny: costDraft.hourly_price_cny, timezone: costDraft.timezone,
          schedule_enabled: false, valley_worker_instances: 0,
          peak_windows: [], expected_updated_at: data.cost.config.updated_at, reason: '更新 Worker ECS 自动启停计费单价',
        },
      })
      setError(null)
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '成本计划保存失败') }
    finally { setCostSaving(false) }
  }

  const createIncident = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim() || !body.trim()) return
    setBusy(true)
    try {
      await adminApiJson('/api/admin/service-status', { method: 'POST', json: { action: 'create_incident', component_id: 'optimization', title, impact, status, started_at: new Date().toISOString(), body, reason: '更新公开服务状态事件' } })
      setTitle(''); setBody(''); setError(null); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '事件保存失败') }
    finally { setBusy(false) }
  }

  const resolve = async (incidentId: string, expectedUpdatedAt: string) => {
    setBusy(true)
    try {
      await adminApiJson('/api/admin/service-status', { method: 'PATCH', json: { action: 'append_update', incident_id: incidentId, status: 'resolved', body: '问题已解决，服务恢复正常。', expected_updated_at: expectedUpdatedAt, reason: '标记服务状态事件已解决' } })
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '事件更新失败') }
    finally { setBusy(false) }
  }

  const appendUpdate = async (incidentId: string, expectedUpdatedAt: string, currentStatus: StatusIncidentState) => {
    const updateBody = updateBodies[incidentId]?.trim() ?? ''
    if (!updateBody) return
    setBusy(true)
    try {
      await adminApiJson('/api/admin/service-status', { method: 'PATCH', json: { action: 'append_update', incident_id: incidentId, status: updateStates[incidentId] ?? currentStatus, body: updateBody, expected_updated_at: expectedUpdatedAt, reason: '追加公开服务状态更新' } })
      setUpdateBodies((current) => ({ ...current, [incidentId]: '' }))
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '事件更新失败') }
    finally { setBusy(false) }
  }

  return <section className="tool-panel p-5" aria-labelledby="service-status-history-admin-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="tool-eyebrow">状态与成本</p><h3 id="service-status-history-admin-title" className="mt-2 text-lg font-semibold text-ink-primary">30 天服务历史</h3><p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.status.pages_AdminServiceStatusHistory_001}</p></div><button type="button" className="tool-secondary-action gap-2" onClick={() => void load()} disabled={refreshing}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />刷新</button></div>
    {error && <p className="tool-alert tool-alert--error mt-4" role="alert">{error}</p>}
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.history.buckets.slice(-4).map((bucket) => <div className="tool-inset p-4" key={bucket.bucket_start}><p className="text-xs text-ink-muted">{new Date(bucket.bucket_start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p><div className="mt-2 flex items-center justify-between gap-2"><strong className="text-sm text-ink-primary">{bucket.sample_count} 样本</strong><ServiceStatusBadge level={bucket.status === 'unknown' ? 'unavailable' : bucket.status} compact /></div><p className="mt-2 text-xs text-ink-muted">平均运行并发 {bucket.average_active_concurrency ?? '—'} · 利用率 {bucket.average_utilization_percent ?? '—'}%</p><p className="mt-1 text-xs text-ink-muted">排队峰值 {bucket.peak_queued ?? '—'}</p></div>)}</div>
    <EcsCostControlPanel config={costDraft} estimate={data.cost.estimate} billableWorkerInstances={data.queue?.billable_worker_instances} saving={costSaving} onChange={setCostDraft} onSave={() => void saveCost()} />
    <form className="mt-6 grid gap-3 border-t border-surface-3 pt-5" onSubmit={(event) => void createIncident(event)}><h4 className="font-semibold text-ink-primary">发布事件</h4><input className="tool-field" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="事件标题" maxLength={160} required /><textarea className="tool-field min-h-24" value={body} onChange={(event) => setBody(event.currentTarget.value)} placeholder="公开更新内容" maxLength={2000} required /><div className="flex flex-wrap gap-3"><select className="tool-field" value={impact} onChange={(event) => setImpact(event.currentTarget.value as StatusIncidentImpact)}><option value="minor">轻微影响</option><option value="major">重大影响</option><option value="critical">严重影响</option></select><select className="tool-field" value={status} onChange={(event) => setStatus(event.currentTarget.value as StatusIncidentState)}><option value="investigating">调查中</option><option value="identified">已确认</option><option value="monitoring">监控中</option></select><button className="tool-primary-action" type="submit" disabled={busy || !title.trim() || !body.trim()}>{busy ? '保存中…' : '创建事件'}</button></div></form>
    <div className="mt-6 border-t border-surface-3 pt-5"><h4 className="font-semibold text-ink-primary">事件列表</h4><div className="mt-3 space-y-3">{data.incidents.map((incident) => <article className="tool-inset p-4" key={incident.id}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-ink-primary">{incident.title}</strong><span className="text-xs text-ink-muted">{incident.status}</span></div><p className="mt-2 text-xs text-ink-muted">{incident.updates[incident.updates.length - 1]?.body ?? '暂无更新'}</p>{incident.status !== 'resolved' && <div className="mt-3 grid gap-2"><textarea className="tool-field min-h-20" value={updateBodies[incident.id] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setUpdateBodies((current) => ({ ...current, [incident.id]: value })) }} placeholder="追加公开更新" maxLength={2000} /><div className="flex flex-wrap gap-2"><select className="tool-field" value={updateStates[incident.id] ?? incident.status} onChange={(event) => { const value = event.currentTarget.value as StatusIncidentState; setUpdateStates((current) => ({ ...current, [incident.id]: value })) }}><option value="investigating">调查中</option><option value="identified">已确认</option><option value="monitoring">监控中</option></select><button className="tool-secondary-action" type="button" disabled={busy || !(updateBodies[incident.id]?.trim())} onClick={() => void appendUpdate(incident.id, incident.updated_at, incident.status)}>追加更新</button><button className="tool-secondary-action" type="button" disabled={busy} onClick={() => void resolve(incident.id, incident.updated_at)}>标记已解决</button></div></div>}</article>)}</div></div>
  </section>
}

function normalizeAdminStatusResponse(value: AdminServiceStatusResponse): AdminServiceStatusResponse {
  if (value.cost) {
    const calculated = calculateServiceStatusCostEstimate(value.cost.config, value.history.buckets)
    return { ...value, cost: { ...value.cost, estimate: { ...calculated, ...value.cost.estimate } } }
  }
  const config = createDefaultServiceStatusCostConfig()
  return {
    ...value,
    cost: {
      config,
      estimate: calculateServiceStatusCostEstimate(config, value.history.buckets),
      recommendation: { generated_at: value.generated_at, source_sample_count: 0, confidence: 'none', valley_worker_instances: 0, peak_windows: [], hourly_worker_instances: Array.from({ length: 24 }, () => 0), rationale: [] },
    },
  }
}
