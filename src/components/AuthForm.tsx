import { useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../lib/types'
import { ApiError, apiJson } from '../lib/api-client'

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
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get('invite')?.trim().toUpperCase() ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

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
          fallbackMessage: '发送重置邮件失败',
        })
        setNotice(data.message || '如果该邮箱已注册，我们会发送重置密码邮件。')
        return
      }

      const data = await apiJson<AuthSuccessResponse>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        json: mode === 'login' ? { email, password } : {
          email,
          password,
          cdk: allowCdk ? cdk.trim() || undefined : undefined,
          invite_code: inviteCode.trim() || undefined,
        },
        fallbackMessage: mode === 'login' ? '登录失败' : '注册失败',
      })
      if (!data.user) throw new Error(mode === 'login' ? '登录失败' : '注册失败')
      onAuthenticated(data)
    } catch (caught) {
      if (mode === 'register' && caught instanceof ApiError && isInviteCodeError(caught.data)) {
        setFieldErrors((current) => ({ ...current, inviteCode: caught.message }))
      }
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
      <div className="tool-inset grid grid-cols-2 p-1" role="group" aria-label="登录方式">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null); setNotice(null) }} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>登录</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(null); setNotice(null) }} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>注册</button>
      </div>

      {intro && <p className="text-sm leading-6 text-ink-secondary">{intro}</p>}
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}
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
        {fieldErrors.email && <p id="auth-email-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.email}</p>}
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
          {fieldErrors.password && <p id="auth-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.password}</p>}
        </label>
      )}

      {allowCdk && mode === 'register' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK（可选）</span>
          <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="tool-field min-h-11 font-mono uppercase tracking-wide" placeholder="可注册后再兑换" />
        </label>
      )}

      {mode === 'register' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">邀请码（可选）</span>
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
            placeholder="10 位邀请码"
            aria-invalid={Boolean(fieldErrors.inviteCode)}
            aria-describedby={fieldErrors.inviteCode ? 'auth-invite-code-error' : undefined}
          />
          {fieldErrors.inviteCode && <p id="auth-invite-code-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.inviteCode}</p>}
        </label>
      )}

      {mode === 'login' && (
        <button type="button" onClick={() => { setMode('forgot'); setError(null); setNotice(null); setFieldErrors({}) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          忘记密码？
        </button>
      )}
      {mode === 'forgot' && (
        <button type="button" onClick={() => { setMode('login'); setError(null); setNotice(null); setFieldErrors({}) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          返回登录
        </button>
      )}

      <button type="submit" disabled={loading} className={`min-h-12 ${submitClassName ?? 'tool-primary-action w-full px-6 py-3'}`}>
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

function validateInviteCodeInput(value: string): string | null {
  const code = value.trim().toUpperCase()
  if (!code) return null
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(code) ? null : '请输入有效的 10 位邀请码'
}

function isInviteCodeError(data: unknown): boolean {
  if (!data || typeof data !== 'object' || !('code' in data)) return false
  const code = (data as { code?: unknown }).code
  return code === 'invalid_invite_code' || code === 'invitation_campaign_paused'
}

function inputClassName(hasError: boolean): string {
  const base = 'tool-field min-h-11'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : ''
  return `${base} ${state}`
}
