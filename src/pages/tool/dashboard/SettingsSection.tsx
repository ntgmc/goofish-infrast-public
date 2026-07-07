import { useState } from 'react'
import { apiVoid } from '../../../lib/api-client'
import { inputClassName, validatePasswordInput } from '../tool-utils'

type FieldErrors = Record<string, string>


export default function SettingsSection() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const oldPasswordError = validatePasswordInput(oldPassword)
    const newPasswordError = validatePasswordInput(newPassword)
    if (oldPasswordError) nextErrors.oldPassword = oldPasswordError
    if (newPasswordError) nextErrors.newPassword = newPasswordError
    if (!confirmPassword) nextErrors.confirmPassword = '请再次输入新密码'
    else if (newPassword && newPassword !== confirmPassword) nextErrors.confirmPassword = '两次输入的新密码不一致'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      await apiVoid('/api/auth/change-password', {
        method: 'POST',
        json: { old_password: oldPassword, new_password: newPassword },
        fallbackMessage: '修改失败',
      })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setStatus('密码已更新。')
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
    <form onSubmit={submit} noValidate className="max-w-xl rounded-xl border border-surface-3 bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink-primary">修改登录密码</h2>
      {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {status && <div className="mt-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{status}</div>}
      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">当前密码</span>
        <input
          id="settings-old-password"
          type="password"
          value={oldPassword}
          onChange={(event) => {
            setOldPassword(event.currentTarget.value)
            clearFieldError('oldPassword')
          }}
          onFocus={() => clearFieldError('oldPassword')}
          className={inputClassName(Boolean(fieldErrors.oldPassword))}
          aria-invalid={Boolean(fieldErrors.oldPassword)}
          aria-describedby={fieldErrors.oldPassword ? 'settings-old-password-error' : undefined}
        />
        {fieldErrors.oldPassword && <p id="settings-old-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.oldPassword}</p>}
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
        <input
          id="settings-new-password"
          type="password"
          value={newPassword}
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
        {fieldErrors.newPassword && <p id="settings-new-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.newPassword}</p>}
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">确认新密码</span>
        <input
          id="settings-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.currentTarget.value)
            clearFieldError('confirmPassword')
          }}
          onFocus={() => clearFieldError('confirmPassword')}
          className={inputClassName(Boolean(fieldErrors.confirmPassword))}
          aria-invalid={Boolean(fieldErrors.confirmPassword)}
          aria-describedby={fieldErrors.confirmPassword ? 'settings-confirm-password-error' : undefined}
        />
        {fieldErrors.confirmPassword && <p id="settings-confirm-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.confirmPassword}</p>}
      </label>
      <button type="submit" disabled={loading} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{loading ? '保存中...' : '修改密码'}</button>
    </form>
  )
}
