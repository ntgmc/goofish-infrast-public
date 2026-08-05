import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import DebugModePanel from '../components/DebugModePanel'
import {
  apiBlob,
  apiJson,
  apiVoid,
} from '../lib/api-client'
import type { AccountDeletionAccepted } from '../lib/types'
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from '../lib/auth-constraints'
import {
  accountLifecycleErrorMessage,
  deletionEmailMessage,
  formatAccountDeletionDeadline,
} from '../lib/account-lifecycle-client'
import { copy } from '../copy/index'

export default function AccountSafetyPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'export' | 'delete' | 'logout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletion, setDeletion] = useState<AccountDeletionAccepted | null>(null)

  const exportData = async () => {
    setBusy('export')
    setError(null)
    try {
      const blob = await apiBlob('/api/user/data/export', { fallbackMessage: copy.features.export_failed })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'maa-personal-data.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(accountLifecycleErrorMessage(caught, copy.features.export_failed))
    } finally {
      setBusy(null)
    }
  }

  const requestDeletion = async () => {
    if (!window.confirm(copy.features.delete_confirm)) return
    setBusy('delete')
    setError(null)
    try {
      const accepted = await apiJson<AccountDeletionAccepted>('/api/user/data/delete-request', {
        method: 'POST',
        json: { email, password },
        fallbackMessage: copy.features.delete_failed,
      })
      setDeletion(accepted)
      setPassword('')
    } catch (caught) {
      setError(accountLifecycleErrorMessage(caught, copy.features.delete_failed))
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
            <button type="button" onClick={() => void exportData()} disabled={busy !== null || Boolean(deletion)} className="tool-secondary-action">
              {busy === 'export' ? copy.features.exporting : copy.features.export_data}
            </button>
            <button type="button" onClick={() => void logout()} disabled={busy !== null || Boolean(deletion)} className="tool-secondary-action">{copy.features.logout}</button>
            <Link to="/tool/profiles?recovery=1" className="tool-secondary-action">{copy.features.recovery}</Link>
          </div>
        </section>
        <DebugModePanel />
        <section className="tool-panel p-6 sm:p-8">
          {deletion ? (
            <DeletionAcceptedPanel deletion={deletion} onLeave={() => navigate('/', { replace: true })} />
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink-primary">{copy.features.delete_title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.features.delete_body}</p>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.features.email}</span>
                <input value={email} onChange={(event) => setEmail(event.currentTarget.value)} type="email" maxLength={AUTH_EMAIL_MAX_LENGTH} autoComplete="email" className="tool-field" />
              </label>
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.features.password}</span>
                <input value={password} onChange={(event) => setPassword(event.currentTarget.value)} type="password" maxLength={AUTH_PASSWORD_MAX_LENGTH} autoComplete="current-password" className="tool-field" />
              </label>
              <button type="button" onClick={() => void requestDeletion()} disabled={busy !== null || !email || !password} className="tool-danger-action mt-5">
                {busy === 'delete' ? copy.features.deleting : copy.features.delete_account}
              </button>
            </>
          )}
        </section>
        <Link to="/" className="tool-secondary-action">{copy.features.back_home}</Link>
      </div>
    </main>
  )
}

function DeletionAcceptedPanel({ deletion, onLeave }: { deletion: AccountDeletionAccepted; onLeave: () => void }) {
  return (
    <div role="status" aria-live="polite">
      <h2 className="text-lg font-semibold text-ink-primary">{copy.features.delete_accepted_title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">
        {copy.features.delete_accepted_before}<strong>{formatAccountDeletionDeadline(deletion.scheduled_for)}</strong>{copy.features.delete_accepted_after}
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-secondary">{deletionEmailMessage(deletion.cancellation_email)}</p>
      <button type="button" onClick={onLeave} className="tool-primary-action mt-5">{copy.features.delete_accepted_leave}</button>
    </div>
  )
}
