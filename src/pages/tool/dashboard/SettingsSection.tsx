import { useState } from 'react'
import { apiVoid } from '../../../lib/api-client'
import { inputClassName, validatePasswordInput } from '../tool-utils'
import type { UserGameAccount } from '../../../lib/types'

type FieldErrors = Record<string, string>


export default function SettingsSection({ profiles, onLogout }: { profiles: UserGameAccount[]; onLogout: () => void }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)
  const [privacyLoading, setPrivacyLoading] = useState<string | null>(null)
  const [privacyError, setPrivacyError] = useState<string | null>(null)
  const [deleteEmail, setDeleteEmail] = useState('')
  const [deletePassword, setDeletePassword] = useState('')

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

  const downloadExport = async () => {
    setPrivacyError(null)
    setPrivacyLoading('export')
    try {
      const response = await fetch('/api/user/data/export')
      if (!response.ok) throw new Error('导出失败')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'maa-personal-data.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setPrivacyError(caught instanceof Error ? caught.message : '导出个人数据失败，请稍后重试。')
    } finally { setPrivacyLoading(null) }
  }

  const profileAction = async (action: 'credential/clear' | 'skland/unlink' | 'depot-sample/revoke', profile: UserGameAccount) => {
    const labels = { 'credential/clear': '清除森空岛凭据', 'skland/unlink': '解绑森空岛', 'depot-sample/revoke': '撤回仓库样本' }
    if (!window.confirm(`确定要${labels[action]}吗？此操作可能影响后续导入。`)) return
    setPrivacyError(null)
    setPrivacyLoading(`${action}:${profile.id}`)
    try { await apiVoid(`/api/user/data/${action}`, { method: 'POST', json: { profile_id: profile.id } }) }
    catch (caught) { setPrivacyError(caught instanceof Error ? caught.message : `${labels[action]}失败，请稍后重试。`) }
    finally { setPrivacyLoading(null) }
  }

  const requestDeletion = async () => {
    if (!window.confirm('注销请求会立即退出登录，并在 7 天后永久删除个人数据。确定继续吗？')) return
    setPrivacyError(null)
    setPrivacyLoading('delete')
    try {
      await apiVoid('/api/user/data/delete-request', { method: 'POST', json: { email: deleteEmail, password: deletePassword } })
      onLogout()
    } catch (caught) {
      setPrivacyError(caught instanceof Error ? caught.message : '注销请求提交失败，请检查邮箱和密码后重试。')
    } finally { setPrivacyLoading(null) }
  }

  return (
    <div className="max-w-2xl space-y-6">
    <form onSubmit={submit} noValidate className="tool-panel p-6">
      <h2 className="text-lg font-semibold text-ink-primary">修改登录密码</h2>
      {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
      {status && <div className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{status}</div>}
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
        {fieldErrors.oldPassword && <p id="settings-old-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.oldPassword}</p>}
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
        {fieldErrors.newPassword && <p id="settings-new-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.newPassword}</p>}
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
        {fieldErrors.confirmPassword && <p id="settings-confirm-password-error" className="mt-1.5 text-sm text-error" role="alert">{fieldErrors.confirmPassword}</p>}
      </label>
      <button type="submit" disabled={loading} className="tool-primary-action mt-5">{loading ? '保存中...' : '修改密码'}</button>
    </form>
    <section className="tool-panel p-6">
      <h2 className="text-lg font-semibold text-ink-primary">数据与隐私</h2>
      <p className="mt-2 text-sm text-ink-secondary">我们保存登录资料、游戏档案、工作区、使用记录和你主动贡献的仓库样本。注销后进入 7 天冷静期，期满会删除所有可关联数据；仅保留无法关联的汇总统计。</p>
      {privacyError && <div className="tool-alert tool-alert--error mt-4" role="alert">{privacyError}</div>}
      <button type="button" onClick={() => void downloadExport()} disabled={privacyLoading !== null} className="tool-secondary-action mt-4">{privacyLoading === 'export' ? '正在导出...' : '导出个人数据'}</button>
      <div className="mt-5 space-y-3">
        {profiles.filter((profile) => profile.skland_binding || profile.kind === 'depot_value').map((profile) => (
          <div key={profile.id} className="tool-inset p-4">
            <p className="font-medium text-ink-primary">{profile.display_name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.skland_binding && <button type="button" onClick={() => void profileAction('credential/clear', profile)} disabled={privacyLoading !== null} className="tool-secondary-action px-3 text-sm">清除凭据</button>}
              {profile.skland_binding && <button type="button" onClick={() => void profileAction('skland/unlink', profile)} disabled={privacyLoading !== null} className="tool-secondary-action px-3 text-sm">解绑森空岛</button>}
              <button type="button" onClick={() => void profileAction('depot-sample/revoke', profile)} disabled={privacyLoading !== null} className="tool-secondary-action px-3 text-sm">撤回仓库样本</button>
            </div>
          </div>
        ))}
      </div>
      <div className="tool-alert tool-alert--error mt-6 p-5">
        <h3 className="font-semibold text-error">注销账号</h3>
        <p className="mt-1 text-sm text-ink-secondary">提交后会退出登录并发送撤销链接。7 天内可撤销；到期后将永久擦除账户、档案、凭据、样本、任务和使用记录。</p>
        <label className="mt-3 block" htmlFor="settings-delete-email">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">确认邮箱</span>
          <input id="settings-delete-email" value={deleteEmail} onChange={(event) => setDeleteEmail(event.currentTarget.value)} autoComplete="email" className="tool-field" />
        </label>
        <label className="mt-3 block" htmlFor="settings-delete-password">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">当前密码</span>
          <input id="settings-delete-password" value={deletePassword} onChange={(event) => setDeletePassword(event.currentTarget.value)} type="password" autoComplete="current-password" className="tool-field" />
        </label>
        <button type="button" onClick={() => void requestDeletion()} disabled={privacyLoading !== null || !deleteEmail || !deletePassword} className="tool-danger-action mt-4">{privacyLoading === 'delete' ? '正在提交...' : '发起注销请求'}</button>
      </div>
    </section>
    </div>
  )
}
