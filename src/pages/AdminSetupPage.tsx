import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { getApiErrorMessage } from '../lib/api-client'
import { adminApiJson, adminApiVoid } from '../lib/admin-api-client'
import { copy } from '../copy/index'
import ThemeSwitcher from '../components/ThemeSwitcher'


interface AdminUserSummary {
  username: string;
  role: 'risk_viewer' | 'risk_reviewer' | 'security_admin';
  created_at: string;
  updated_at: string;
}

export default function AdminSetupPage() {
  const [rootPassword, setRootPassword] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [operationReason, setOperationReason] = useState('')
  const [role, setRole] = useState<AdminUserSummary['role']>('risk_viewer')
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadUsers = useCallback(() => {
    setUsersLoading(true)
    setUsersError(null)
    return adminApiJson<{ users?: AdminUserSummary[] }>('/api/admin/users')
      .then((data) => {
        setUsers(data.users ?? [])
      })
      .catch((caught) => setUsersError(getApiErrorMessage(caught, '加载管理员列表失败。')))
      .finally(() => setUsersLoading(false))
  }, [])

  useEffect(() => { void loadUsers() }, [loadUsers])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const replaceExisting = users.some((item) => item.username === username.trim())
      if (replaceExisting && !window.confirm(`管理员 ${username.trim()} 已存在。确认替换其密码和角色并撤销全部现有会话？`)) return
      const data = await adminApiJson<{ user?: AdminUserSummary; replaced?: boolean }>('/api/admin/users', {
        method: 'POST',
        json: {
          root_password: rootPassword,
          username,
          password,
          role,
          reason: operationReason.trim(),
          ...(replaceExisting && { replace_existing: true }),
        },
        fallbackMessage: copy.common.pages_AdminSetupPage_001,
      })
      if (!data.user) throw new Error(copy.common.pages_AdminSetupPage_002)
      setUsers((current) => [data.user!, ...current.filter((item) => item.username !== data.user!.username)])
      setUsername('')
      setPassword('')
      setOperationReason('')
      setNotice(data.replaced ? `已替换管理员 ${data.user.username}` : `${copy.common.pages_AdminSetupPage_003}${data.user.username}`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setRootPassword('')
      setLoading(false)
    }
  }

  const handleDelete = async (target: string) => {
    if (!window.confirm(`${copy.common.pages_AdminSetupPage_004}${target}？`)) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await adminApiVoid('/api/admin/users', {
        method: 'DELETE',
        json: { root_password: rootPassword, username: target, reason: operationReason.trim() },
        fallbackMessage: copy.common.pages_AdminSetupPage_005,
      })
      setUsers((current) => current.filter((item) => item.username !== target))
      setOperationReason('')
      setNotice(`${copy.common.pages_AdminSetupPage_006}${target}`)
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.common.pages_AdminSetupPage_007))
    } finally {
      setRootPassword('')
      setLoading(false)
    }
  }

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-5xl">
        <div className="tool-page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="section-index">{copy.common.pages_AdminSetupPage_008}</p>
            <h1 className="display-title mt-2 text-2xl text-ink-primary">{copy.common.pages_AdminSetupPage_009}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
              {copy.common.pages_AdminSetupPage_010}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ThemeSwitcher />
            <Link to="/admin/overview" className="tool-secondary-action">{copy.common.pages_AdminSetupPage_011}</Link>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[380px_1fr]">
          <form onSubmit={handleCreate} className="tool-panel p-5">
            <h2 className="text-base font-semibold text-ink-primary">{copy.common.pages_AdminSetupPage_012}</h2>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.common.pages_AdminSetupPage_013}</span>
              <input type="password" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} className="tool-field" autoComplete="current-password" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.common.pages_AdminSetupPage_014}</span>
              <input value={username} onChange={(event) => setUsername(event.currentTarget.value)} className="tool-field" placeholder={copy.common.pages_AdminSetupPage_015} autoComplete="username" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.common.pages_AdminSetupPage_016}</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="tool-field" autoComplete="new-password" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">操作原因 / 工单号</span>
              <input value={operationReason} onChange={(event) => setOperationReason(event.currentTarget.value)} maxLength={500} className="tool-field" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">风控角色</span>
              <select value={role} onChange={(event) => setRole(event.currentTarget.value as AdminUserSummary['role'])} className="tool-field">
                <option value="risk_viewer">风险只读</option>
                <option value="risk_reviewer">风险复核</option>
                <option value="security_admin">安全管理员</option>
              </select>
            </label>
            {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
            {notice && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{notice}</div>}
            <button type="submit" disabled={loading || !rootPassword || !username.trim() || password.length < 8 || password.length > 128 || operationReason.trim().length < 2} className="tool-primary-action mt-5 w-full">
              {loading ? copy.common.pages_AdminSetupPage_017 : copy.common.pages_AdminSetupPage_018}
            </button>
          </form>

          <section className="tool-panel overflow-hidden">
            <div className="tool-panel-header p-5">
              <h2 className="text-base font-semibold text-ink-primary">{copy.common.pages_AdminSetupPage_019}</h2>
              <p className="mt-1 text-sm text-ink-muted">{copy.common.pages_AdminSetupPage_020}</p>
            </div>
            <div className="divide-y divide-surface-3">
              {usersLoading ? (
                <div className="p-8 text-center text-sm text-ink-muted">正在加载管理账号…</div>
              ) : usersError ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-error" role="alert">{usersError}</p>
                  <button type="button" onClick={() => void loadUsers()} className="tool-secondary-action mt-3">重试</button>
                </div>
              ) : users.length === 0 ? (
                <div className="p-8 text-center text-sm text-ink-muted">{copy.common.pages_AdminSetupPage_021}</div>
              ) : users.map((user) => (
                <div key={user.username} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-ink-primary">{user.username}</div>
                    <div className="mt-1 text-xs text-ink-muted">角色：{adminRoleLabel(user.role)}</div>
                    <div className="mt-1 text-xs text-ink-muted">{copy.common.pages_AdminSetupPage_022}{formatDate(user.created_at)} {copy.common.pages_AdminSetupPage_023}{formatDate(user.updated_at)}</div>
                  </div>
                  <button type="button" onClick={() => handleDelete(user.username)} disabled={loading || !rootPassword || operationReason.trim().length < 2} className="tool-secondary-action border-error/35 bg-error/10 text-error hover:bg-error/20">{copy.common.pages_AdminSetupPage_024}</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function adminRoleLabel(role: AdminUserSummary['role']): string {
  return role === 'security_admin' ? '安全管理员' : role === 'risk_reviewer' ? '风险复核' : '风险只读'
}
