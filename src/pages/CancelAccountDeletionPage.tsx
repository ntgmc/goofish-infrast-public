import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiVoid } from '../lib/api-client'
import { copy } from '../copy/index'
import ThemeSwitcher from '../components/ThemeSwitcher'


export default function CancelAccountDeletionPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(token ? null : copy.auth.pages_CancelAccountDeletionPage_001)
  const [loading, setLoading] = useState(false)

  const cancel = async () => {
    if (!token || loading || status) return
    setLoading(true); setError(null)
    try {
      await apiVoid('/api/user/data/cancel', { method: 'POST', json: { token } })
      setStatus(copy.auth.pages_CancelAccountDeletionPage_002)
    } catch (caught) { setError((caught as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <main className="tool-shell flex min-h-dvh items-center justify-center px-4 py-6 sm:px-6" tabIndex={-1} data-route-focus>
      <section className="tool-panel w-full max-w-lg p-6 sm:p-8" aria-labelledby="cancel-account-deletion-title">
        <div className="flex items-center justify-between gap-3">
          <p className="tool-eyebrow">{copy.auth.pages_CancelAccountDeletionPage_003}</p>
          <ThemeSwitcher />
        </div>
        <h1 id="cancel-account-deletion-title" className="mt-2 text-2xl font-semibold text-ink-primary">{copy.auth.pages_CancelAccountDeletionPage_004}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.auth.pages_CancelAccountDeletionPage_005}</p>
        {error && <p className="tool-alert tool-alert--error mt-5" role="alert">{error}</p>}
        {status && <p className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{status}</p>}
        <button type="button" disabled={!token || loading || Boolean(status)} onClick={() => void cancel()} className="tool-primary-action mt-5 w-full">
          {loading ? copy.auth.pages_CancelAccountDeletionPage_006 : copy.auth.pages_CancelAccountDeletionPage_007}
        </button>
        <Link to="/tool/profiles" className="mt-5 inline-flex min-h-11 w-full items-center justify-center text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
          {copy.auth.pages_CancelAccountDeletionPage_008}</Link>
      </section>
    </main>
  )
}
