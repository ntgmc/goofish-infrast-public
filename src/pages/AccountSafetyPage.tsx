import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router'
import V2LoadingScreen from './v2/V2LoadingScreen'
import PublicPageLayout from './v2/PublicPageLayout'
import AccountDataSettings from './v2/AccountDataSettings'
import { useAccountSettings } from '../hooks/useAccountSettings'
import { Notice } from './v2/components/WorkspaceUI'
import { apiVoid } from '../lib/api-client'
import { formatAccountDeletionDeadline } from '../lib/account-lifecycle-client'
import { authPath } from '../lib/auth-navigation'
import { useSiteFeatures } from '../lib/site-feature-context'
import { copy } from '../copy/index'

export default function AccountSafetyPage() {
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const scheduledFor = params.get('scheduled_for')
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
      queryClient.removeQueries({ queryKey: ['user'] })
      setNotice(copy.features.logout_done)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.features.logout)
    } finally {
      setBusy(false)
    }
  }

  if (scheduledFor && Number.isFinite(Date.parse(scheduledFor))) {
    return <PublicPageLayout title={copy.features.delete_accepted_title}>
      <section className="v2-safety-content" role="status">
        <p>{copy.features.delete_signed_out}</p>
        <p>{copy.features.delete_accepted_before}<strong>{formatAccountDeletionDeadline(scheduledFor)}</strong>{copy.features.delete_accepted_after}</p>
        <Link to="/v2" className="v2-button v2-button-primary">{copy.features.delete_accepted_leave}</Link>
      </section>
    </PublicPageLayout>
  }

  if (featureState.status === 'loading') return <V2LoadingScreen />
  if (featureState.status === 'ready' && featureState.features.site && featureState.features.login && featureState.features.v2) {
    return <Navigate to={authPath('login', '/v2?section=settings')} replace />
  }

  return <PublicPageLayout title={copy.features.account_safety_title} description={copy.features.account_safety_body}>
    <div className="v2-safety-content">
      <Notice error>{error}</Notice><Notice>{notice}</Notice>
      <div className="v2-actions">
        <button type="button" onClick={() => void logout()} disabled={busy || deletionState !== 'idle'} className="v2-button v2-button-secondary">{copy.features.logout}</button>
        <Link to={authPath('forgot', '/v2?section=settings')} className="v2-button v2-button-secondary">{copy.features.recovery}</Link>
      </div>
      <fieldset disabled={busy}><SafetySettings onDeletionStateChange={setDeletionState} /></fieldset>
      <Link to="/v2" className="v2-button v2-button-secondary">{copy.features.back_home}</Link>
    </div>
  </PublicPageLayout>
}

function SafetySettings({ onDeletionStateChange }: { onDeletionStateChange: (state: 'idle' | 'submitting' | 'accepted') => void }) {
  const model = useAccountSettings({ profiles: [], onPayload: () => undefined, onDeletionStateChange })
  return <AccountDataSettings model={model} safetyOnly />
}
