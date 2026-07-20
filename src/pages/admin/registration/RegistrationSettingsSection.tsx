import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { BrevoEmailStats, RegistrationSettings } from '../../../lib/types'
import { copy } from '../../../copy/index'

const DEFAULT_SETTINGS: RegistrationSettings = {
  version: 2,
  email_verification_required: true,
  brevo_quota_action: 'pause_registration',
  updated_at: null,
}

const EMPTY_EMAIL_STATS: BrevoEmailStats = {
  timezone: 'UTC',
  daily_limit: 300,
  today: {
    date: '',
    sent_count: 0,
    reserved_count: 0,
    uncertain_count: 0,
    failed_count: 0,
    quota_used_count: 0,
    remaining_count: 300,
    limit_reached: false,
    by_purpose: {
      email_verification: 0,
      password_reset: 0,
      account_deletion_cancellation: 0,
      account_deletion_receipt: 0,
    },
  },
  days: [],
}

type RegistrationSettingsResponse = {
  settings?: RegistrationSettings
  email_stats?: BrevoEmailStats
}

export default function RegistrationSettingsSection() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [emailStats, setEmailStats] = useState(EMPTY_EMAIL_STATS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApiJson<RegistrationSettingsResponse>('/api/admin/registration-settings', {
        fallbackMessage: copy.admin.registration_load_failed,
      })
      setSettings(data.settings ?? DEFAULT_SETTINGS)
      setEmailStats(data.email_stats ?? EMPTY_EMAIL_STATS)
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
      const data = await adminApiJson<RegistrationSettingsResponse>('/api/admin/registration-settings', {
        method: 'PUT',
        json: {
          email_verification_required: settings.email_verification_required,
          brevo_quota_action: settings.brevo_quota_action,
        },
        fallbackMessage: copy.admin.registration_save_failed,
      })
      setSettings(data.settings ?? settings)
      setEmailStats(data.email_stats ?? emailStats)
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
      <section className="tool-panel p-5 sm:p-6" aria-labelledby="admin-brevo-stats-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="tool-eyebrow">{copy.admin.registration_brevo_eyebrow}</p>
            <h2 id="admin-brevo-stats-title" className="mt-2 text-lg font-semibold text-ink-primary">{copy.admin.registration_brevo_title}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.admin.registration_brevo_description}</p>
          </div>
          <div className="tool-inset min-w-48 p-4 text-right">
            <p className="text-2xl font-semibold text-ink-primary">
              {emailStats.today.sent_count} / {emailStats.daily_limit}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {copy.admin.registration_brevo_used}{emailStats.today.quota_used_count}
              {' · '}{copy.admin.registration_brevo_remaining}{emailStats.today.remaining_count}
            </p>
            <p className={`mt-2 text-sm font-semibold ${emailStats.today.limit_reached ? 'text-error' : 'text-success'}`}>
              {emailStats.today.limit_reached ? copy.admin.registration_brevo_reached : copy.admin.registration_brevo_available}
            </p>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">{copy.admin.registration_brevo_date}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_sent}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_verification}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_reset}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_cancel}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_receipt}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_failed}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {emailStats.days.map((day) => (
                <tr key={day.date}>
                  <td className="px-3 py-3 font-mono text-ink-secondary">{day.date}</td>
                  <td className="px-3 py-3 font-semibold text-ink-primary">{day.sent_count}</td>
                  <td className="px-3 py-3 text-ink-secondary">{day.by_purpose.email_verification}</td>
                  <td className="px-3 py-3 text-ink-secondary">{day.by_purpose.password_reset}</td>
                  <td className="px-3 py-3 text-ink-secondary">{day.by_purpose.account_deletion_cancellation}</td>
                  <td className="px-3 py-3 text-ink-secondary">{day.by_purpose.account_deletion_receipt}</td>
                  <td className="px-3 py-3 text-ink-secondary">{day.failed_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-ink-muted">
          {copy.admin.registration_brevo_timezone}{emailStats.timezone}
          {emailStats.today.reserved_count + emailStats.today.uncertain_count > 0
            ? ` · ${copy.admin.registration_brevo_pending}${emailStats.today.reserved_count + emailStats.today.uncertain_count}`
            : ''}
        </p>
      </section>
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
        <fieldset className="mt-5 space-y-3">
          <legend className="text-sm font-semibold text-ink-primary">{copy.admin.registration_quota_action_title}</legend>
          <label className="tool-inset flex cursor-pointer gap-3 p-4 text-sm text-ink-secondary">
            <input
              type="radio"
              name="brevo-quota-action"
              value="pause_registration"
              checked={settings.brevo_quota_action === 'pause_registration'}
              onChange={() => setSettings((current) => ({ ...current, brevo_quota_action: 'pause_registration' }))}
              className="mt-1 h-4 w-4 accent-brand-600"
            />
            <span><strong className="block text-ink-primary">{copy.admin.registration_quota_pause}</strong>{copy.admin.registration_quota_pause_help}</span>
          </label>
          <label className="tool-inset flex cursor-pointer gap-3 p-4 text-sm text-ink-secondary">
            <input
              type="radio"
              name="brevo-quota-action"
              value="allow_unverified_registration"
              checked={settings.brevo_quota_action === 'allow_unverified_registration'}
              onChange={() => setSettings((current) => ({ ...current, brevo_quota_action: 'allow_unverified_registration' }))}
              className="mt-1 h-4 w-4 accent-brand-600"
            />
            <span><strong className="block text-ink-primary">{copy.admin.registration_quota_allow}</strong>{copy.admin.registration_quota_allow_help}</span>
          </label>
        </fieldset>
        {settings.brevo_quota_action === 'allow_unverified_registration' && (
          <div className="tool-alert tool-alert--error mt-4" role="note">{copy.admin.registration_quota_warning}</div>
        )}
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
