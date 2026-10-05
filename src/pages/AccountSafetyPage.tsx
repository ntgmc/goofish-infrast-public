import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import SessionLoader from '../components/SessionLoader'
import SettingsSection from './tool/dashboard/SettingsSection'
import { apiVoid } from '../lib/api-client'
import { dashboardPath } from '../lib/app-routes'
import { useSiteFeatures } from '../lib/site-feature-context'
import { copy } from '../copy/index'

export default function AccountSafetyPage() {
  const navigate = useNavigate()
  const featureState = useSiteFeatures()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletionState, setDeletionState] = useState<'idle' | 'submitting' | 'accepted'>('idle')

  const logout = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiVoid('/api/auth/logout', { method: 'POST' })
      setNotice(copy.features.logout_done)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.features.logout)
    } finally {
      setBusy(false)
    }
  }

  if (featureState.status === 'loading') return <SessionLoader label={copy.features.loading} />
  if (featureState.status === 'ready' && featureState.features.site && featureState.features.login) {
    return <Navigate to={dashboardPath('settings')} replace />
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
            <button type="button" onClick={() => void logout()} disabled={busy || deletionState !== 'idle'} className="tool-secondary-action">{copy.features.logout}</button>
            <Link to="/tool/profiles?recovery=1" className="tool-secondary-action">{copy.features.recovery}</Link>
          </div>
        </section>
        <fieldset disabled={busy} className="min-w-0">
          <SettingsSection safetyOnly profiles={[]} onPayload={() => undefined} onDeletionStateChange={setDeletionState} onLogout={() => { void navigate('/', { replace: true }) }} />
        </fieldset>
        <Link to="/" className="tool-secondary-action">{copy.features.back_home}</Link>
      </div>
    </main>
  )
}
