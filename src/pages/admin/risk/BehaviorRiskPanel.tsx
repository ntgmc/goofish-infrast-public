import { useCallback, useEffect, useRef, useState } from 'react'
import {
  behaviorRiskCasePageSchema,
  type BehaviorRiskCaseDto,
  type BehaviorRiskCasePageDto,
  type BehaviorRiskHealthDto,
} from '../../../lib/behavior-risk-contracts'
import { ApiError, apiJson } from '../../../lib/api-client'
import { AdminToast } from '../shared/AdminToast'

type RiskStatus = BehaviorRiskCaseDto['status'] | 'all'
type MemberAction = 'none' | 'freeze_account' | 'freeze_profile'
type ActionSelection = { action: MemberAction; profileId: string }

const EMPTY_HEALTH: BehaviorRiskHealthDto = {
  status: 'unknown',
  last_collection_at: null,
  last_collection_status: null,
  last_evaluation_at: null,
  last_evaluation_status: null,
  last_failure_at: null,
  last_failure_stage: null,
  backlog_count: 0,
  events_processed: 0,
  duration_ms: 0,
  purged_events: 0,
}

function emptyPage(): BehaviorRiskCasePageDto {
  return {
    cases: [],
    pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 },
    health: EMPTY_HEALTH,
    capabilities: [],
  }
}

