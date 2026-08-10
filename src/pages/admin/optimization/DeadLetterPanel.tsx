import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { adminApiBlob as apiBlob, adminApiJson as apiJson } from '../../../lib/admin-api-client'
import type { AdminOptimizationDeadLetter, AdminOptimizationDeadLetterDetail } from '../contracts'
import { requestAdminOperationReason } from '../../../lib/admin-operation-reason'

export default function DeadLetterPanel() {
  const [records, setRecords] = useState<AdminOptimizationDeadLetter[]>([])
  const [details, setDetails] = useState<Record<string, AdminOptimizationDeadLetterDetail>>({})
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(() => new Set())
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiJson<{ dead_letters?: AdminOptimizationDeadLetter[] }>('/api/admin/optimization?limit=50', { fallbackMessage: '加载优化死信失败' })
      setRecords(response.dead_letters ?? [])
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])
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
    const reason = await requestAdminOperationReason({
      title: action === 'replay' ? '确认重放死信任务' : '确认丢弃死信任务',
      description: action === 'replay'
        ? `死信 ${id} 将以管理员无偿方式重放，不扣用户额度。请输入本次重放原因。`
        : `死信 ${id} 将被标记为丢弃且不能再次处理。请输入丢弃原因。`,
      confirmLabel: action === 'replay' ? '确认重放' : '确认丢弃',
    })
    if (!reason) return
    setBusyAction(`dead-letter:${id}`)
    setNotice(null)
    try {
      await apiJson('/api/admin/optimization', { method: 'POST', json: { action, id, reason }, fallbackMessage: action === 'replay' ? '重放失败' : '丢弃失败' })
      await load()
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }
  const discardAll = async () => {
    if (pendingCount === 0) return
    const reason = await requestAdminOperationReason({
      title: '确认丢弃全部待处理死信',
      description: '所有当前仍处于待处理状态的异步优化死信都会被标记为丢弃，不能再次重放。请输入本次批量丢弃原因。',
      confirmLabel: '确认全部丢弃',
    })
    if (!reason) return
    setBusyAction('dead-letter:all')
    setNotice(null)
    setError(null)
    try {
      const response = await apiJson<{ discarded_count?: number }>('/api/admin/optimization', {
        method: 'POST',
        json: { action: 'discard_all', reason },
        fallbackMessage: '批量丢弃死信失败',
      })
      await load()
      setNotice(`已丢弃 ${response.discarded_count ?? pendingCount} 条待处理死信。`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }
  const downloadPayload = async (id: string) => {
    setDownloadingId(id)
    setError(null)
    try {
      const blob = await apiBlob(getDeadLetterPayloadDownloadUrl(id), { fallbackMessage: '下载完整任务载荷失败' })
      if (blob.type && !blob.type.toLowerCase().startsWith('application/json')) {
        throw new Error('下载响应不是 JSON，已取消保存。')
      }
      downloadBlob(blob, `optimization-dead-letter-${safeFileSegment(id)}.json`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setDownloadingId(null)
    }
  }
  const pendingCount = records.filter((record) => record.status === 'pending_review').length
  return (
    <section className="tool-panel p-5" aria-labelledby="optimization-dlq-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="optimization-dlq-title" className="text-base font-semibold text-ink-primary">异步优化死信队列</h2>
          <p className="mt-1 text-sm text-ink-muted">列表展示诊断摘要，可按需查看原始申请配置、干员数据，并下载完整任务载荷。重放为管理员无偿覆盖，不扣用户额度。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`tool-status ${pendingCount > 0 ? 'tool-status--warning' : 'tool-status--current'}`}>待处理 {pendingCount}</span>
          <button type="button" className="tool-secondary-action gap-2" onClick={() => void load()} disabled={loading || busyAction !== null}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            {loading ? '加载中…' : '刷新死信'}
          </button>
          {pendingCount > 0 && <button type="button" className="tool-secondary-action" onClick={() => void discardAll()} disabled={loading || busyAction !== null}>全部丢弃</button>}
        </div>
      </div>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success mt-4" role="status">{notice}</div>}
      {records.length === 0 ? <p className="mt-4 text-sm text-ink-muted">暂无死信任务。</p> : (
        <div className="mt-4 space-y-3">
          {records.map((record) => {
            const busy = busyAction === `dead-letter:${record.id}`
            const expanded = expandedRecordId === record.id
            const loadingDetail = loadingDetailIds.has(record.id)
            const detail = details[record.id]
            const detailError = detailErrors[record.id]
            const detailPanelId = `dead-letter-detail-${record.id}`
            const isReadOnlyLegacySuggestion = record.source === 'optimize_suggestions'
            return (
              <article key={record.id} className="tool-inset p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-semibold text-ink-primary">{record.public_error_code} · {record.status}</p>
                    <p className="break-all text-ink-secondary">任务 {record.job_id} · 档案 {record.profile_id ?? '无'} · {record.source}</p>
                    <p className="text-ink-muted">失败类型 {record.failure_kind} · 尝试 {record.attempt_count} 次 · 重放 {record.replay_count} 次</p>
                    {record.resolved_by && <p className="text-ink-muted">处置人 {record.resolved_by} · 原因：{record.resolution_reason ?? '未记录'}</p>}
                    <p className="break-words text-danger">{record.internal_error_message}</p>
                    <details className="text-xs text-ink-muted"><summary className="cursor-pointer">安全诊断摘要</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(record.diagnostic_json, null, 2)}</pre></details>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void downloadPayload(record.id)}
                        disabled={downloadingId === record.id}
                        className="tool-secondary-action inline-flex min-h-11 items-center px-3 text-sm"
                      >
                        {downloadingId === record.id ? '正在下载...' : '下载完整任务载荷 JSON'}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDetail(record.id)}
                        aria-expanded={expanded}
                        aria-controls={detailPanelId}
                        disabled={loadingDetail}
                        className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-500 hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
                      >
                        {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                        {loadingDetail ? '正在加载申请配置和干员数据...' : expanded ? '收起申请配置和干员数据' : '查看申请配置和干员数据'}
                      </button>
                    </div>
                  </div>
                  {record.status === 'pending_review' && <div className="flex shrink-0 items-center gap-2">
                    {isReadOnlyLegacySuggestion
                      ? <span className="text-xs text-ink-muted">历史优化建议任务仅供审计，不可重放</span>
                      : <button type="button" disabled={busy} onClick={() => onAction(record.id, 'replay')} className="tool-primary-action">{busy ? '处理中...' : '重放'}</button>}
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
  const effectiveConfig = payload?.effectiveConfig
  const operators = Array.isArray(payload?.operators) ? payload.operators : null
  const jobKind = typeof payload?.kind === 'string' ? payload.kind : 'schedule'
  const submittedAt = typeof payload?.submittedAt === 'number' && Number.isFinite(payload.submittedAt)
    ? new Date(payload.submittedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知'

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">申请配置和干员数据</h3>
        <p className="mt-1 text-xs text-ink-muted">以下内容来自原任务的持久化载荷；如需完整任务数据，请使用上方 JSON 下载。</p>
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

function getDeadLetterPayloadDownloadUrl(id: string): string {
  return `/api/admin/optimization?view=dead_letter_download&id=${encodeURIComponent(id)}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'unknown'
}
