import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AuthSuccessResponse, RecoveryAcceptedResponse, RegistrationAcceptedResponse } from '../lib/types'
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_RESEND_COOLDOWN_SECONDS,
} from '../lib/auth-constraints'
import { useQuery } from '@tanstack/react-query'
import { ApiError, apiJson } from '../lib/api-client'
import {
  validateRegistrationEmail,
  type RegistrationEmailValidation,
} from '../lib/registration-email-policy'
import { copy } from '../copy/index'
import { useSiteFeatures } from '../lib/site-feature-context'
import { useAppReducedMotion } from '../lib/motion-preference'
import AuthActionButton from './AuthActionButton'
import type { AuthMode } from '../lib/auth-navigation'
type FieldErrors = Record<string, string>
type EmailInputValidation = { message: string | null; suggestedEmail: string | null }
type RegistrationEmailApiError = { message: string; suggestedEmail: string | null }
type AuthFormProps = {
  onAuthenticated: (payload: AuthSuccessResponse) => void
  allowCdk?: boolean
  compact?: boolean
  intro?: string
  submitClassName?: string
  animateActions?: boolean
  mode?: AuthMode
  onModeChange?: (mode: AuthMode) => void
  collapseOptionalInvite?: boolean
  invitationCode?: string
}

export default function AuthForm({
  onAuthenticated,
  allowCdk = true,
  compact = false,
  intro,
  submitClassName,
  animateActions = false,
  mode: controlledMode,
  onModeChange,
  collapseOptionalInvite = false,
  invitationCode,
}: AuthFormProps) {
  const { features } = useSiteFeatures()
  const reducedMotion = useAppReducedMotion()
  const [initialInviteCode] = useState(() => (invitationCode ?? readInitialInviteCode()).trim().toUpperCase())
  const [storedMode, setStoredMode] = useState<AuthMode>(() => initialInviteCode && features.registration
    ? 'register'
    : new URLSearchParams(window.location.search).get('recovery') === '1'
      ? 'forgot'
      : features.login ? 'login' : features.registration ? 'register' : 'forgot')
  const mode = controlledMode ?? storedMode
  const setMode = (next: AuthMode) => { setStoredMode(next); onModeChange?.(next) }
  const [showInviteCode, setShowInviteCode] = useState(Boolean(initialInviteCode))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [cdk, setCdk] = useState('')
  const [inviteCode, setInviteCode] = useState(initialInviteCode)
  const registrationQuery = useQuery({ queryKey: ['public', 'registration-settings', mode === 'register'], enabled: mode === 'register',
    queryFn: ({ signal }) => apiJson<{ invite_code_required?: boolean }>('/api/auth/registration-settings', { signal, fallbackMessage: copy.auth.components_AuthForm_004 }) })
  const inviteCodeRequired = registrationQuery.data ? registrationQuery.data.invite_code_required === true : null
  const registrationSettingsLoading = registrationQuery.isFetching
  const registrationSettingsError = registrationQuery.error ? registrationQuery.error.message || copy.auth.components_AuthForm_045 : null
  const [activeAction, setActiveAction] = useState<'submit' | 'resend' | null>(null)
  const [outcome, setOutcome] = useState<'success' | 'error' | null>(null)
  const [completion, setCompletion] = useState<{ payload?: AuthSuccessResponse; phase: 'success' | 'error'; feedbackAt: number; reveal?: () => void } | null>(null)
  const actionStartedAt = useRef(0)
  const loading = activeAction !== null
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null)
  const [showVerificationResend, setShowVerificationResend] = useState(false)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0)

  useEffect(clearInviteFragment, [])

  useEffect(() => {
    if (mode === 'login' && !features.login) setMode(features.registration ? 'register' : 'forgot')
    if (mode === 'register' && !features.registration) setMode(features.login ? 'login' : 'forgot')
  }, [features.login, features.registration, mode])

  useEffect(() => {
    if (mode !== 'register') setEmailSuggestion(null)
    setPasswordVisible(false)
    setFieldErrors({})
    setError(null)
    setNotice(null)
  }, [mode])

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return
    const timer = window.setTimeout(() => {
      setResendCooldownSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldownSeconds])

  useEffect(() => {
    if (!completion) return
    const delay = animateActions && !reducedMotion ? Math.max(0, completion.feedbackAt - performance.now()) : 0
    const showOutcome = window.setTimeout(() => {
      setOutcome(completion.phase)
      completion.reveal?.()
    }, delay)
    const finish = window.setTimeout(() => {
      setOutcome(null)
      setActiveAction(null)
      setCompletion(null)
      if (completion.payload) onAuthenticated(completion.payload)
    }, animateActions && !reducedMotion ? Math.max(0, completion.feedbackAt + 1000 - performance.now()) : 0)
    return () => {
      window.clearTimeout(showOutcome)
      window.clearTimeout(finish)
    }
  }, [completion, animateActions, reducedMotion, onAuthenticated])

  const completeAction = (payload?: AuthSuccessResponse, phase: 'success' | 'error' = 'success', reveal?: () => void) => {
    if (animateActions && !reducedMotion) {
      setCompletion({ payload, phase, reveal, feedbackAt: Math.max(performance.now(), actionStartedAt.current + (phase === 'success' ? 1200 : 400)) })
    } else {
      reveal?.()
      setActiveAction(null)
      if (payload) onAuthenticated(payload)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    if ((mode === 'login' && !features.login) || (mode === 'register' && !features.registration)) return
    if (mode === 'register' && inviteCodeRequired === null) {
      setError(registrationSettingsError ?? copy.auth.components_AuthForm_046)
      return
    }
    const nextErrors: FieldErrors = {}
    const emailValidation = validateEmailInputForMode(mode, email)
    const passwordError = mode === 'forgot' ? null : validatePasswordInput(password)
    const inviteCodeError = mode === 'register' ? validateInviteCodeInput(inviteCode, inviteCodeRequired === true) : null
    if (emailValidation.message) nextErrors.email = emailValidation.message
    if (passwordError) nextErrors.password = passwordError
    if (inviteCodeError) nextErrors.inviteCode = inviteCodeError
    setFieldErrors(nextErrors)
    setEmailSuggestion(emailValidation.suggestedEmail)
    if (Object.keys(nextErrors).length > 0) return

    actionStartedAt.current = performance.now()
    setActiveAction('submit')
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        const data = await apiJson<RecoveryAcceptedResponse>('/api/auth/forgot-password', {
          method: 'POST',
          json: { email },
          fallbackMessage: copy.auth.components_AuthForm_001,
        })
        setNotice(data.message || copy.auth.components_AuthForm_002)
        completeAction()
        return
      }

      const data = await apiJson<AuthSuccessResponse | RegistrationAcceptedResponse>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        json: mode === 'login' ? { email, password } : {
          email,
          password,
          cdk: allowCdk ? cdk.trim() || undefined : undefined,
          invite_code: inviteCode.trim() || undefined,
        },
        fallbackMessage: mode === 'login' ? copy.auth.components_AuthForm_003 : copy.auth.components_AuthForm_004,
      })
      if ('accepted' in data) {
        setNotice(data.message || copy.auth.components_AuthForm_028)
        setShowVerificationResend(data.verification_required !== false)
        setResendCooldownSeconds(data.verification_required !== false
          ? normalizeCooldownSeconds(data.resend_after_seconds)
          : 0)
        completeAction()
        return
      }
      if (!data.user) throw new Error(mode === 'login' ? copy.auth.components_AuthForm_005 : copy.auth.components_AuthForm_006)
      completeAction(data)
    } catch (caught) {
      completeAction(undefined, 'error', () => {
        let handledRegistrationEmailError = false
        if (mode === 'register' && caught instanceof ApiError && isInviteCodeError(caught.data)) {
          setFieldErrors((current) => ({ ...current, inviteCode: caught.message }))
        }
        if (mode === 'register' && caught instanceof ApiError) {
          const registrationEmailError = getRegistrationEmailApiError(caught.data, caught.message)
          if (registrationEmailError) {
            handledRegistrationEmailError = true
            setFieldErrors((current) => ({ ...current, email: registrationEmailError.message }))
            setEmailSuggestion(registrationEmailError.suggestedEmail)
          }
        }
        if (caught instanceof ApiError && (
          isApiErrorCode(caught.data, 'email_not_verified')
          || isApiErrorCode(caught.data, 'verification_email_send_failed')
        )) setShowVerificationResend(true)
        if (!handledRegistrationEmailError) setError((caught as Error).message)
      })
    }
  }

  const resendVerification = async () => {
    if (loading) return
    const emailError = validateEmailInput(email)
    if (emailError) {
      setFieldErrors((current) => ({ ...current, email: emailError }))
      return
    }
    actionStartedAt.current = performance.now()
    setActiveAction('resend')
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<RecoveryAcceptedResponse>('/api/auth/resend-verification', {
        method: 'POST',
        json: { email },
        fallbackMessage: copy.auth.components_AuthForm_029,
      })
      setNotice(data.message || copy.auth.components_AuthForm_030)
      setResendCooldownSeconds(normalizeCooldownSeconds(data.resend_after_seconds))
      completeAction()
    } catch (caught) {
      completeAction(undefined, 'error', () => setError((caught as Error).message))
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

  const validateRegistrationEmailField = () => {
    const validation = validateEmailInputForMode('register', email)
    setEmailSuggestion(validation.suggestedEmail)
    if (validation.message) {
      setFieldErrors((current) => ({ ...current, email: validation.message! }))
      return
    }
    clearFieldError('email')
  }

  const useEmailSuggestion = () => {
    if (!emailSuggestion) return
    const validation = validateEmailInputForMode('register', emailSuggestion)
    setEmail(emailSuggestion)
    setEmailSuggestion(validation.suggestedEmail)
    if (validation.message) {
      setFieldErrors((current) => ({ ...current, email: validation.message! }))
      return
    }
    clearFieldError('email')
  }

  const emailDescriptionIds = [
    mode === 'register' ? 'auth-email-hint' : null,
    fieldErrors.email ? 'auth-email-error' : null,
    emailSuggestion ? 'auth-email-suggestion' : null,
  ].filter(Boolean).join(' ') || undefined
  const passwordDescriptionIds = [
    mode === 'register' ? 'auth-password-hint' : null,
    fieldErrors.password ? 'auth-password-error' : null,
  ].filter(Boolean).join(' ') || undefined
  const passwordId = compact ? 'depot-auth-password' : 'auth-password'
  const submitLabel = mode === 'login' ? copy.auth.components_AuthForm_020 : mode === 'register' ? copy.auth.components_AuthForm_021 : copy.auth.components_AuthForm_022
  const resendLabel = resendCooldownSeconds > 0 ? `${resendCooldownSeconds} ${copy.auth.components_AuthForm_044}` : copy.auth.components_AuthForm_031
  const actionPhase = (action: 'submit' | 'resend') => activeAction === action ? outcome ?? 'loading' : 'idle'
  const lockMode = animateActions && loading
  const resendAction = showVerificationResend && mode !== 'forgot' && (animateActions ? (
    <AuthActionButton type="button" phase={actionPhase('resend')} disabled={loading || resendCooldownSeconds > 0} onClick={() => void resendVerification()} className="tool-secondary-action min-h-11 w-full px-4 text-sm">
      {resendLabel}
    </AuthActionButton>
  ) : (
    <button type="button" disabled={loading || resendCooldownSeconds > 0} onClick={() => void resendVerification()} className="tool-secondary-action min-h-11 w-full px-4 text-sm">
      {loading ? copy.auth.components_AuthForm_019 : resendLabel}
    </button>
  ))

  return (
    <form onSubmit={handleSubmit} noValidate className={`${compact ? 'space-y-4' : 'tool-panel space-y-5 p-6 sm:p-8'}${animateActions ? ' auth-form--animated' : ''}`}>
      <div>
        <div className="tool-inset grid grid-cols-2 p-1" role="group" aria-label={copy.auth.components_AuthForm_007}>
          <button type="button" disabled={lockMode || !features.login} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null); setNotice(null); setEmailSuggestion(null); setShowVerificationResend(false); setResendCooldownSeconds(0) }} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${mode === 'login' ? 'bg-primary text-primary-foreground' : 'text-ink-secondary'}`}>{features.login ? copy.auth.components_AuthForm_008 : `${copy.auth.components_AuthForm_008} · ${copy.features.paused}`}</button>
          <button type="button" disabled={lockMode || !features.registration} aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(null); setNotice(null); setEmailSuggestion(null); setShowVerificationResend(false); setResendCooldownSeconds(0) }} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${mode === 'register' ? 'bg-primary text-primary-foreground' : 'text-ink-secondary'}`}>{features.registration ? copy.auth.components_AuthForm_009 : `${copy.auth.components_AuthForm_009} · ${copy.features.paused}`}</button>
        </div>

        {intro && <p className="mt-4 text-sm leading-6 text-ink-secondary">{intro}</p>}
        <div className={`auth-feedback-slot${!animateActions && (error || notice) ? ' mt-4' : ''}`} data-visible={Boolean(error || notice)} aria-live="polite" aria-atomic="true">
          <div className="auth-feedback-content">
            {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
            {notice && <div className="tool-alert tool-alert--success" role="status">{notice}</div>}
          </div>
        </div>
      </div>
      {mode === 'forgot' && <h2 className="text-lg font-semibold text-ink-primary">{copy.auth.components_AuthForm_010}</h2>}

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_011}</span>
        <input
          id={compact ? 'depot-auth-email' : 'auth-email'}
          type="email"
          value={email}
          maxLength={AUTH_EMAIL_MAX_LENGTH}
          onChange={(event) => {
            setEmail(event.currentTarget.value)
            setEmailSuggestion(null)
            setShowVerificationResend(false)
            setResendCooldownSeconds(0)
            clearFieldError('email')
          }}
          onFocus={() => clearFieldError('email')}
          onBlur={() => {
            if (mode === 'register') validateRegistrationEmailField()
          }}
          className={inputClassName(Boolean(fieldErrors.email))}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={emailDescriptionIds}
          autoComplete="email"
        />
        <FieldMessage id="auth-email-error" message={fieldErrors.email} />
      </label>
      {mode === 'register' && <p id="auth-email-hint" className="-mt-3 text-sm leading-6 text-ink-muted">{copy.auth.registration_email_hint}</p>}
      {emailSuggestion && (
        <div id="auth-email-suggestion" className="-mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          <span>{copy.auth.components_AuthForm_040} {emailSuggestion}</span>
          <button type="button" onClick={useEmailSuggestion} className="tool-secondary-action min-h-9 px-3 text-sm">
            {copy.auth.components_AuthForm_041} {emailSuggestion}
          </button>
        </div>
      )}

      {mode !== 'forgot' && (
        <div>
          <label htmlFor={passwordId} className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_012}</label>
          <div className="auth-password-field flex items-center gap-2">
            <input
              id={passwordId}
              type={passwordVisible ? 'text' : 'password'}
              value={password}
              maxLength={AUTH_PASSWORD_MAX_LENGTH}
              onChange={(event) => {
                setPassword(event.currentTarget.value)
                clearFieldError('password')
              }}
              onFocus={() => clearFieldError('password')}
              className={`${inputClassName(Boolean(fieldErrors.password))} min-w-0 flex-1`}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={passwordDescriptionIds}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
            <button type="button" className="tool-secondary-action min-h-11 shrink-0 whitespace-nowrap px-3 text-sm" aria-controls={passwordId} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((current) => !current)}>
              {passwordVisible ? copy.auth.hide_password : copy.auth.show_password}
            </button>
          </div>
          {mode === 'register' && <p id="auth-password-hint" className="mt-2 text-sm leading-6 text-ink-muted">{copy.auth.registration_password_hint(AUTH_PASSWORD_MIN_LENGTH, AUTH_PASSWORD_MAX_LENGTH)}</p>}
          <FieldMessage id="auth-password-error" message={fieldErrors.password} />
        </div>
      )}

      {allowCdk && features.cdk_redemption && mode === 'register' && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.auth.components_AuthForm_013}</span>
          <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="tool-field min-h-11 font-mono uppercase tracking-wide" placeholder={copy.auth.components_AuthForm_014} />
        </label>
      )}

      {mode === 'register' && <>
        {collapseOptionalInvite && !inviteCodeRequired && !showInviteCode && <button type="button" className="tool-secondary-action min-h-11 px-3 text-sm" onClick={() => setShowInviteCode(true)}>{copy.auth.optionalInvitation}</button>}
        {(!collapseOptionalInvite || inviteCodeRequired || showInviteCode) && <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">
            {inviteCodeRequired ? copy.auth.components_AuthForm_032 : copy.auth.components_AuthForm_015}
          </span>
          <input
            id={compact ? 'depot-auth-invite-code' : 'auth-invite-code'}
            type="text"
            value={inviteCode}
            maxLength={16}
            onChange={(event) => {
              setInviteCode(event.currentTarget.value.toUpperCase())
              clearFieldError('inviteCode')
            }}
            onFocus={() => clearFieldError('inviteCode')}
            className={`${inputClassName(Boolean(fieldErrors.inviteCode))} font-mono uppercase tracking-wide`}
            placeholder={inviteCodeRequired ? copy.auth.components_AuthForm_034 : copy.auth.components_AuthForm_016}
            required={inviteCodeRequired === true}
            aria-invalid={Boolean(fieldErrors.inviteCode)}
            aria-describedby={fieldErrors.inviteCode ? 'auth-invite-code-error' : undefined}
          />
          <FieldMessage id="auth-invite-code-error" message={fieldErrors.inviteCode} />
        </label>}
        {registrationSettingsLoading && (
          <p className="-mt-3 text-sm text-ink-muted" role="status">{copy.auth.components_AuthForm_047}</p>
        )}
        {registrationSettingsError && (
          <div className="tool-alert tool-alert--error -mt-2 flex flex-wrap items-center justify-between gap-3" role="alert">
            <span>{registrationSettingsError}</span>
            <button
              type="button"
              className="tool-secondary-action min-h-9 px-3 text-sm"
              onClick={() => {
                void registrationQuery.refetch({ cancelRefetch: false })
              }}
            >{copy.auth.components_AuthForm_048}</button>
          </div>
        )}
      </>}

      {mode === 'login' && (
        <button type="button" disabled={lockMode} onClick={() => { setMode('forgot'); setError(null); setNotice(null); setFieldErrors({}); setShowVerificationResend(false); setResendCooldownSeconds(0) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          {copy.auth.components_AuthForm_017}</button>
      )}
      {mode === 'forgot' && (
        <button type="button" disabled={lockMode} onClick={() => { setMode('login'); setError(null); setNotice(null); setFieldErrors({}); setShowVerificationResend(false); setResendCooldownSeconds(0) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          {copy.auth.components_AuthForm_018}</button>
      )}

      {mode !== 'forgot' && !features.login && (
        <button type="button" disabled={lockMode} onClick={() => { setMode('forgot'); setError(null); setNotice(null); setFieldErrors({}); setShowVerificationResend(false); setResendCooldownSeconds(0) }} className="tool-secondary-action min-h-11 w-fit px-3 text-sm">
          {copy.features.recovery}
        </button>
      )}

      {!animateActions && resendAction}

      {animateActions ? (
        <AuthActionButton type="submit" phase={actionPhase('submit')} disabled={loading || (mode === 'register' && inviteCodeRequired === null)} className={submitClassName ?? 'tool-primary-action w-full px-6 py-3'}>
          {submitLabel}
        </AuthActionButton>
      ) : (
        <button type="submit" aria-busy={loading} disabled={loading || (mode === 'register' && inviteCodeRequired === null)} className={`min-h-12 ${submitClassName ?? 'tool-primary-action w-full px-6 py-3'}`}>
          {loading ? copy.auth.components_AuthForm_019 : submitLabel}
        </button>
      )}
      {animateActions && resendAction}
    </form>
  )
}

function readInitialInviteCode(): string {
  const hashInvite = new URLSearchParams(window.location.hash.slice(1)).get('invite')
  return (hashInvite ?? new URLSearchParams(window.location.search).get('invite'))?.trim().toUpperCase() ?? ''
}

function clearInviteFragment(): void {
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (!params.has('invite')) return
  params.delete('invite')
  const hash = params.toString()
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`,
  )
}

function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return copy.auth.components_AuthForm_023
  if (email.length > AUTH_EMAIL_MAX_LENGTH) return copy.auth.components_AuthForm_042
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return copy.auth.components_AuthForm_024
  return null
}

function validateEmailInputForMode(mode: AuthMode, value: string): EmailInputValidation {
  const emailError = validateEmailInput(value)
  if (emailError) return { message: emailError, suggestedEmail: null }
  if (mode !== 'register') return { message: null, suggestedEmail: null }

  const result = validateRegistrationEmail(value)
  if (result.ok) return { message: null, suggestedEmail: null }
  return {
    message: registrationEmailValidationMessage(result),
    suggestedEmail: result.suggestedEmail ?? null,
  }
}

function registrationEmailValidationMessage(result: Exclude<RegistrationEmailValidation, { ok: true }>): string {
  switch (result.reason) {
    case 'invalid_format': return copy.auth.components_AuthForm_024
    case 'unsupported_provider': return copy.auth.components_AuthForm_036
    case 'alias_not_allowed': return copy.auth.components_AuthForm_038
    case 'domain_typo': return copy.auth.components_AuthForm_039
  }
}

function validatePasswordInput(value: string): string | null {
  if (!value) return copy.auth.components_AuthForm_025
  if (value.length < AUTH_PASSWORD_MIN_LENGTH) return copy.auth.components_AuthForm_026
  if (value.length > AUTH_PASSWORD_MAX_LENGTH) return copy.auth.components_AuthForm_043
  return null
}

function normalizeCooldownSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : AUTH_RESEND_COOLDOWN_SECONDS
}

function validateInviteCodeInput(value: string, required: boolean): string | null {
  const code = value.trim().toUpperCase()
  if (!code) return required ? copy.auth.components_AuthForm_033 : null
  if (required) return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code) ? null : copy.auth.components_AuthForm_035
  return /^(?:[0-9A-HJKMNP-TV-Z]{10}|[0-9A-HJKMNP-TV-Z]{16})$/.test(code) ? null : copy.auth.components_AuthForm_027
}

function isInviteCodeError(data: unknown): boolean {
  if (!data || typeof data !== 'object' || !('code' in data)) return false
  const code = (data as { code?: unknown }).code
  return code === 'invite_code_required' || code === 'invalid_invite_code' || code === 'invitation_campaign_paused'
}

function isApiErrorCode(data: unknown, expected: string): boolean {
  if (!data || typeof data !== 'object' || !('code' in data)) return false
  return (data as { code?: unknown }).code === expected
}

function getRegistrationEmailApiError(data: unknown, message: string): RegistrationEmailApiError | null {
  if (!data || typeof data !== 'object' || !('code' in data)) return null
  const code = (data as { code?: unknown }).code
  if (code !== 'email_invalid'
    && code !== 'email_provider_not_allowed'
    && code !== 'email_alias_not_allowed'
    && code !== 'email_domain_typo') return null

  const suggestedEmail = 'suggested_email' in data && typeof (data as { suggested_email?: unknown }).suggested_email === 'string'
    ? (data as { suggested_email: string }).suggested_email
    : null
  return { message, suggestedEmail }
}

function inputClassName(hasError: boolean): string {
  const base = 'tool-field min-h-11'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : ''
  return `${base} ${state}`
}

function FieldMessage({ id, message }: { id: string; message?: string }) {
  if (!message) return null

  return (
    <p id={id} className="auth-field-message" role="alert">
      {message}
    </p>
  )
}
