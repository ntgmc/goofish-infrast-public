import { useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../lib/types'
import { ApiError, apiJson } from '../lib/api-client'
import { copy } from '../copy/index'


type AuthMode = 'login' | 'register' | 'forgot'
type FieldErrors = Record<string, string>
type VerificationRequiredResponse = {
  verification_required: true
  message: string
  resend_after_seconds: number
}

type AuthFormProps = {
  onAuthenticated: (payload: AuthSuccessResponse) => void
  allowCdk?: boolean
  compact?: boolean
  intro?: string
  submitClassName?: string
}

export default function AuthForm({
  onAuthenticated,
  allowCdk = true,
  compact = false,
  intro,
  submitClassName,
}: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cdk, setCdk] = useState('')
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get('invite')?.trim().toUpperCase() ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [showVerificationResend, setShowVerificationResend] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const emailError = validateEmailInput(email)
    const passwordError = mode === 'forgot' ? null : validatePasswordInput(password)
    const inviteCodeError = mode === 'register' ? validateInviteCodeInput(inviteCode) : null
    if (emailError) nextErrors.email = emailError
    if (passwordError) nextErrors.password = passwordError
    if (inviteCodeError) nextErrors.inviteCode = inviteCodeError
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        const data = await apiJson<{ message?: string }>('/api/auth/forgot-password', {
          method: 'POST',
          json: { email },
          fallbackMessage: copy.auth.components_AuthForm_001,
        })
        setNotice(data.message || copy.auth.components_AuthForm_002)
        return
      }

      const data = await apiJson<AuthSuccessResponse | VerificationRequiredResponse>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        json: mode === 'login' ? { email, password } : {
          email,
          password,
          cdk: allowCdk ? cdk.trim() || undefined : undefined,
          invite_code: inviteCode.trim() || undefined,
        },
        fallbackMessage: mode === 'login' ? copy.auth.components_AuthForm_003 : copy.auth.components_AuthForm_004,
      })
      if ('verification_required' in data) {
        setNotice(data.message || copy.auth.components_AuthForm_028)
        setShowVerificationResend(true)
        return
      }
      if (!data.user) throw new Error(mode === 'login' ? copy.auth.components_AuthForm_005 : copy.auth.components_AuthForm_006)
      onAuthenticated(data)
    } catch (caught) {
      if (mode === 'register' && caught instanceof ApiError && isInviteCodeError(caught.data)) {
        setFieldErrors((current) => ({ ...current, inviteCode: caught.message }))
      }
      if (caught instanceof ApiError && (
        isApiErrorCode(caught.data, 'email_not_verified')
        || isApiErrorCode(caught.data, 'verification_email_send_failed')
      )) setShowVerificationResend(true)
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const resendVerification = async () => {
    const emailError = validateEmailInput(email)
    if (emailError) {
      setFieldErrors((current) => ({ ...current, email: emailError }))
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ message?: string }>('/api/auth/resend-verification', {
        method: 'POST',
        json: { email },
        fallbackMessage: copy.auth.components_AuthForm_029,
      })
      setNotice(data.message || copy.auth.components_AuthForm_030)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={compact ? 'space-y-4' : 'tool-panel space-y-5 p-6 sm:p-8'}>
      <div className="tool-inset grid grid-cols-2 p-1" role="group" aria-label={copy.auth.components_AuthForm_007}>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null); setNotice(null); setShowVerificationResend(false) }} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>{copy.auth.components_AuthForm_008}</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(null); setNotice(null); setShowVerificationResend(false) }} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>{copy.auth.components_AuthForm_009}</button>
      </div>

      {intro && <p className="text-sm leading-6 text-ink-secondary">{intro}</p>}
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}
      {mode === 'forgot' && <h2 className="text-lg font-semibold text-ink-primary">{copy.auth.components_AuthForm_010}</h2>}

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_011}</span>
        <input
          id={compact ? 'depot-auth-email' : 'auth-email'}
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value)
            clearFieldError('email')
          }}
          onFocus={() => clearFieldError('email')}
          className={inputClassName(Boolean(fieldErrors.email))}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
          autoComplete="email"
        />
        {fieldErrors.email && <p id="auth-email-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.email}</p>}
      </label>

      {mode !== 'forgot' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_012}</span>
          <input
            id={compact ? 'depot-auth-password' : 'auth-password'}
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.currentTarget.value)
              clearFieldError('password')
            }}
            onFocus={() => clearFieldError('password')}
            className={inputClassName(Boolean(fieldErrors.password))}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
          {fieldErrors.password && <p id="auth-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.password}</p>}
        </label>
      )}

      {allowCdk && mode === 'register' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_013}</span>
          <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="tool-field min-h-11 font-mono uppercase tracking-wide" placeholder={copy.auth.components_AuthForm_014} />
        </label>
      )}

      {mode === 'register' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_015}</span>
          <input
            id={compact ? 'depot-auth-invite-code' : 'auth-invite-code'}
            type="text"
            value={inviteCode}
            maxLength={10}
            onChange={(event) => {
              setInviteCode(event.currentTarget.value.toUpperCase())
              clearFieldError('inviteCode')
            }}
            onFocus={() => clearFieldError('inviteCode')}
            className={`${inputClassName(Boolean(fieldErrors.inviteCode))} font-mono uppercase tracking-wide`}
            placeholder={copy.auth.components_AuthForm_016}
            aria-invalid={Boolean(fieldErrors.inviteCode)}
            aria-describedby={fieldErrors.inviteCode ? 'auth-invite-code-error' : undefined}
          />
          {fieldErrors.inviteCode && <p id="auth-invite-code-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.inviteCode}</p>}
        </label>
      )}

      {mode === 'login' && (
        <button type="button" onClick={() => { setMode('forgot'); setError(null); setNotice(null); setFieldErrors({}) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          {copy.auth.components_AuthForm_017}</button>
      )}
      {mode === 'forgot' && (
        <button type="button" onClick={() => { setMode('login'); setError(null); setNotice(null); setFieldErrors({}) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          {copy.auth.components_AuthForm_018}</button>
      )}

      {showVerificationResend && mode !== 'forgot' && (
        <button type="button" disabled={loading} onClick={() => void resendVerification()} className="tool-secondary-action min-h-11 w-full px-4 text-sm">
          {loading ? copy.auth.components_AuthForm_019 : copy.auth.components_AuthForm_031}
        </button>
      )}

      <button type="submit" disabled={loading} className={`min-h-12 ${submitClassName ?? 'tool-primary-action w-full px-6 py-3'}`}>
        {loading ? copy.auth.components_AuthForm_019 : mode === 'login' ? copy.auth.components_AuthForm_020 : mode === 'register' ? copy.auth.components_AuthForm_021 : copy.auth.components_AuthForm_022}
      </button>
    </form>
  )
}

function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return copy.auth.components_AuthForm_023
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return copy.auth.components_AuthForm_024
  return null
}

function validatePasswordInput(value: string): string | null {
  if (!value) return copy.auth.components_AuthForm_025
  if (value.length < 8) return copy.auth.components_AuthForm_026
  return null
}

function validateInviteCodeInput(value: string): string | null {
  const code = value.trim().toUpperCase()
  if (!code) return null
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(code) ? null : copy.auth.components_AuthForm_027
}

function isInviteCodeError(data: unknown): boolean {
  if (!data || typeof data !== 'object' || !('code' in data)) return false
  const code = (data as { code?: unknown }).code
  return code === 'invalid_invite_code' || code === 'invitation_campaign_paused'
}

function isApiErrorCode(data: unknown, expected: string): boolean {
  if (!data || typeof data !== 'object' || !('code' in data)) return false
  return (data as { code?: unknown }).code === expected
}

function inputClassName(hasError: boolean): string {
  const base = 'tool-field min-h-11'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : ''
  return `${base} ${state}`
}
