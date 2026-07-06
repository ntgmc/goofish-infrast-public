import { useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../lib/types'

type AuthMode = 'login' | 'register' | 'forgot'
type FieldErrors = Record<string, string>

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const emailError = validateEmailInput(email)
    const passwordError = mode === 'forgot' ? null : validatePasswordInput(password)
    if (emailError) nextErrors.email = emailError
    if (passwordError) nextErrors.password = passwordError
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        const resp = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const data = await resp.json() as { error?: string; message?: string }
        if (!resp.ok) throw new Error(data.error || `发送重置邮件失败: ${resp.status}`)
        setNotice(data.message || '如果该邮箱已注册，我们会发送重置密码邮件。')
        return
      }

      const resp = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { email, password, cdk: allowCdk ? cdk.trim() || undefined : undefined }),
      })
      const data = await resp.json() as AuthSuccessResponse & { error?: string }
      if (!resp.ok || !data.user) throw new Error(data.error || `${mode === 'login' ? '登录' : '注册'}失败: ${resp.status}`)
      onAuthenticated(data)
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
    <form onSubmit={handleSubmit} noValidate className={compact ? 'space-y-4' : 'space-y-5 rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8'}>
      <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-1">
        <button type="button" onClick={() => { setMode('login'); setError(null); setNotice(null) }} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>登录</button>
        <button type="button" onClick={() => { setMode('register'); setError(null); setNotice(null) }} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>注册</button>
      </div>

      {intro && <p className="text-sm leading-6 text-ink-secondary">{intro}</p>}
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {notice && <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>}
      {mode === 'forgot' && <h2 className="text-lg font-semibold text-ink-primary">重置密码</h2>}

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">邮箱</span>
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
        />
        {fieldErrors.email && <p id="auth-email-error" className="mt-1.5 text-sm text-error">{fieldErrors.email}</p>}
      </label>

      {mode !== 'forgot' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">密码</span>
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
          />
          {fieldErrors.password && <p id="auth-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.password}</p>}
        </label>
      )}

      {allowCdk && mode === 'register' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK（可选）</span>
          <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" placeholder="可注册后再兑换" />
        </label>
      )}

      {mode === 'login' && (
        <button type="button" onClick={() => { setMode('forgot'); setError(null); setNotice(null); setFieldErrors({}) }} className="text-sm font-medium text-brand-500 underline-offset-4 hover:underline">
          忘记密码？
        </button>
      )}
      {mode === 'forgot' && (
        <button type="button" onClick={() => { setMode('login'); setError(null); setNotice(null); setFieldErrors({}) }} className="text-sm font-medium text-brand-500 underline-offset-4 hover:underline">
          返回登录
        </button>
      )}

      <button type="submit" disabled={loading} className={submitClassName ?? 'w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted'}>
        {loading ? '处理中...' : mode === 'login' ? '登录' : mode === 'register' ? '创建账号' : '发送重置邮件'}
      </button>
    </form>
  )
}

function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入正确的邮箱地址'
  return null
}

function validatePasswordInput(value: string): string | null {
  if (!value) return '请输入密码'
  if (value.length < 8) return '密码至少需要 8 位'
  return null
}

function inputClassName(hasError: boolean): string {
  const base = 'w-full rounded-lg border px-3 py-2 text-sm text-ink-primary outline-none transition-colors duration-150 focus:ring-2'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : 'border-surface-4 bg-surface-0 focus:border-brand-500 focus:ring-brand-500/20'
  return `${base} ${state}`
}
