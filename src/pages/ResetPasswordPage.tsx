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
    <main className="tool-shell flex min-h-dvh items-center justify-center px-4 py-6 sm:px-6 sm:py-10" tabIndex={-1} data-route-focus>
      <form onSubmit={handleSubmit} noValidate className="tool-panel w-full max-w-md p-6 sm:p-8">
        <p className="tool-eyebrow">账号安全</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink-primary">重置密码</h1>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">设置新密码后可返回工作台继续管理账号和排班数据。</p>

        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
        {notice && <div className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{notice}</div>}

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
                autoComplete="new-password"
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
                autoComplete="new-password"
              />
              {fieldErrors.confirmPassword && <p id="reset-confirm-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.confirmPassword}</p>}
            </label>

            <button type="submit" disabled={!token || loading} className="tool-primary-action mt-6 w-full">
              {loading ? '重置中...' : '重置密码'}
            </button>
          </>
        )}

        <Link to="/tool/profiles" className="mt-5 inline-flex min-h-11 w-full items-center justify-center text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
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
  return hasError ? 'tool-field border-error/70' : 'tool-field'
}
