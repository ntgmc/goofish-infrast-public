import { useCallback, useEffect, useState } from 'react'
import { adminApiJson as apiJson } from '../../../lib/admin-api-client'
import type { AdminOptimizationDeadLetter } from '../contracts'

export default function DeadLetterPanel() {
  const [records, setRecords] = useState<AdminOptimizationDeadLetter[]>([])
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
          <p className="mt-1 text-sm text-ink-muted">仅展示安全诊断摘要。重放为管理员无偿覆盖，不扣用户额度，操作前必须填写原因。</p>
        </div>
        <span className={`tool-status ${pendingCount > 0 ? 'tool-status--warning' : 'tool-status--current'}`}>待处理 {pendingCount}</span>
      </div>
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      {records.length === 0 ? <p className="mt-4 text-sm text-ink-muted">暂无死信任务。</p> : (
        <div className="mt-4 space-y-3">
          {records.map((record) => {
            const busy = busyAction === `dead-letter:${record.id}`
            return (
              <article key={record.id} className="tool-inset p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-semibold text-ink-primary">{record.public_error_code} · {record.status}</p>
                    <p className="break-all text-ink-secondary">任务 {record.job_id} · 档案 {record.profile_id ?? '无'} · {record.source}</p>
                    <p className="text-ink-muted">失败类型 {record.failure_kind} · 尝试 {record.attempt_count} 次 · 重放 {record.replay_count} 次</p>
                    <p className="break-words text-danger">{record.internal_error_message}</p>
                    <details className="text-xs text-ink-muted"><summary className="cursor-pointer">安全诊断摘要</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(record.diagnostic_json, null, 2)}</pre></details>
                  </div>
                  {record.status === 'pending_review' && <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={busy} onClick={() => onAction(record.id, 'replay')} className="tool-primary-action">{busy ? '处理中...' : '重放'}</button>
                    <button type="button" disabled={busy} onClick={() => onAction(record.id, 'discard')} className="tool-secondary-action">丢弃</button>
                  </div>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
