import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Link } from 'react-router'
import { apiVoid } from '../lib/api-client'
import { copy } from '../copy/index'
import ThemeSwitcher from '../components/ThemeSwitcher'


type FieldErrors = Record<string, string>

export default function ResetPasswordPage() {
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
    if (password && confirmPassword && password !== confirmPassword) {
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
    <main className="tool-shell flex min-h-dvh items-center justify-center px-4 py-6 sm:px-6 sm:py-10" tabIndex={-1} data-route-focus>
      <form onSubmit={handleSubmit} noValidate className="tool-panel w-full max-w-md p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="section-index">{copy.auth.pages_ResetPasswordPage_006}</p>
          <ThemeSwitcher />
        </div>
        <h1 className="display-title mt-2 text-2xl text-ink-primary">{copy.auth.pages_ResetPasswordPage_007}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.auth.pages_ResetPasswordPage_008}</p>

        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
        {notice && <div className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{notice}</div>}

        {!notice && (
          <>
            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.pages_ResetPasswordPage_009}</span>
              <input
                type="password"
                value={password}
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

        <Link to="/tool/profiles" className="mt-5 inline-flex min-h-11 w-full items-center justify-center text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
          {copy.auth.pages_ResetPasswordPage_013}</Link>
      </form>
    </main>
  )
}

function validatePasswordInput(value: string): string | null {
  if (!value) return copy.auth.pages_ResetPasswordPage_014
  if (value.length < 8) return copy.auth.pages_ResetPasswordPage_015
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
