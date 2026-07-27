import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../../../lib/api-client'

type RiskStatus = 'pending' | 'dismissed' | 'actioned' | 'all'
type MemberAction = 'none' | 'freeze_account' | 'freeze_profile'

type BehaviorRiskRule = {
  code: string
  category: string
  score: number
  explanation: string
  evidence: Record<string, unknown>
}

type BehaviorRiskProfile = {
  profile_id: string
  profile_label: string
  kind: string
  status: string
}

type BehaviorRiskMember = {
  user_id: string
  account_email: string | null
  counts: Record<string, number>
  first_seen_at: string | null
  last_seen_at: string | null
  browser_prefixes: string[]
  network_prefixes: string[]
  uid_prefixes: string[]
  output_prefixes: string[]
  operator_fingerprint_prefixes?: string[]
  profiles: BehaviorRiskProfile[]
}

type BehaviorRiskCase = {
  id: string
  status: Exclude<RiskStatus, 'all'>
  score: number
  categories: string[]
  rules: BehaviorRiskRule[]
  model_version: string
  first_seen_at: string
  last_seen_at: string
  expires_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  members: BehaviorRiskMember[]
}

type CasePage = {
  cases: BehaviorRiskCase[]
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}

type ActionSelection = { action: MemberAction; profileId: string }

