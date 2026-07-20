import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiJson, apiVoid, getApiErrorMessage } from '../lib/api-client'
import { adminApiJson, clearLegacyAdminCredentials } from '../lib/admin-api-client'
import { copy } from '../copy/index'
import ThemeSwitcher from '../components/ThemeSwitcher'


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
        fallbackMessage: copy.common.pages_AdminSetupPage_001,
      })
      if (!data.user) throw new Error(copy.common.pages_AdminSetupPage_002)
      setUsers((current) => [data.user!, ...current.filter((item) => item.username !== data.user!.username)])
      setUsername('')
      setPassword('')
      setNotice(`${copy.common.pages_AdminSetupPage_003}${data.user.username}`)
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
      await apiVoid('/api/admin/users', {
        method: 'DELETE',
        json: { root_password: rootPassword, username: target },
        fallbackMessage: copy.common.pages_AdminSetupPage_005,
      })
      setUsers((current) => current.filter((item) => item.username !== target))
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
            {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
            {notice && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{notice}</div>}
            <button type="submit" disabled={loading || !rootPassword || !username.trim() || password.length < 8} className="tool-primary-action mt-5 w-full">
              {loading ? copy.common.pages_AdminSetupPage_017 : copy.common.pages_AdminSetupPage_018}
            </button>
          </form>

          <section className="tool-panel overflow-hidden">
            <div className="tool-panel-header p-5">
              <h2 className="text-base font-semibold text-ink-primary">{copy.common.pages_AdminSetupPage_019}</h2>
              <p className="mt-1 text-sm text-ink-muted">{copy.common.pages_AdminSetupPage_020}</p>
            </div>
            <div className="divide-y divide-surface-3">
              {users.length === 0 ? (
                <div className="p-8 text-center text-sm text-ink-muted">{copy.common.pages_AdminSetupPage_021}</div>
              ) : users.map((user) => (
                <div key={user.username} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-ink-primary">{user.username}</div>
                    <div className="mt-1 text-xs text-ink-muted">{copy.common.pages_AdminSetupPage_022}{formatDate(user.created_at)} {copy.common.pages_AdminSetupPage_023}{formatDate(user.updated_at)}</div>
                  </div>
                  <button type="button" onClick={() => handleDelete(user.username)} disabled={loading || !rootPassword} className="tool-secondary-action border-error/35 bg-error/10 text-error hover:bg-error/20">{copy.common.pages_AdminSetupPage_024}</button>
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
