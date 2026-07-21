import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { adminApiJson as apiJson } from '../../../lib/admin-api-client'
import type { AdminOptimizationDeadLetter, AdminOptimizationDeadLetterDetail } from '../contracts'

export default function DeadLetterPanel() {
  const [records, setRecords] = useState<AdminOptimizationDeadLetter[]>([])
  const [details, setDetails] = useState<Record<string, AdminOptimizationDeadLetterDetail>>({})
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(() => new Set())
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const response = await apiJson<{ dead_letters?: AdminOptimizationDeadLetter[] }>('/api/admin/optimization?limit=50', { fallbackMessage: '加载优化死信失败' })
      setRecords(response.dead_letters ?? [])
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  const loadDetail = async (id: string) => {
    if (loadingDetailIds.has(id)) return
    setLoadingDetailIds((current) => new Set(current).add(id))
    setDetailErrors((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    try {
      const response = await apiJson<{ dead_letter?: AdminOptimizationDeadLetterDetail }>(
        `/api/admin/optimization?view=dead_letter&id=${encodeURIComponent(id)}`,
        { fallbackMessage: '加载死信完整数据失败' },
      )
      if (!response.dead_letter) throw new Error('接口未返回死信完整数据。')
      setDetails((current) => ({ ...current, [id]: response.dead_letter! }))
    } catch (caught) {
      setDetailErrors((current) => ({ ...current, [id]: (caught as Error).message }))
    } finally {
      setLoadingDetailIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }
  const toggleDetail = (id: string) => {
    if (expandedRecordId === id) {
      setExpandedRecordId(null)
      return
    }
    setExpandedRecordId(id)
    if (!details[id]) void loadDetail(id)
  }
  const onAction = async (id: string, action: 'replay' | 'discard') => {
    const reason = window.prompt(action === 'replay' ? '管理员重放会绕过用户额度扣减。请输入本次重放原因。' : '请输入丢弃原因。')
    if (!reason?.trim()) return
    setBusyAction(`dead-letter:${id}`)
    try {
      await apiJson('/api/admin/optimization', { method: 'POST', json: { action, id, reason: reason.trim() }, fallbackMessage: action === 'replay' ? '重放失败' : '丢弃失败' })
      await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }
  const pendingCount = records.filter((record) => record.status === 'pending_review').length
  return (
    <section className="tool-panel p-5" aria-labelledby="optimization-dlq-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="optimization-dlq-title" className="text-base font-semibold text-ink-primary">异步优化死信队列</h2>
          <p className="mt-1 text-sm text-ink-muted">列表展示诊断摘要，可按需查看原始申请配置、干员数据和完整任务载荷。重放为管理员无偿覆盖，不扣用户额度。</p>
        </div>
        <span className={`tool-status ${pendingCount > 0 ? 'tool-status--warning' : 'tool-status--current'}`}>待处理 {pendingCount}</span>
      </div>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      {records.length === 0 ? <p className="mt-4 text-sm text-ink-muted">暂无死信任务。</p> : (
        <div className="mt-4 space-y-3">
          {records.map((record) => {
            const busy = busyAction === `dead-letter:${record.id}`
            const expanded = expandedRecordId === record.id
            const loadingDetail = loadingDetailIds.has(record.id)
            const detail = details[record.id]
            const detailError = detailErrors[record.id]
            const detailPanelId = `dead-letter-detail-${record.id}`
            return (
              <article key={record.id} className="tool-inset p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-semibold text-ink-primary">{record.public_error_code} · {record.status}</p>
                    <p className="break-all text-ink-secondary">任务 {record.job_id} · 档案 {record.profile_id ?? '无'} · {record.source}</p>
                    <p className="text-ink-muted">失败类型 {record.failure_kind} · 尝试 {record.attempt_count} 次 · 重放 {record.replay_count} 次</p>
                    <p className="break-words text-danger">{record.internal_error_message}</p>
                    <details className="text-xs text-ink-muted"><summary className="cursor-pointer">安全诊断摘要</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(record.diagnostic_json, null, 2)}</pre></details>
                    <button
                      type="button"
                      onClick={() => toggleDetail(record.id)}
                      aria-expanded={expanded}
                      aria-controls={detailPanelId}
                      disabled={loadingDetail}
                      className="mt-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-500 hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
                    >
                      {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                      {loadingDetail ? '正在加载完整申请数据...' : expanded ? '收起完整申请数据' : '查看完整申请数据'}
                    </button>
                  </div>
                  {record.status === 'pending_review' && <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={busy} onClick={() => onAction(record.id, 'replay')} className="tool-primary-action">{busy ? '处理中...' : '重放'}</button>
                    <button type="button" disabled={busy} onClick={() => onAction(record.id, 'discard')} className="tool-secondary-action">丢弃</button>
                  </div>}
                </div>
                {expanded && (
                  <div id={detailPanelId} className="mt-4 border-t border-surface-3 pt-4" aria-busy={loadingDetail}>
                    {loadingDetail && <p className="text-sm text-ink-muted">正在读取原任务载荷...</p>}
                    {detailError && (
                      <div className="tool-alert tool-alert--error flex flex-wrap items-center justify-between gap-3" role="alert">
                        <span>{detailError}</span>
                        <button type="button" onClick={() => void loadDetail(record.id)} className="tool-secondary-action">重试</button>
                      </div>
                    )}
                    {detail && <DeadLetterPayloadDetails detail={detail} />}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function DeadLetterPayloadDetails({ detail }: { detail: AdminOptimizationDeadLetterDetail }) {
  const payload = asRecord(detail.payload_json)
  const request = asRecord(payload?.request)
  const effectiveConfig = payload?.effectiveConfig
  const operators = Array.isArray(payload?.operators) ? payload.operators : null
  const jobKind = typeof payload?.kind === 'string'
    ? payload.kind
    : request?.suggestions_only === true ? 'upgrade_suggestions' : 'schedule'
  const submittedAt = typeof payload?.submittedAt === 'number' && Number.isFinite(payload.submittedAt)
    ? new Date(payload.submittedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知'

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">完整申请数据</h3>
        <p className="mt-1 text-xs text-ink-muted">以下内容来自原任务的持久化载荷，用于还原死信发生时实际参与计算的数据。</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <PayloadSummary label="载荷版本" value={typeof payload?.version === 'number' ? String(payload.version) : '未知'} />
        <PayloadSummary label="任务类型" value={jobKind} />
        <PayloadSummary label="提交时间" value={submittedAt} />
        <PayloadSummary label="干员数量" value={operators ? String(operators.length) : '未提供'} />
      </dl>
      {effectiveConfig === undefined ? (
        <p className="tool-alert tool-alert--warning text-sm">该历史任务载荷未包含申请基建配置。</p>
      ) : (
        <JsonDataBlock title="申请的基建配置" value={effectiveConfig} />
      )}
      {operators === null ? (
        <p className="tool-alert tool-alert--warning text-sm">该历史任务载荷未包含干员数据。</p>
      ) : (
        <CollapsibleJsonData title={`干员数据（${operators.length}）`} value={operators} />
      )}
      <CollapsibleJsonData title="完整任务载荷" value={detail.payload_json} />
    </div>
  )
}

function PayloadSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-inset px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}

function JsonDataBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="tool-inset overflow-hidden" aria-label={title}>
      <h4 className="border-b border-surface-3 px-3 py-2 text-sm font-semibold text-ink-primary">{title}</h4>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed text-ink-secondary">{formatJson(value)}</pre>
    </section>
  )
}

function CollapsibleJsonData({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="tool-inset overflow-hidden">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-semibold text-ink-primary">{title}</summary>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all border-t border-surface-3 p-3 font-mono text-xs leading-relaxed text-ink-secondary">{formatJson(value)}</pre>
    </details>
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value)
}
