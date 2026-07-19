import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { RegistrationSettings } from '../../../lib/types'
import { copy } from '../../../copy/index'

const DEFAULT_SETTINGS: RegistrationSettings = {
  version: 1,
  email_verification_required: true,
  updated_at: null,
}

export default function RegistrationSettingsSection() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApiJson<{ settings?: RegistrationSettings }>('/api/admin/registration-settings', {
        fallbackMessage: copy.admin.registration_load_failed,
      })
      setSettings(data.settings ?? DEFAULT_SETTINGS)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<{ settings?: RegistrationSettings }>('/api/admin/registration-settings', {
        method: 'PUT',
        json: { email_verification_required: settings.email_verification_required },
        fallbackMessage: copy.admin.registration_save_failed,
      })
      setSettings(data.settings ?? settings)
      setNotice(copy.admin.registration_saved)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.admin.registration_loading}</div>

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}
      <section className="tool-panel p-5 sm:p-6" aria-labelledby="admin-registration-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="tool-eyebrow">{copy.admin.registration_eyebrow}</p>
            <h2 id="admin-registration-title" className="mt-2 text-lg font-semibold text-ink-primary">{copy.admin.registration_title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.admin.registration_description}</p>
          </div>
          <label className="tool-inset flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm font-semibold text-ink-secondary">
            <input
              type="checkbox"
              checked={settings.email_verification_required}
              onChange={(event) => {
                const emailVerificationRequired = event.currentTarget.checked
                setSettings((current) => ({ ...current, email_verification_required: emailVerificationRequired }))
              }}
              className="h-4 w-4 accent-brand-600"
            />
            {copy.admin.registration_toggle}
          </label>
        </div>
        <div className="tool-inset mt-5 p-4 text-sm leading-6 text-ink-secondary">
          <p>{copy.admin.registration_enabled_help}</p>
          <p className="mt-2">{copy.admin.registration_disabled_help}</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="tool-primary-action">{saving ? copy.admin.registration_saving : copy.admin.registration_save}</button>
          <button type="button" disabled={saving} onClick={() => void load()} className="tool-secondary-action">{copy.admin.registration_reload}</button>
          <span className="text-xs text-ink-muted">
            {copy.admin.registration_updated}{settings.updated_at ? new Date(settings.updated_at).toLocaleString('zh-CN') : copy.admin.registration_default}
          </span>
        </div>
      </section>
    </form>
  )
}
