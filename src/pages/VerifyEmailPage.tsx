import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { AuthSuccessResponse } from '../lib/types'
import { apiJson } from '../lib/api-client'
import { copy } from '../copy/index'

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
  const navigate = useNavigate()
  const token = searchParams.get('token')?.trim() ?? ''
  const [state, setState] = useState<VerificationState>(token ? 'loading' : 'error')
  const [error, setError] = useState<string | null>(token ? null : copy.auth.pages_VerifyEmailPage_001)
  const attemptRef = useRef(0)

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
  useEffect(() => {
    if (state !== 'success') return
    const timer = window.setTimeout(() => navigate('/tool/profiles', { replace: true }), 500)
    return () => window.clearTimeout(timer)
  }, [navigate, state])

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-5 py-12 sm:px-8" tabIndex={-1} data-route-focus>
      <section className="tool-panel w-full p-6 sm:p-8" aria-labelledby="verify-email-title">
        <p className="section-index">{copy.auth.pages_VerifyEmailPage_004}</p>
        <h1 id="verify-email-title" className="display-title mt-2 text-2xl text-ink-primary">{copy.auth.pages_VerifyEmailPage_005}</h1>
        <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy.auth.pages_VerifyEmailPage_006}</p>

        {state === 'loading' && <div className="tool-alert mt-6" role="status" aria-live="polite">{copy.auth.pages_VerifyEmailPage_002}</div>}
        {state === 'success' && <div className="tool-alert tool-alert--success mt-6" role="status" aria-live="polite">{copy.auth.pages_VerifyEmailPage_003}</div>}
        {state === 'error' && error && <div className="tool-alert tool-alert--error mt-6" role="alert">{error}</div>}

        {state === 'error' && token && (
          <button type="button" onClick={() => verify()} className="tool-primary-action mt-6 min-h-11 w-full">
            {copy.auth.pages_VerifyEmailPage_007}
          </button>
        )}
        {state === 'error' && (
          <Link to="/tool/profiles" className="tool-secondary-action mt-3 flex min-h-11 w-full items-center justify-center px-4 text-sm">
            {copy.auth.pages_VerifyEmailPage_008}
          </Link>
        )}
      </section>
    </main>
  )
}