export default function BehaviorRiskPanel() {
  const [status, setStatus] = useState<RiskStatus>('pending')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<BehaviorRiskCasePageDto>(emptyPage)
  const [loading, setLoading] = useState(false)
  const [busyCase, setBusyCase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [rootPasswords, setRootPasswords] = useState<Record<string, string>>({})
  const [selections, setSelections] = useState<Record<string, ActionSelection>>({})
  const requestId = useRef(0)
  const abortController = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    const currentRequestId = ++requestId.current
    abortController.current?.abort()
    const controller = new AbortController()
    abortController.current = controller
    setLoading(true)
    setError(null)
    setData(emptyPage())
    try {
      const raw = await apiJson<unknown>(`/api/admin/behavior-risk?status=${status}&page=${page}&page_size=25`, {
        signal: controller.signal,
        fallbackMessage: '加载行为风控复核单失败。',
      })
      const result = behaviorRiskCasePageSchema.parse(raw)
      if (currentRequestId !== requestId.current) return
      setData(result)
      cleanupCaseFormState(result.cases.map((riskCase) => riskCase.id), setNotes, setRootPasswords, setSelections)
      if (result.pagination.page !== page) setPage(result.pagination.page)
    } catch (caught) {
      if (currentRequestId !== requestId.current || isAbortError(caught)) return
      setError((caught as Error).message)
    } finally {
      if (currentRequestId === requestId.current) setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
      abortController.current?.abort()
    }
  }, [load])

  const review = async (riskCase: BehaviorRiskCaseDto, outcome: 'dismiss' | 'restrict') => {
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
    const rootPassword = rootPasswords[riskCase.id] ?? ''
    if (outcome === 'restrict' && !rootPassword) {
      setError('执行限制操作前必须填写 Root 口令进行二次认证。')
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
        json: {
          case_id: riskCase.id,
          outcome,
          note,
          members: outcome === 'dismiss' ? [] : members,
          ...(outcome === 'restrict' ? { root_password: rootPassword } : {}),
        },
        fallbackMessage: '提交行为风控复核失败。',
      })
      setNotice(outcome === 'dismiss' ? '复核单已按误报关闭。' : '所选成员的限制操作已执行并写入长期审计。')
      await load()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setNotice('该复核单已由其他管理员处理，列表已自动刷新。')
        await load()
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setBusyCase(null)
    }
  }

  const canReview = data.capabilities?.includes('risk_review') === true
  const controlsDisabled = loading || Boolean(error) || busyCase !== null

  return (
    <section className="tool-panel">
      <div className="tool-panel-header flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-primary">全站行为风控复核</h2>
          <p className="mt-1 text-sm text-ink-muted">按关联账号组展示去身份化证据、规则解释和不可变复核审计。系统只建单，不自动限制用户。</p>
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

      <HealthCard health={data.health} loading={loading} />
      {error && (
        <div className="space-y-2 px-4 pt-4">
          <div className="tool-alert tool-alert--error" role="alert">{error}</div>
          <button type="button" className="tool-secondary-action min-h-9 px-3" onClick={() => void load()}>重试当前筛选</button>
        </div>
      )}
      {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}

      <div className="divide-y divide-surface-3" aria-busy={loading}>
        {loading && <div className="p-4 text-sm text-ink-muted" role="status">正在加载行为复核单…</div>}
        {!loading && !error && data.cases.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">当前筛选下暂无行为风控复核单。</div>}
        {!loading && !error && data.cases.map((riskCase) => (
          <article key={riskCase.id} className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`tool-status ${riskStatusClass(riskCase)}`}>风险 {riskCase.score}</span>
                  <span className="font-mono text-xs text-ink-muted">{riskCase.id.slice(0, 12)}…</span>
                  <span className={`tool-status ${caseStatusClass(riskCase.status)}`}>{statusLabel(riskCase.status)}</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  证据窗口 {formatDate(riskCase.first_seen_at)} — {formatDate(riskCase.last_seen_at)} · 模型 {riskCase.model_version} · 到期 {formatDate(riskCase.expires_at)}
                </p>
              </div>
              <div className="text-xs text-ink-muted">{riskCase.members.length} 个关联账号 · {riskCase.categories.map(categoryLabel).join(' / ')}</div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {riskCase.rules.map((rule) => (
                <div key={rule.code} className="tool-inset p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-ink-primary">{rule.explanation}</span>
                    <span className="shrink-0 text-sm font-semibold text-warning">+{rule.score}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{categoryLabel(rule.category)} · {rule.code}</p>
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
                        设备 {member.browser_prefixes.join(', ') || '—'} · 网络 {member.network_prefixes.join(', ') || '—'} · UID {member.uid_prefixes.join(', ') || '—'} · 输出 {member.output_prefixes.join(', ') || '—'} · 干员指纹 {member.operator_fingerprint_prefixes?.join(', ') || '—'}
                      </div>
                    </div>
                    <select
                      className="tool-field min-h-10"
                      value={selection.action}
                      disabled={controlsDisabled || !canReview || riskCase.status !== 'pending'}
                      onChange={(event) => {
                        const action = event.currentTarget.value as MemberAction
                        setSelections((current) => ({ ...current, [key]: { ...selection, action } }))
                      }}
                    >
                      <option value="none">不处置此成员</option>
                      <option value="freeze_account">冻结整个账号</option>
                      <option value="freeze_profile" disabled={member.profiles.length === 0}>冻结指定档案</option>
                    </select>
                    <select
                      className="tool-field min-h-10"
                      value={selection.profileId}
                      disabled={controlsDisabled || !canReview || riskCase.status !== 'pending' || selection.action !== 'freeze_profile'}
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

            {riskCase.status === 'pending' && canReview ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">复核说明（必填，将写入审计）</span>
                  <textarea
                    className="tool-field min-h-24 w-full resize-y"
                    maxLength={1000}
                    disabled={controlsDisabled}
                    value={notes[riskCase.id] ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setNotes((current) => ({ ...current, [riskCase.id]: value }))
                    }}
                    placeholder="记录核验依据、沟通情况或处置原因。"
                  />
                </label>
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">Root 口令（执行限制时二次认证）</span>
                    <input
                      type="password"
                      className="tool-field min-h-10 w-full"
                      maxLength={128}
                      autoComplete="off"
                      disabled={controlsDisabled}
                      value={rootPasswords[riskCase.id] ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setRootPasswords((current) => ({ ...current, [riskCase.id]: value }))
                      }}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="tool-secondary-action min-h-10 px-4" disabled={controlsDisabled} onClick={() => void review(riskCase, 'dismiss')}>标记误报</button>
                    <button type="button" className="tool-primary-action min-h-10 px-4" disabled={controlsDisabled} onClick={() => void review(riskCase, 'restrict')}>{busyCase === riskCase.id ? '提交中…' : '执行所选限制'}</button>
                  </div>
                </div>
              </div>
            ) : riskCase.status === 'pending' ? (
              <p className="text-xs text-ink-muted">当前账号仅有查看权限；复核与限制操作需要 risk_review 能力。</p>
            ) : (
              <p className="text-xs text-ink-muted">复核：{riskCase.reviewed_by ?? '未知管理员'} · {formatDate(riskCase.reviewed_at)}</p>
            )}

            {riskCase.audits.length > 0 && (
              <details className="tool-inset p-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink-primary">长期复核审计（{riskCase.audits.length}）</summary>
                <div className="mt-3 space-y-3">
                  {riskCase.audits.map((audit) => (
                    <div key={audit.id} className="border-t border-surface-3 pt-3 text-xs leading-5 text-ink-muted first:border-0 first:pt-0">
                      <p>{audit.admin_username} · {audit.outcome === 'dismiss' ? '排除' : '限制'} · {formatDate(audit.created_at)}</p>
                      <p className="mt-1 text-ink-secondary">说明：{audit.note}</p>
                      <p className="mt-1 break-all font-mono">动作：{formatJson(audit.actions)} · 快照：{formatJson(audit.case_snapshot)}</p>
                      <p className="mt-1 break-all font-mono">完整性哈希：{audit.integrity_hash ?? '旧记录未生成'}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-surface-3 p-4 text-sm text-ink-muted">
        <span>共 {data.pagination.total} 单 · {data.pagination.total_pages === 0 ? '暂无分页' : `第 ${data.pagination.page}/${data.pagination.total_pages} 页`}</span>
        <div className="flex gap-2">
          <button type="button" className="tool-secondary-action min-h-9 px-3" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
          <button type="button" className="tool-secondary-action min-h-9 px-3" disabled={loading || data.pagination.total_pages === 0 || page >= data.pagination.total_pages} onClick={() => setPage((current) => current + 1)}>下一页</button>
        </div>
      </div>
    </section>
  )
}

function HealthCard({ health, loading }: { health: BehaviorRiskHealthDto; loading: boolean }) {
  if (loading) return null
  const degraded = health.status !== 'ok'
  return (
    <div className={`mx-4 mt-4 tool-alert ${degraded ? 'tool-alert--warning' : 'tool-alert--success'}`} role="status">
      <div className="font-medium">采集与评估健康：{health.status === 'ok' ? '正常' : health.status === 'degraded' ? '降级' : '尚无运行记录'}</div>
      <div className="mt-1 text-xs">
        最近采集 {formatDate(health.last_collection_at)} · 采集状态 {health.last_collection_status ?? 'unknown'} · 最近评估 {formatDate(health.last_evaluation_at)} · 评估状态 {health.last_evaluation_status ?? 'unknown'} · 本次事件 {health.events_processed} · backlog {health.backlog_count} · 耗时 {health.duration_ms}ms · 最近清理 {health.purged_events}
        {health.last_failure_at && ` · 最近失败 ${formatDate(health.last_failure_at)}（${health.last_failure_stage ?? 'unknown'}）`}
      </div>
    </div>
  )
}

function cleanupCaseFormState(
  caseIds: string[],
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setRootPasswords: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setSelections: React.Dispatch<React.SetStateAction<Record<string, ActionSelection>>>,
): void {
  const allowed = new Set(caseIds)
  setNotes((current) => Object.fromEntries(Object.entries(current).filter(([caseId]) => allowed.has(caseId))))
  setRootPasswords((current) => Object.fromEntries(Object.entries(current).filter(([caseId]) => allowed.has(caseId))))
  setSelections((current) => Object.fromEntries(Object.entries(current).filter(([key]) => allowed.has(key.split(':', 1)[0]!))))
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function selectionKey(caseId: string, userId: string): string {
  return `${caseId}:${userId}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : value
}

function statusLabel(status: BehaviorRiskCaseDto['status']): string {
  return status === 'pending' ? '待人工复核' : status === 'dismissed' ? '已排除' : '已人工处置'
}

function caseStatusClass(status: BehaviorRiskCaseDto['status']): string {
  return status === 'pending' ? 'tool-status--warning' : status === 'actioned' ? 'tool-status--success' : 'tool-status--current'
}

function riskStatusClass(riskCase: BehaviorRiskCaseDto): string {
  if (riskCase.status !== 'pending') return 'tool-status--current'
  if (riskCase.score >= 80) return 'tool-status--error'
  return riskCase.score >= 50 ? 'tool-status--warning' : 'tool-status--current'
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    environment: '关联环境',
    service_path: '服务路径',
    identity: '身份关联',
    operator_data: '干员数据',
    dormancy: '导出后沉默',
  }
  return labels[category] ?? category
}

function formatEvidence(evidence: Record<string, unknown>): string {
  return Object.entries(evidence).map(([key, value]) => `${key}=${formatJson(value)}`).join(' · ')
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[无法序列化]'
  }
}