export default function BehaviorRiskPanel() {
  const [status, setStatus] = useState<RiskStatus>('pending')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CasePage>({ cases: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 1 } })
  const [loading, setLoading] = useState(false)
  const [busyCase, setBusyCase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [selections, setSelections] = useState<Record<string, ActionSelection>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiJson<CasePage>(`/api/admin/behavior-risk?status=${status}&page=${page}&page_size=25`, {
        fallbackMessage: '加载行为风控复核单失败。',
      })
      setData(result)
      if (result.pagination.page !== page) setPage(result.pagination.page)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { void load() }, [load])

  const review = async (riskCase: BehaviorRiskCase, outcome: 'dismiss' | 'restrict') => {
    const note = notes[riskCase.id]?.trim() ?? ''
    if (!note) {
      setError('请先填写非空复核说明。')
      return
    }
    const members = riskCase.members.flatMap((member) => {
      const selection = selections[selectionKey(riskCase.id, member.user_id)]
      if (!selection || selection.action === 'none') return []
      return [{
        user_id: member.user_id,
        action: selection.action,
        ...(selection.action === 'freeze_profile' && { profile_id: selection.profileId }),
      }]
    })
    if (outcome === 'restrict' && members.length === 0) {
      setError('请至少为一个成员选择“冻结账号”或“冻结档案”。')
      return
    }
    const prompt = outcome === 'dismiss'
      ? '确认将该复核单标记为误报并关闭？'
      : `确认执行 ${members.length} 项限制操作？账号冻结会立即清除该账号的全部登录会话。`
    if (!window.confirm(prompt)) return
    setBusyCase(riskCase.id)
    setError(null)
    setNotice(null)
    try {
      await apiJson('/api/admin/behavior-risk', {
        method: 'POST',
        json: { case_id: riskCase.id, outcome, note, members: outcome === 'dismiss' ? [] : members },
        fallbackMessage: '提交行为风控复核失败。',
      })
      setNotice(outcome === 'dismiss' ? '复核单已按误报关闭。' : '所选成员的限制操作已执行并写入审计。')
      await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyCase(null)
    }
  }

  return (
    <section className="tool-panel">
      <div className="tool-panel-header flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-primary">全站行为风控复核</h2>
          <p className="mt-1 text-sm text-ink-muted">按关联账号组展示 HMAC 前缀、计数、时间窗和规则解释。系统只建单，不自动限制用户。</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          状态
          <select
            className="tool-field min-h-10 w-32"
            value={status}
            onChange={(event) => { setStatus(event.currentTarget.value as RiskStatus); setPage(1) }}
          >
            <option value="pending">待复核</option>
            <option value="dismissed">已排除</option>
            <option value="actioned">已处置</option>
            <option value="all">全部</option>
          </select>
        </label>
      </div>

      {(error || notice) && (
        <div className="space-y-2 px-4 pt-4" aria-live="polite">
          {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
          {notice && <div className="tool-alert tool-alert--success" role="status">{notice}</div>}
        </div>
      )}

      <div className="divide-y divide-surface-3" aria-busy={loading}>
        {loading && <div className="p-4 text-sm text-ink-muted">正在加载行为复核单…</div>}
        {!loading && data.cases.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">当前筛选下暂无行为风控复核单。</div>}
        {data.cases.map((riskCase) => (
          <article key={riskCase.id} className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tool-status tool-status--warning">风险 {riskCase.score}</span>
                  <span className="font-mono text-xs text-ink-muted">{riskCase.id.slice(0, 12)}…</span>
                  <span className="text-xs text-ink-muted">{statusLabel(riskCase.status)}</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  证据窗口 {formatDate(riskCase.first_seen_at)} — {formatDate(riskCase.last_seen_at)} · 模型 {riskCase.model_version} · 到期 {formatDate(riskCase.expires_at)}
                </p>
              </div>
              <div className="text-xs text-ink-muted">{riskCase.members.length} 个关联账号 · {riskCase.categories.join(' / ')}</div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {riskCase.rules.map((rule) => (
                <div key={rule.code} className="tool-inset p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-ink-primary">{rule.explanation}</span>
                    <span className="shrink-0 text-sm font-semibold text-warning">+{rule.score}</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs leading-5 text-ink-muted">{formatEvidence(rule.evidence)}</p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {riskCase.members.map((member) => {
                const key = selectionKey(riskCase.id, member.user_id)
                const selection = selections[key] ?? { action: 'none' as const, profileId: member.profiles[0]?.profile_id ?? '' }
                return (
                  <div key={member.user_id} className="tool-inset grid gap-3 p-3 xl:grid-cols-[1fr_210px_210px] xl:items-center">
                    <div className="min-w-0">
                      <div className="break-all text-sm font-medium text-ink-primary">{member.account_email ?? '账号已删除'}</div>
                      <div className="mt-1 break-all font-mono text-xs text-ink-muted">用户 ID：{member.user_id}</div>
                      <div className="mt-1 text-xs leading-5 text-ink-muted">
                        事件 {Object.entries(member.counts).map(([name, count]) => `${name}=${count}`).join(' · ') || '无'}<br />
                        浏览器 {member.browser_prefixes.join(', ') || '—'} · 网络 {member.network_prefixes.join(', ') || '—'} · UID {member.uid_prefixes.join(', ') || '—'} · 输出 {member.output_prefixes.join(', ') || '—'} · 干员指纹 {member.operator_fingerprint_prefixes?.join(', ') || '—'}
                      </div>
                    </div>
                    <select
                      className="tool-field min-h-10"
                      value={selection.action}
                      disabled={riskCase.status !== 'pending'}
                      onChange={(event) => {
                        const action = event.currentTarget.value as MemberAction
                        setSelections((current) => ({
                          ...current,
                          [key]: { ...selection, action },
                        }))
                      }}
                    >
                      <option value="none">不处置此成员</option>
                      <option value="freeze_account">冻结整个账号</option>
                      <option value="freeze_profile" disabled={member.profiles.length === 0}>冻结指定档案</option>
                    </select>
                    <select
                      className="tool-field min-h-10"
                      value={selection.profileId}
                      disabled={riskCase.status !== 'pending' || selection.action !== 'freeze_profile'}
                      onChange={(event) => {
                        const profileId = event.currentTarget.value
                        setSelections((current) => ({ ...current, [key]: { ...selection, profileId } }))
                      }}
                    >
                      {member.profiles.length === 0 && <option value="">无可选档案</option>}
                      {member.profiles.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.profile_label} · {profile.profile_id} · {profile.kind} · {profile.status}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>

            {riskCase.status === 'pending' ? (
              <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">复核说明（必填，将写入审计）</span>
                  <textarea
                    className="tool-field min-h-24 w-full resize-y"
                    maxLength={1000}
                    value={notes[riskCase.id] ?? ''}
                    onChange={(event) => {
                      const note = event.currentTarget.value
                      setNotes((current) => ({ ...current, [riskCase.id]: note }))
                    }}
                    placeholder="记录核验依据、沟通情况或处置原因。"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="tool-secondary-action min-h-10 px-4" disabled={busyCase === riskCase.id} onClick={() => void review(riskCase, 'dismiss')}>标记误报</button>
                  <button type="button" className="tool-primary-action min-h-10 px-4" disabled={busyCase === riskCase.id} onClick={() => void review(riskCase, 'restrict')}>{busyCase === riskCase.id ? '提交中…' : '执行所选限制'}</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">复核：{riskCase.reviewed_by ?? '未知管理员'} · {formatDate(riskCase.reviewed_at)}</p>
            )}
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-surface-3 p-4 text-sm text-ink-muted">
        <span>共 {data.pagination.total} 单 · 第 {data.pagination.page}/{data.pagination.total_pages} 页</span>
        <div className="flex gap-2">
          <button type="button" className="tool-secondary-action min-h-9 px-3" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
          <button type="button" className="tool-secondary-action min-h-9 px-3" disabled={loading || page >= data.pagination.total_pages} onClick={() => setPage((current) => current + 1)}>下一页</button>
        </div>
      </div>
    </section>
  )
}

function selectionKey(caseId: string, userId: string): string {
  return `${caseId}:${userId}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : value
}

function statusLabel(status: BehaviorRiskCase['status']): string {
  return status === 'pending' ? '待人工复核' : status === 'dismissed' ? '已排除' : '已人工处置'
}

function formatEvidence(evidence: Record<string, unknown>): string {
  return Object.entries(evidence).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`).join(' · ')
}
