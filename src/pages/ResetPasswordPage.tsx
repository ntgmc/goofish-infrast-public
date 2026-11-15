import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Link } from 'react-router'
import { apiVoid } from '../lib/api-client'
import { copy } from '../copy/index'
import AuthLayout from './v2/AuthLayout'
import { authPath, readAuthReturn } from '../lib/auth-navigation'
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../lib/auth-constraints'


type FieldErrors = Record<string, string>

export default function ResetPasswordPage() {
  const [returnTo] = useState(readAuthReturn)
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(token ? null : copy.auth.pages_ResetPasswordPage_001)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return

    const nextErrors: FieldErrors = {}
    const passwordError = validatePasswordInput(password)
    if (passwordError) nextErrors.password = passwordError
    if (!confirmPassword) nextErrors.confirmPassword = copy.auth.pages_ResetPasswordPage_002
    else if (confirmPassword.length > AUTH_PASSWORD_MAX_LENGTH) {
      nextErrors.confirmPassword = copy.auth.pages_ResetPasswordPage_016
    }
    else if (password && password !== confirmPassword) {
      nextErrors.confirmPassword = copy.auth.pages_ResetPasswordPage_003
    }
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await apiVoid('/api/auth/reset-password', {
        method: 'POST',
        json: { token, new_password: password },
        fallbackMessage: copy.auth.pages_ResetPasswordPage_004,
      })
      setPassword('')
      setConfirmPassword('')
      setNotice(copy.auth.pages_ResetPasswordPage_005)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title={copy.auth.pages_ResetPasswordPage_007} description={copy.auth.pages_ResetPasswordPage_008} returnTo={returnTo}>
      <form onSubmit={handleSubmit} noValidate>

        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
        {notice && <div className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{notice}</div>}

        {!notice && (
          <>
            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.pages_ResetPasswordPage_009}</span>
              <input
                type="password"
                value={password}
                maxLength={AUTH_PASSWORD_MAX_LENGTH}
                onChange={(event) => {
                  setPassword(event.currentTarget.value)
                  clearFieldError(setFieldErrors, 'password')
                }}
                onFocus={() => clearFieldError(setFieldErrors, 'password')}
                disabled={!token || loading}
                className={inputClassName(Boolean(fieldErrors.password))}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'reset-password-error' : undefined}
                autoComplete="new-password"
              />
              <p id="reset-password-error" className={`auth-field-message ${fieldErrors.password ? '' : 'invisible'}`} aria-hidden={!fieldErrors.password}>{fieldErrors.password ?? '\u00A0'}</p>
            </label>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.pages_ResetPasswordPage_010}</span>
              <input
                type="password"
                value={confirmPassword}
                maxLength={AUTH_PASSWORD_MAX_LENGTH}
                onChange={(event) => {
                  setConfirmPassword(event.currentTarget.value)
                  clearFieldError(setFieldErrors, 'confirmPassword')
                }}
                onFocus={() => clearFieldError(setFieldErrors, 'confirmPassword')}
                disabled={!token || loading}
                className={inputClassName(Boolean(fieldErrors.confirmPassword))}
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? 'reset-confirm-password-error' : undefined}
                autoComplete="new-password"
              />
              <p id="reset-confirm-password-error" className={`auth-field-message ${fieldErrors.confirmPassword ? '' : 'invisible'}`} aria-hidden={!fieldErrors.confirmPassword}>{fieldErrors.confirmPassword ?? '\u00A0'}</p>
            </label>

            <button type="submit" disabled={!token || loading} className="tool-primary-action mt-6 w-full">
              {loading ? copy.auth.pages_ResetPasswordPage_011 : copy.auth.pages_ResetPasswordPage_012}
            </button>
          </>
        )}

        {!notice && <Link to={authPath('forgot', returnTo)} className="mt-5 inline-flex min-h-11 w-full items-center justify-center text-sm font-medium underline">{copy.auth.components_AuthForm_022}</Link>}
        <Link to={authPath('login', returnTo)} className="v2-text-button mt-5 min-h-11 w-full justify-center">
          {notice ? copy.auth.goToLogin : copy.auth.pages_ResetPasswordPage_013}</Link>
      </form>
    </AuthLayout>
  )
}

function validatePasswordInput(value: string): string | null {
  if (!value) return copy.auth.pages_ResetPasswordPage_014
  if (value.length < AUTH_PASSWORD_MIN_LENGTH) return copy.auth.pages_ResetPasswordPage_015
  if (value.length > AUTH_PASSWORD_MAX_LENGTH) return copy.auth.pages_ResetPasswordPage_016
  return null
}

function clearFieldError(setFieldErrors: Dispatch<SetStateAction<FieldErrors>>, field: string) {
  setFieldErrors((current) => {
    if (!current[field]) return current
    const next = { ...current }
    delete next[field]
    return next
  })
}

function inputClassName(hasError: boolean): string {
  return hasError ? 'tool-field border-error/70' : 'tool-field'
}
