import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { AuthSuccessResponse } from '../lib/types'
import { apiJson } from '../lib/api-client'
import { copy } from '../copy/index'
import { authPath, readAuthReturn } from '../lib/auth-navigation'
import AuthLayout from './v2/AuthLayout'

type VerificationState = 'loading' | 'success' | 'error'

const inFlightVerificationRequests = new Map<string, Promise<AuthSuccessResponse>>()

function requestEmailVerification(token: string): Promise<AuthSuccessResponse> {
  const existing = inFlightVerificationRequests.get(token)
  if (existing) return existing
  const request = apiJson<AuthSuccessResponse>('/api/auth/verify-email', {
    method: 'POST',
    json: { token },
    fallbackMessage: copy.auth.pages_VerifyEmailPage_001,
  })
  inFlightVerificationRequests.set(token, request)
  void request.then(
    () => {
      if (inFlightVerificationRequests.get(token) === request) inFlightVerificationRequests.delete(token)
    },
    () => {
      if (inFlightVerificationRequests.get(token) === request) inFlightVerificationRequests.delete(token)
    },
  )
  return request
}

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const [state, setState] = useState<VerificationState>(token ? 'loading' : 'error')
  const [error, setError] = useState<string | null>(token ? null : copy.auth.pages_VerifyEmailPage_001)
  const attemptRef = useRef(0)
  const [returnPath] = useState(readAuthReturn)

  const verify = useCallback((isCancelled: () => boolean = () => false) => {
    if (!token) return
    const attempt = ++attemptRef.current
    setState('loading')
    setError(null)
    void requestEmailVerification(token).then(
      () => {
        if (isCancelled() || attemptRef.current !== attempt) return
        setState('success')
      },
      (caught: unknown) => {
        if (isCancelled() || attemptRef.current !== attempt) return
        setError(caught instanceof Error ? caught.message : copy.auth.pages_VerifyEmailPage_001)
        setState('error')
      },
    )
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    verify(() => cancelled)
    return () => { cancelled = true }
  }, [token, verify])

  return (
    <AuthLayout title={copy.auth.pages_VerifyEmailPage_005} description={copy.auth.pages_VerifyEmailPage_006} backTo={returnPath}>

        {state === 'loading' && <div className="tool-alert mt-6" role="status" aria-live="polite">{copy.auth.pages_VerifyEmailPage_002}</div>}
        {state === 'success' && <div className="tool-alert tool-alert--success mt-6" role="status" aria-live="polite">{copy.auth.pages_VerifyEmailPage_003}</div>}
        {state === 'error' && error && <div className="tool-alert tool-alert--error mt-6" role="alert">{error}</div>}

        {state === 'error' && token && (
          <button type="button" onClick={() => verify()} className="tool-primary-action mt-6 min-h-11 w-full">
            {copy.auth.pages_VerifyEmailPage_007}
          </button>
        )}
        {state === 'success' && <Link to={returnPath} className="v2-button v2-button-primary mt-6 w-full">{copy.auth.enterWorkspace}</Link>}
        {state === 'error' && (
          <Link to={authPath('login', returnPath)} className="tool-secondary-action mt-3 flex min-h-11 w-full items-center justify-center px-4 text-sm">
            {copy.auth.pages_VerifyEmailPage_008}
          </Link>
        )}
    </AuthLayout>
  )
}
