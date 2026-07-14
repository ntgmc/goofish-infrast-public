import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiJson, apiVoid, getApiErrorMessage } from '../lib/api-client'
import { adminApiJson, clearLegacyAdminCredentials } from '../lib/admin-api-client'

interface AdminUserSummary {
  username: string;
  created_at: string;
  updated_at: string;
}

export default function AdminSetupPage() {
  const [rootPassword, setRootPassword] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    clearLegacyAdminCredentials()
    adminApiJson<{ users?: AdminUserSummary[] }>('/api/admin/users')
      .then((data) => {
        setUsers(data.users ?? [])
      })
      .catch(() => undefined)
  }, [])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ user?: AdminUserSummary }>('/api/admin/users', {
        method: 'POST',
        json: { root_password: rootPassword, username, password },
        fallbackMessage: '创建失败',
      })
      if (!data.user) throw new Error('创建失败')
      setUsers((current) => [data.user!, ...current.filter((item) => item.username !== data.user!.username)])
      setUsername('')
      setPassword('')
      setNotice(`已创建管理账号 ${data.user.username}`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setRootPassword('')
      setLoading(false)
    }
  }

  const handleDelete = async (target: string) => {
    if (!window.confirm(`确认删除管理账号 ${target}？`)) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await apiVoid('/api/admin/users', {
        method: 'DELETE',
        json: { root_password: rootPassword, username: target },
        fallbackMessage: '删除失败',
      })
      setUsers((current) => current.filter((item) => item.username !== target))
      setNotice(`已删除管理账号 ${target}`)
    } catch (caught) {
      setError(getApiErrorMessage(caught, '删除失败'))
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
            <p className="tool-eyebrow">Root 设置</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink-primary">管理账号设置</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
              这里使用 `MAA_ADMIN_PASSWORD` 创建日常管理账号。创建完成后，回到后台使用账号密码登录，减少 root 口令暴露次数。
            </p>
          </div>
          <Link to="/admin/overview" className="tool-secondary-action">返回后台</Link>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[380px_1fr]">
          <form onSubmit={handleCreate} className="tool-panel p-5">
            <h2 className="text-base font-semibold text-ink-primary">添加账号</h2>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">Root 口令</span>
              <input type="password" value={rootPassword} onChange={(event) => setRootPassword(event.currentTarget.value)} className="tool-field" autoComplete="current-password" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">管理账号</span>
              <input value={username} onChange={(event) => setUsername(event.currentTarget.value)} className="tool-field" placeholder="3-32 位字母、数字、_ 或 -" autoComplete="username" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">账号密码</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="tool-field" autoComplete="new-password" />
            </label>
            {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
            {notice && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{notice}</div>}
            <button type="submit" disabled={loading || !rootPassword || !username.trim() || password.length < 8} className="tool-primary-action mt-5 w-full">
              {loading ? '处理中...' : '创建管理账号'}
            </button>
          </form>

          <section className="tool-panel overflow-hidden">
            <div className="tool-panel-header p-5">
              <h2 className="text-base font-semibold text-ink-primary">已有账号</h2>
              <p className="mt-1 text-sm text-ink-muted">删除账号同样需要 Root 口令。</p>
            </div>
            <div className="divide-y divide-surface-3">
              {users.length === 0 ? (
                <div className="p-8 text-center text-sm text-ink-muted">登录后台后可在这里看到账号列表，或创建第一个账号。</div>
              ) : users.map((user) => (
                <div key={user.username} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-ink-primary">{user.username}</div>
                    <div className="mt-1 text-xs text-ink-muted">创建 {formatDate(user.created_at)} · 更新 {formatDate(user.updated_at)}</div>
                  </div>
                  <button type="button" onClick={() => handleDelete(user.username)} disabled={loading || !rootPassword} className="tool-secondary-action border-error/35 bg-error/10 text-error hover:bg-error/20">删除账号</button>
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
