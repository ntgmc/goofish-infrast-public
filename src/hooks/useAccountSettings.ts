import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiJson, apiVoid } from '../lib/api-client'
import { clearSklandAccountSnapshot } from '../lib/skland-snapshot-client'
import { validatePasswordInput } from '../pages/tool/tool-utils'
import type { AccountDeletionAccepted, AuthSuccessResponse, UserGameAccount } from '../lib/types'
import { copy } from '../copy'
import { AUTH_PASSWORD_MAX_LENGTH } from '../lib/auth-constraints'
import { accountLifecycleErrorMessage } from '../lib/account-lifecycle-client'
import { accountDeletionSurveySchema, type AccountDeletionSurvey as DeletionSurvey } from '../lib/account-deletion-contracts'

type FieldErrors = Record<string, string>


export function useAccountSettings({ profiles, activeProfileId, onPayload, onDeletionStateChange }: {
  profiles: UserGameAccount[]
  activeProfileId?: string | null
  onPayload: (payload: AuthSuccessResponse) => void
  onDeletionStateChange?: (state: 'idle' | 'submitting' | 'accepted') => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
  const [deleteReason, setDeleteReason] = useState<DeletionSurvey['reason'] | ''>('')
  const [deleteDetail, setDeleteDetail] = useState('')
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const boundProfiles = profiles.filter((profile) => profile.skland_binding)

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
      if (profile.skland_binding) clearSklandAccountSnapshot(profile.skland_binding.uid)
      setClearedCredentialIds((current) => new Set(current).add(profile.id))
      setPrivacyStatus(copy.dashboard.pages_tool_dashboard_SettingsSection_036)
      const payload = await apiJson<AuthSuccessResponse>(activeProfileId ? `/api/auth/me?profile_id=${encodeURIComponent(activeProfileId)}` : '/api/auth/me')
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
    const survey = accountDeletionSurveySchema.safeParse({ reason: deleteReason, reason_detail: deleteDetail })
    if (!survey.success) {
      setDeletionError(copy.dashboard.settings.deletion_survey_invalid)
      return
    }
    if (!window.confirm(copy.dashboard.pages_tool_dashboard_SettingsSection_014)) return
    setDeletionError(null)
    setPrivacyLoading('delete')
    onDeletionStateChange?.('submitting')
    try {
      const accepted = await apiJson<AccountDeletionAccepted>('/api/user/data/delete-request', {
        method: 'POST',
        json: { email: deleteEmail, password: deletePassword, ...survey.data },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_SettingsSection_015,
      })
      queryClient.removeQueries({ queryKey: ['user'] })
      setDeletePassword('')
      onDeletionStateChange?.('accepted')
      void navigate(`/account-safety?scheduled_for=${encodeURIComponent(accepted.scheduled_for)}`, { replace: true })
    } catch (caught) {
      setDeletionError(accountLifecycleErrorMessage(caught, copy.dashboard.pages_tool_dashboard_SettingsSection_015))
      onDeletionStateChange?.('idle')
    } finally { setPrivacyLoading(null) }
  }

  return { oldPassword, setOldPassword, newPassword, setNewPassword, confirmPassword, setConfirmPassword,
    status, error, fieldErrors, loading, submit, clearFieldError, boundProfiles, clearedCredentialIds,
    privacyLoading, privacyError, privacyStatus, clearCredential, deleteEmail, setDeleteEmail,
    deletePassword, setDeletePassword, deleteReason, setDeleteReason, deleteDetail, setDeleteDetail, deletionError, requestDeletion }
}
