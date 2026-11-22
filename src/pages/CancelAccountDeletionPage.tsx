import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { apiVoid } from '../lib/api-client'
import { copy } from '../copy/index'
import AuthLayout from './v2/AuthLayout'


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
    <AuthLayout title={copy.auth.pages_CancelAccountDeletionPage_004} description={copy.auth.pages_CancelAccountDeletionPage_005}>
      <div className="grid gap-4">
        {error && <p className="v2-feedback v2-feedback-error" role="alert">{error}</p>}
        {status && <p className="v2-feedback" role="status" aria-live="polite">{status}</p>}
        <button type="button" disabled={!token || loading || Boolean(status)} onClick={() => void cancel()} className="v2-button v2-button-primary w-full">
          {loading ? copy.auth.pages_CancelAccountDeletionPage_006 : copy.auth.pages_CancelAccountDeletionPage_007}
        </button>
        <Link to="/login" className="v2-button v2-button-secondary w-full">{copy.auth.pages_CancelAccountDeletionPage_008}</Link>
      </div>
    </AuthLayout>
  )
}
