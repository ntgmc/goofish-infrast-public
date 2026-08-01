import { useState } from 'react'
import { apiJson, apiVoid } from '../../../lib/api-client'
import { inputClassName, validatePasswordInput } from '../tool-utils'
import type { AccountDeletionAccepted, AuthSuccessResponse, UserGameAccount } from '../../../lib/types'
import { copy } from '../../../copy/index'
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from '../../../lib/auth-constraints'
import {
  accountLifecycleErrorMessage,
  deletionEmailMessage,
  formatAccountDeletionDeadline,
} from '../../../lib/account-lifecycle-client'


type FieldErrors = Record<string, string>


export default function SettingsSection({
  profiles,
  onLogout,
  onPayload,
}: {
  profiles: UserGameAccount[]
  onLogout: () => void
  onPayload: (payload: AuthSuccessResponse) => void
}) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)
  const [privacyLoading, setPrivacyLoading] = useState<string | null>(null)
  const [privacyError, setPrivacyError] = useState<string | null>(null)
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null)
  const [clearedCredentialIds, setClearedCredentialIds] = useState<Set<string>>(() => new Set())
  const [deleteEmail, setDeleteEmail] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deletion, setDeletion] = useState<AccountDeletionAccepted | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const oldPasswordError = validatePasswordInput(oldPassword)
    const newPasswordError = validatePasswordInput(newPassword)
    if (oldPasswordError) nextErrors.oldPassword = oldPasswordError
    if (newPasswordError) nextErrors.newPassword = newPasswordError
    if (!confirmPassword) nextErrors.confirmPassword = copy.dashboard.pages_tool_dashboard_SettingsSection_001
    else if (confirmPassword.length > AUTH_PASSWORD_MAX_LENGTH) {
      nextErrors.confirmPassword = copy.workspace.pages_tool_tool_utils_018
    }
    else if (newPassword && newPassword !== confirmPassword) nextErrors.confirmPassword = copy.dashboard.pages_tool_dashboard_SettingsSection_002
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (newPassword !== confirmPassword) {
      setError(copy.dashboard.pages_tool_dashboard_SettingsSection_003)
      return
    }
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      await apiVoid('/api/auth/change-password', {
        method: 'POST',
        json: { old_password: oldPassword, new_password: newPassword },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_SettingsSection_004,
      })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setStatus(copy.dashboard.pages_tool_dashboard_SettingsSection_005)
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

  const clearCredential = async (profile: UserGameAccount) => {
    const label = copy.dashboard.pages_tool_dashboard_SettingsSection_008
    if (!window.confirm(`${copy.dashboard.pages_tool_dashboard_SettingsSection_011}${label}${copy.dashboard.pages_tool_dashboard_SettingsSection_012}`)) return
    setPrivacyError(null)
    setPrivacyStatus(null)
    setPrivacyLoading(`credential/clear:${profile.id}`)
    let cleared = false
    try {
      await apiVoid('/api/user/data/credential/clear', { method: 'POST', json: { profile_id: profile.id } })
      cleared = true
      setClearedCredentialIds((current) => new Set(current).add(profile.id))
      setPrivacyStatus(copy.dashboard.pages_tool_dashboard_SettingsSection_036)
      const payload = await apiJson<AuthSuccessResponse>('/api/auth/me')
      onPayload(payload)
    }
    catch (caught) {
      setPrivacyError(cleared
        ? copy.dashboard.pages_tool_dashboard_SettingsSection_037
        : accountLifecycleErrorMessage(caught, `${label}${copy.dashboard.pages_tool_dashboard_SettingsSection_013}`))
    }
    finally { setPrivacyLoading(null) }
  }

  const requestDeletion = async () => {
    if (!window.confirm(copy.dashboard.pages_tool_dashboard_SettingsSection_014)) return
    setPrivacyError(null)
    setPrivacyStatus(null)
    setPrivacyLoading('delete')
    try {
      const accepted = await apiJson<AccountDeletionAccepted>('/api/user/data/delete-request', {
        method: 'POST',
        json: { email: deleteEmail, password: deletePassword },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_SettingsSection_015,
      })
      setDeletion(accepted)
      setDeletePassword('')
    } catch (caught) {
      setPrivacyError(accountLifecycleErrorMessage(caught, copy.dashboard.pages_tool_dashboard_SettingsSection_015))
    } finally { setPrivacyLoading(null) }
  }

  return (
    <div className="max-w-2xl space-y-6">
    <form onSubmit={submit} noValidate className="tool-panel p-6">
      <h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_SettingsSection_016}</h2>
      {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
      {status && <div className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{status}</div>}
      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_017}</span>
        <input
          id="settings-old-password"
          type="password"
          value={oldPassword}
          maxLength={AUTH_PASSWORD_MAX_LENGTH}
          onChange={(event) => {
            setOldPassword(event.currentTarget.value)
            clearFieldError('oldPassword')
          }}
          onFocus={() => clearFieldError('oldPassword')}
          className={inputClassName(Boolean(fieldErrors.oldPassword))}
          aria-invalid={Boolean(fieldErrors.oldPassword)}
          aria-describedby={fieldErrors.oldPassword ? 'settings-old-password-error' : undefined}
        />
        {fieldErrors.oldPassword && <p id="settings-old-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.oldPassword}</p>}
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_018}</span>
        <input
          id="settings-new-password"
          type="password"
          value={newPassword}
          maxLength={AUTH_PASSWORD_MAX_LENGTH}
          onChange={(event) => {
            setNewPassword(event.currentTarget.value)
            clearFieldError('newPassword')
            clearFieldError('confirmPassword')
          }}
          onFocus={() => clearFieldError('newPassword')}
          className={inputClassName(Boolean(fieldErrors.newPassword))}
          aria-invalid={Boolean(fieldErrors.newPassword)}
          aria-describedby={fieldErrors.newPassword ? 'settings-new-password-error' : undefined}
        />
        {fieldErrors.newPassword && <p id="settings-new-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.newPassword}</p>}
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_019}</span>
        <input
          id="settings-confirm-password"
          type="password"
          value={confirmPassword}
          maxLength={AUTH_PASSWORD_MAX_LENGTH}
          onChange={(event) => {
            setConfirmPassword(event.currentTarget.value)
            clearFieldError('confirmPassword')
          }}
          onFocus={() => clearFieldError('confirmPassword')}
          className={inputClassName(Boolean(fieldErrors.confirmPassword))}
          aria-invalid={Boolean(fieldErrors.confirmPassword)}
          aria-describedby={fieldErrors.confirmPassword ? 'settings-confirm-password-error' : undefined}
        />
        {fieldErrors.confirmPassword && <p id="settings-confirm-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.confirmPassword}</p>}
      </label>
      <button type="submit" disabled={loading} className="tool-primary-action mt-5">{loading ? copy.dashboard.pages_tool_dashboard_SettingsSection_020 : copy.dashboard.pages_tool_dashboard_SettingsSection_021}</button>
    </form>
    <section className="tool-panel p-6">
      <h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_SettingsSection_022}</h2>
      <p className="mt-2 text-sm text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_023}</p>
      {privacyError && <div className="tool-alert tool-alert--error mt-4" role="alert">{privacyError}</div>}
      {privacyStatus && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{privacyStatus}</div>}
      <div className="mt-5 space-y-3">
        {profiles.filter((profile) => profile.skland_binding).map((profile) => {
          const credentialAvailable = profile.skland_binding?.credential_status === 'available'
            && !clearedCredentialIds.has(profile.id)
          return (
            <div key={profile.id} className="tool-inset p-4">
              <p className="font-medium text-ink-primary">{profile.display_name}</p>
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                {credentialAvailable
                  ? copy.dashboard.pages_tool_dashboard_SettingsSection_035
                  : copy.dashboard.pages_tool_dashboard_SettingsSection_038}
              </p>
              {credentialAvailable && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void clearCredential(profile)} disabled={privacyLoading !== null} className="tool-secondary-action px-3 text-sm">{copy.dashboard.pages_tool_dashboard_SettingsSection_026}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="tool-alert tool-alert--error mt-6 p-5">
        <h3 className="font-semibold text-error">{copy.dashboard.pages_tool_dashboard_SettingsSection_029}</h3>
        <p className="mt-1 text-sm text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_030}</p>
        {deletion ? (
          <div className="mt-4" role="status" aria-live="polite">
            <p className="font-medium text-ink-primary">{copy.features.delete_accepted_title}</p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {copy.features.delete_accepted_before}<strong>{formatAccountDeletionDeadline(deletion.scheduled_for)}</strong>{copy.features.delete_accepted_after}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{deletionEmailMessage(deletion.cancellation_email)}</p>
            <button type="button" onClick={onLogout} className="tool-primary-action mt-4">{copy.features.delete_accepted_leave}</button>
          </div>
        ) : (
          <>
            <label className="mt-3 block" htmlFor="settings-delete-email">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_031}</span>
              <input id="settings-delete-email" value={deleteEmail} maxLength={AUTH_EMAIL_MAX_LENGTH} onChange={(event) => setDeleteEmail(event.currentTarget.value)} type="email" autoComplete="email" className="tool-field" />
            </label>
            <label className="mt-3 block" htmlFor="settings-delete-password">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_SettingsSection_032}</span>
              <input id="settings-delete-password" value={deletePassword} maxLength={AUTH_PASSWORD_MAX_LENGTH} onChange={(event) => setDeletePassword(event.currentTarget.value)} type="password" autoComplete="current-password" className="tool-field" />
            </label>
            <button type="button" onClick={() => void requestDeletion()} disabled={privacyLoading !== null || !deleteEmail || !deletePassword} className="tool-danger-action mt-4">{privacyLoading === 'delete' ? copy.dashboard.pages_tool_dashboard_SettingsSection_033 : copy.dashboard.pages_tool_dashboard_SettingsSection_034}</button>
          </>
        )}
      </div>
    </section>
    </div>
  )
}
