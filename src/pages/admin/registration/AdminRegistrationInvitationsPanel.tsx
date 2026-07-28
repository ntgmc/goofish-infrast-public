import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AdminRegistrationInvitation, AdminRegistrationInvitationStatus } from '../../../lib/types'
import { adminApiJson } from '../../../lib/admin-api-client'
import { copy } from '../../../copy/index'
import { AdminToast } from '../shared/AdminToast'

type StatusFilter = AdminRegistrationInvitationStatus | 'all'

interface PaginationMeta {
  page: number
  page_size: number
  total: number
  total_pages: number
}

interface InvitationListResponse {
  invitations?: AdminRegistrationInvitation[]
  pagination?: PaginationMeta
}

interface InvitationCreateResponse {
  invitation: AdminRegistrationInvitation
  code: string
  share_url: string
}

const EMPTY_PAGINATION: PaginationMeta = { page: 1, page_size: 20, total: 0, total_pages: 0 }

export default function AdminRegistrationInvitationsPanel() {
  const [invitations, setInvitations] = useState<AdminRegistrationInvitation[]>([])
  const [pagination, setPagination] = useState(EMPTY_PAGINATION)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [generated, setGenerated] = useState<InvitationCreateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ page: String(page), page_size: '20', status })
      const data = await adminApiJson<InvitationListResponse>(`/api/admin/registration-invitations?${query}`, {
        fallbackMessage: copy.admin.registration_admin_invites_load_failed,
      })
      setInvitations(data.invitations ?? [])
      setPagination(data.pagination ?? EMPTY_PAGINATION)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { void load() }, [load])

  const absoluteShareUrl = useMemo(() => generated
    ? new URL(generated.share_url, window.location.origin).toString()
    : '', [generated])

  const createInvitation = async () => {
    setBusyId('create')
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<InvitationCreateResponse>('/api/admin/registration-invitations', {
        method: 'POST',
        json: {},
        fallbackMessage: copy.admin.registration_admin_invites_create_failed,
      })
      setGenerated(data)
      setPage(1)
      await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const revokeInvitation = async (invitationId: string) => {
    setBusyId(invitationId)
    setError(null)
    setNotice(null)
    try {
      await adminApiJson('/api/admin/registration-invitations', {
        method: 'PATCH',
        json: { invitation_id: invitationId, action: 'revoke' },
        fallbackMessage: copy.admin.registration_admin_invites_revoke_failed,
      })
      await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(absoluteShareUrl)
      setNotice(copy.admin.registration_admin_invites_copied)
    } catch {
      setError('复制失败，请手动选择并复制注册链接。')
    }
  }

  return (
    <section className="tool-panel p-5 sm:p-6" aria-labelledby="admin-registration-invitations-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="tool-eyebrow">{copy.admin.registration_admin_invites_eyebrow}</p>
          <h2 id="admin-registration-invitations-title" className="mt-2 text-lg font-semibold text-ink-primary">{copy.admin.registration_admin_invites_title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.admin.registration_admin_invites_description}</p>
        </div>
        <button type="button" disabled={busyId !== null} onClick={() => void createInvitation()} className="tool-primary-action">
          {busyId === 'create' ? copy.admin.registration_admin_invites_creating : copy.admin.registration_admin_invites_create}
        </button>
      </div>

      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
      {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}

      {generated && (
        <div className="tool-inset mt-5 space-y-4 p-4" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-ink-primary">{copy.admin.registration_admin_invites_once}</p>
          <ReadonlyCopyField label={copy.admin.registration_admin_invites_code} value={generated.code} />
          <ReadonlyCopyField label={copy.admin.registration_admin_invites_link} value={absoluteShareUrl} />
          <button type="button" onClick={() => void copyShareUrl()} className="tool-secondary-action">{copy.admin.registration_admin_invites_copy}</button>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <label htmlFor="admin-invitation-status" className="block min-w-48">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">状态筛选</span>
          <select
            id="admin-invitation-status"
            value={status}
            disabled={loading}
            onChange={(event) => { setStatus(event.currentTarget.value as StatusFilter); setPage(1) }}
            className="tool-field min-h-11"
          >
            <option value="all">全部</option>
            <option value="active">可使用</option>
            <option value="used">已使用</option>
            <option value="revoked">已撤销</option>
            <option value="expired">已过期</option>
          </select>
        </label>
        <span className="text-sm text-ink-muted" role="status" aria-live="polite">共 {pagination.total} 条</span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">管理员一次性邀请码列表</caption>
          <thead className="text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">状态</th>
              <th scope="col" className="px-3 py-2">创建时间</th>
              <th scope="col" className="px-3 py-2">到期时间</th>
              <th scope="col" className="px-3 py-2">使用账号</th>
              <th scope="col" className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="px-3 py-3"><StatusPill status={invitation.status} /></td>
                <td className="px-3 py-3 text-ink-secondary">{formatDate(invitation.created_at)}</td>
                <td className="px-3 py-3 text-ink-secondary">{formatDate(invitation.expires_at)}</td>
                <td className="px-3 py-3 text-ink-secondary">{invitation.consumed_by_email ?? '—'}</td>
                <td className="px-3 py-3 text-right">
                  {invitation.status === 'active' && (
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void revokeInvitation(invitation.id)}
                      className="tool-secondary-action min-h-9 px-3 text-sm"
                    >
                      {busyId === invitation.id ? '撤销中...' : '撤销'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && invitations.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-muted">{copy.admin.registration_admin_invites_empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <nav className="mt-4 flex items-center justify-end gap-2" aria-label="管理员邀请码分页">
        <button type="button" disabled={loading || pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="tool-secondary-action min-h-10 px-3 text-sm">上一页</button>
        <span className="text-sm text-ink-muted">第 {pagination.page} / {Math.max(1, pagination.total_pages)} 页</span>
        <button type="button" disabled={loading || pagination.total_pages === 0 || pagination.page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)} className="tool-secondary-action min-h-10 px-3 text-sm">下一页</button>
      </nav>
    </section>
  )
}

function ReadonlyCopyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}</span>
      <input type="text" readOnly value={value} onFocus={(event) => event.currentTarget.select()} className="tool-field font-mono" />
    </label>
  )
}

function StatusPill({ status }: { status: AdminRegistrationInvitationStatus }) {
  const labels = { active: '可使用', used: '已使用', revoked: '已撤销', expired: '已过期' } as const
  const className = status === 'active' ? 'text-success' : status === 'used' ? 'text-brand-600' : 'text-ink-muted'
  return <span className={`font-semibold ${className}`}>{labels[status]}</span>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}
