import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { apiVoid } from '../lib/api-client'

type FieldErrors = Record<string, string>

export default function ResetPasswordPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(token ? null : '重置链接无效或已过期。')
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return

    const nextErrors: FieldErrors = {}
    const passwordError = validatePasswordInput(password)
    if (passwordError) nextErrors.password = passwordError
    if (!confirmPassword) nextErrors.confirmPassword = '请再次输入新密码'
    if (password && confirmPassword && password !== confirmPassword) {
      nextErrors.confirmPassword = '两次输入的密码不一致'
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
        fallbackMessage: '重置密码失败',
      })
      setPassword('')
      setConfirmPassword('')
      setNotice('密码已重置，请使用新密码登录。')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-6 py-10 text-ink-primary" tabIndex={-1} data-route-focus>
      <form onSubmit={handleSubmit} noValidate className="w-full max-w-md rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
        <p className="text-sm font-semibold text-brand-500">MAA Infrast</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink-primary">重置密码</h1>

        {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
        {notice && <div className="mt-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>}

        {!notice && (
          <>
            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
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
              />
              {fieldErrors.password && <p id="reset-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.password}</p>}
            </label>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">确认新密码</span>
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
              />
              {fieldErrors.confirmPassword && <p id="reset-confirm-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.confirmPassword}</p>}
            </label>

            <button type="submit" disabled={!token || loading} className="mt-6 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              {loading ? '重置中...' : '重置密码'}
            </button>
          </>
        )}

        <Link to="/tool/profiles" className="mt-5 block text-center text-sm font-medium text-brand-500 underline-offset-4 hover:underline">
          返回登录
        </Link>
      </form>
    </main>
  )
}

function validatePasswordInput(value: string): string | null {
  if (!value) return '请输入密码'
  if (value.length < 8) return '密码至少需要 8 位'
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
  const base = 'w-full rounded-lg border px-3 py-2 text-sm text-ink-primary outline-none transition-colors duration-150 focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : 'border-surface-4 bg-surface-0 focus:border-brand-500 focus:ring-brand-500/20'
  return `${base} ${state}`
}
