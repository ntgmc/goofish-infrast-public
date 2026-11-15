import { useCallback, useEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import AuthForm from '../../components/AuthForm'
import { copy } from '../../copy'
import { authModeForPath, authPath, rememberAuthReturn, safeAuthReturn } from '../../lib/auth-navigation'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { AuthSuccessResponse } from '../../lib/types'
import { useToolSession } from '../tool/useToolSession'
import V2LoadingScreen from './V2LoadingScreen'
import AuthLayout from './AuthLayout'

export default function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const mode = authModeForPath(location.pathname) ?? 'login'
  const params = new URLSearchParams(location.search)
  const invite = params.get('invite') ?? new URLSearchParams(location.hash.slice(1)).get('invite')
  const returnTo = params.has('return_to') ? safeAuthReturn(params.get('return_to')) : '/v2'
  const session = useToolSession(undefined, false, false)
  const features = useSiteFeatures()
  const checked = useRef(false)
  if (session.authStatus !== 'loading') checked.current = true
  useEffect(() => { rememberAuthReturn(returnTo) }, [returnTo])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') session.retryAuth() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [session.retryAuth])
  const authenticated = useCallback((payload: AuthSuccessResponse) => {
    session.applyAuthPayload(payload)
    void navigate(returnTo, { replace: true })
  }, [navigate, returnTo, session.applyAuthPayload])

  if (mode !== 'forgot' && session.authStatus === 'authenticated') return <Navigate to={returnTo} replace />
  if (features.status === 'loading' || (!checked.current && session.authStatus === 'loading')) return <V2LoadingScreen />
  if (features.status === 'error') return <V2LoadingScreen error={copy.features.load_failed_body} onRetry={features.retry} retryLabel={copy.features.retry} />
  const title = mode === 'register' ? copy.auth.registerTitle : mode === 'forgot' ? copy.auth.forgotTitle : copy.auth.pageTitle
  const description = mode === 'register' ? copy.auth.registerDescription : mode === 'forgot' ? copy.auth.forgotDescription : copy.auth.pageDescription
  return <AuthLayout title={title} description={description} returnTo={returnTo}>
    {session.authStatus === 'error' && <div className="tool-alert tool-alert--error mb-4" role="alert">{copy.v2.loginServiceUnavailable}<button type="button" className="v2-text-button" onClick={session.retryAuth}>{copy.v2.loginRetry}</button></div>}
    {session.authStatus !== 'error' && <AuthForm compact animateActions allowCdk={false} mode={mode} collapseOptionalInvite invitationCode={invite ?? undefined} onModeChange={(next) => { void navigate(authPath(next, returnTo, invite ?? undefined)) }} onAuthenticated={authenticated} submitClassName="v2-button v2-button-primary w-full" />}
  </AuthLayout>
}
