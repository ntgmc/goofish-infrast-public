import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { apiVoid } from '../lib/api-client'
import { copy } from '../copy/index'

export default function AccountSafetyPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'export' | 'delete' | 'logout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const exportData = async () => {
    setBusy('export')
    setError(null)
    try {
      const response = await fetch('/api/user/data/export')
      if (!response.ok) throw new Error(copy.features.export_failed)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'maa-personal-data.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.features.export_failed)
    } finally {
      setBusy(null)
    }
  }

  const requestDeletion = async () => {
    if (!window.confirm(copy.features.delete_confirm)) return
    setBusy('delete')
    setError(null)
    try {
      await apiVoid('/api/user/data/delete-request', { method: 'POST', json: { email, password } })
      navigate('/', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.features.delete_failed)
    } finally {
      setBusy(null)
    }
  }

  const logout = async () => {
    setBusy('logout')
    setError(null)
    try {
      await apiVoid('/api/auth/logout', { method: 'POST' })
      setNotice(copy.features.logout_done)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.features.logout)
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-4"><BrandLogo size="md" /><ThemeSwitcher /></div>
        <section className="tool-panel p-6 sm:p-8">
          <p className="tool-eyebrow">{copy.features.account_safety}</p>
          <h1 className="display-title mt-3 text-2xl text-ink-primary">{copy.features.account_safety_title}</h1>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy.features.account_safety_body}</p>
          {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
          {notice && <div className="tool-alert tool-alert--success mt-5" role="status">{notice}</div>}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => void exportData()} disabled={busy !== null} className="tool-secondary-action">
              {busy === 'export' ? copy.features.exporting : copy.features.export_data}
            </button>
            <button type="button" onClick={() => void logout()} disabled={busy !== null} className="tool-secondary-action">{copy.features.logout}</button>
            <Link to="/tool/profiles?recovery=1" className="tool-secondary-action">{copy.features.recovery}</Link>
          </div>
        </section>
        <section className="tool-panel p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-ink-primary">{copy.features.delete_title}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.features.delete_body}</p>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.features.email}</span>
            <input value={email} onChange={(event) => setEmail(event.currentTarget.value)} type="email" autoComplete="email" className="tool-field" />
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.features.password}</span>
            <input value={password} onChange={(event) => setPassword(event.currentTarget.value)} type="password" autoComplete="current-password" className="tool-field" />
          </label>
          <button type="button" onClick={() => void requestDeletion()} disabled={busy !== null || !email || !password} className="tool-danger-action mt-5">
            {busy === 'delete' ? copy.features.deleting : copy.features.delete_account}
          </button>
        </section>
        <Link to="/" className="tool-secondary-action">{copy.features.back_home}</Link>
      </div>
    </main>
  )
}
