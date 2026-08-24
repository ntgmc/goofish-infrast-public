import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { BrevoEmailStats, RegistrationSettings } from '../../../lib/types'
import { copy } from '../../../copy/index'
import AdminRegistrationInvitationsPanel from './AdminRegistrationInvitationsPanel'
import { AdminToast } from '../shared/AdminToast'

type RegistrationSettingsResponse = {
  settings: RegistrationSettings
  email_stats: BrevoEmailStats
}

export default function RegistrationSettingsSection() {
  const [settings, setSettings] = useState<RegistrationSettings | null>(null)
  const [emailStats, setEmailStats] = useState<BrevoEmailStats | null>(null)
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
      if (!data.settings || !data.email_stats) throw new Error(copy.admin.registration_load_failed)
      setSettings(data.settings)
      setEmailStats(data.email_stats)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!settings || !emailStats || loading || saving) return
    if (!validReserve(settings.admin_invite_email_reserve) || !validReserve(settings.password_reset_email_reserve)) {
      setError(null)
      return
    }
    if (settings.admin_invite_email_reserve + settings.password_reset_email_reserve > emailStats.daily_limit) {
      setError(null)
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<RegistrationSettingsResponse>('/api/admin/registration-settings', {
        method: 'PUT',
        json: {
          email_verification_required: settings.email_verification_required,
          invite_code_required: settings.invite_code_required,
          email_provider_priority: settings.email_provider_priority,
          brevo_quota_action: settings.brevo_quota_action,
          admin_invite_email_reserve: settings.admin_invite_email_reserve,
          password_reset_email_reserve: settings.password_reset_email_reserve,
        },
        fallbackMessage: copy.admin.registration_save_failed,
      })
      if (!data.settings || !data.email_stats) throw new Error(copy.admin.registration_save_failed)
      setSettings(data.settings)
      setEmailStats(data.email_stats)
      setNotice(copy.admin.registration_saved)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && (!settings || !emailStats)) {
    return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.admin.registration_loading}</div>
  }

  if (!settings || !emailStats) {
    return (
      <section className="tool-panel p-6" aria-live="polite">
        {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
        <button type="button" onClick={() => void load()} className="tool-secondary-action mt-4">
          {copy.admin.registration_reload}
        </button>
      </section>
    )
  }

  const standardCapacity = Math.max(0, emailStats.today.remaining_count - settings.admin_invite_email_reserve - settings.password_reset_email_reserve)
  const adminInviteCapacity = Math.max(0, emailStats.today.remaining_count - settings.password_reset_email_reserve)
  const passwordResetCapacity = emailStats.today.remaining_count
  const reservesInRange = validReserve(settings.admin_invite_email_reserve) && validReserve(settings.password_reset_email_reserve)
  const reserveTotalValid = settings.admin_invite_email_reserve + settings.password_reset_email_reserve <= emailStats.daily_limit

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}
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
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={copy.admin.registration_brevo_official_title}>
          <div className="tool-inset p-4">
            <p className="text-xs text-ink-muted">{copy.admin.registration_brevo_official_remaining}</p>
            <p className="mt-1 text-lg font-semibold text-ink-primary">
              {emailStats.official_quota.reported_remaining_count ?? copy.admin.registration_brevo_unknown}
            </p>
          </div>
          <div className="tool-inset p-4">
            <p className="text-xs text-ink-muted">{copy.admin.registration_brevo_official_used}</p>
            <p className="mt-1 text-lg font-semibold text-ink-primary">
              {emailStats.official_quota.reported_used_count ?? copy.admin.registration_brevo_unknown}
            </p>
          </div>
          <div className="tool-inset p-4">
            <p className="text-xs text-ink-muted">{copy.admin.registration_brevo_local_used}</p>
            <p className="mt-1 text-lg font-semibold text-ink-primary">{emailStats.today.local_quota_used_count}</p>
          </div>
          <div className="tool-inset p-4">
            <p className="text-xs text-ink-muted">{copy.admin.registration_brevo_external_offset}</p>
            <p className="mt-1 text-lg font-semibold text-ink-primary">{emailStats.official_quota.external_used_offset}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <span>{copy.admin.registration_brevo_sync_status}{officialQuotaStatusLabel(emailStats.official_quota.status)}</span>
          <span>
            {copy.admin.registration_brevo_synced_at}
            {emailStats.official_quota.synced_at
              ? new Date(emailStats.official_quota.synced_at).toLocaleString('zh-CN')
              : copy.admin.registration_brevo_never_synced}
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-label={copy.admin.registration_reserve_title}>
          <CapacityCard label={copy.admin.registration_capacity_standard} value={standardCapacity} />
          <CapacityCard label={copy.admin.registration_capacity_admin_invite} value={adminInviteCapacity} />
          <CapacityCard label={copy.admin.registration_capacity_password_reset} value={passwordResetCapacity} />
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">{copy.admin.registration_brevo_date}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_sent}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_verification}</th>
                <th className="px-3 py-2">{copy.admin.registration_brevo_admin_invite_verification}</th>
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
                  <td className="px-3 py-3 text-ink-secondary">{day.by_purpose.admin_invite_verification}</td>
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
          <div className="flex flex-col gap-3">
            <label className="tool-inset flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm font-semibold text-ink-secondary">
              <input
                type="checkbox"
                checked={settings.email_verification_required}
                onChange={(event) => {
                  const emailVerificationRequired = event.currentTarget.checked
                  setSettings((current) => current
                    ? { ...current, email_verification_required: emailVerificationRequired }
                    : current)
                }}
                className="h-4 w-4 accent-brand-600"
              />
              {copy.admin.registration_toggle}
            </label>
            <label className="tool-inset flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm font-semibold text-ink-secondary">
              <input
                type="checkbox"
                checked={settings.invite_code_required}
                onChange={(event) => {
                  const inviteCodeRequired = event.currentTarget.checked
                  setSettings((current) => current ? { ...current, invite_code_required: inviteCodeRequired } : current)
                }}
                className="h-4 w-4 accent-brand-600"
              />
              {copy.admin.registration_invite_toggle}
            </label>
          </div>
        </div>
        <div className="tool-inset mt-5 p-4 text-sm leading-6 text-ink-secondary">
          <p>{copy.admin.registration_enabled_help}</p>
          <p className="mt-2">{copy.admin.registration_disabled_help}</p>
          <p className="mt-2">{copy.admin.registration_invite_help}</p>
        </div>
        <fieldset className="mt-5 space-y-3">
          <legend className="text-sm font-semibold text-ink-primary">{copy.admin.registration_provider_priority_title}</legend>
          <p className="text-sm leading-6 text-ink-secondary">{copy.admin.registration_provider_priority_help}</p>
          <label className="tool-inset flex cursor-pointer gap-3 p-4 text-sm text-ink-secondary">
            <input
              type="radio"
              name="email-provider-priority"
              value="brevo-first"
              checked={settings.email_provider_priority[0] === 'brevo'}
              onChange={() => setSettings((current) => current
                ? { ...current, email_provider_priority: ['brevo', 'ses'] }
                : current)}
              className="mt-1 h-4 w-4 accent-brand-600"
            />
            <span><strong className="block text-ink-primary">{copy.admin.registration_provider_brevo_first}</strong>{copy.admin.registration_provider_brevo_first_help}</span>
          </label>
          <label className="tool-inset flex cursor-pointer gap-3 p-4 text-sm text-ink-secondary">
            <input
              type="radio"
              name="email-provider-priority"
              value="ses-first"
              checked={settings.email_provider_priority[0] === 'ses'}
              onChange={() => setSettings((current) => current
                ? { ...current, email_provider_priority: ['ses', 'brevo'] }
                : current)}
              className="mt-1 h-4 w-4 accent-brand-600"
            />
            <span><strong className="block text-ink-primary">{copy.admin.registration_provider_ses_first}</strong>{copy.admin.registration_provider_ses_first_help}</span>
          </label>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink-primary">{copy.admin.registration_reserve_title}</legend>
          <p id="registration-reserve-help" className="mt-2 text-sm leading-6 text-ink-secondary">{copy.admin.registration_reserve_help}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ReserveInput
              id="admin-invite-email-reserve"
              label={copy.admin.registration_admin_invite_reserve}
              value={settings.admin_invite_email_reserve}
              describedBy="registration-reserve-help registration-reserve-error"
              invalid={!validReserve(settings.admin_invite_email_reserve)}
              onChange={(value) => setSettings((current) => current
                ? { ...current, admin_invite_email_reserve: value }
                : current)}
            />
            <ReserveInput
              id="password-reset-email-reserve"
              label={copy.admin.registration_password_reset_reserve}
              value={settings.password_reset_email_reserve}
              describedBy="registration-reserve-help registration-reserve-error"
              invalid={!validReserve(settings.password_reset_email_reserve)}
              onChange={(value) => setSettings((current) => current
                ? { ...current, password_reset_email_reserve: value }
                : current)}
            />
          </div>
          <p className={`mt-3 text-sm ${!reservesInRange || !reserveTotalValid ? 'text-error' : 'text-ink-muted'}`} role="status" aria-live="polite">
            已保留 {settings.admin_invite_email_reserve + settings.password_reset_email_reserve} / {emailStats.daily_limit} 封
          </p>
          {(!reservesInRange || !reserveTotalValid) && (
            <p id="registration-reserve-error" className="mt-2 text-sm text-error" role="alert">
              {!reservesInRange ? copy.admin.registration_reserve_range_error : copy.admin.registration_reserve_total_error}
            </p>
          )}
        </fieldset>
        <fieldset className="mt-5 space-y-3">
          <legend className="text-sm font-semibold text-ink-primary">{copy.admin.registration_quota_action_title}</legend>
          <label className="tool-inset flex cursor-pointer gap-3 p-4 text-sm text-ink-secondary">
            <input
              type="radio"
              name="brevo-quota-action"
              value="pause_registration"
              checked={settings.brevo_quota_action === 'pause_registration'}
              onChange={() => setSettings((current) => current
                ? { ...current, brevo_quota_action: 'pause_registration' }
                : current)}
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
              onChange={() => setSettings((current) => current
                ? { ...current, brevo_quota_action: 'allow_unverified_registration' }
                : current)}
              className="mt-1 h-4 w-4 accent-brand-600"
            />
            <span><strong className="block text-ink-primary">{copy.admin.registration_quota_allow}</strong>{copy.admin.registration_quota_allow_help}</span>
          </label>
        </fieldset>
        {settings.brevo_quota_action === 'allow_unverified_registration' && (
          <div className="tool-alert tool-alert--error mt-4" role="note">{copy.admin.registration_quota_warning}</div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || loading} className="tool-primary-action">{saving ? copy.admin.registration_saving : copy.admin.registration_save}</button>
          <button type="button" disabled={saving || loading} onClick={() => void load()} className="tool-secondary-action">{copy.admin.registration_reload}</button>
          <span className="text-xs text-ink-muted">
            {copy.admin.registration_updated}{settings.updated_at ? new Date(settings.updated_at).toLocaleString('zh-CN') : copy.admin.registration_default}
          </span>
        </div>
      </section>
      <AdminRegistrationInvitationsPanel />
    </form>
  )
}

function CapacityCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="tool-inset p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink-primary">{value}</p>
    </div>
  )
}

function ReserveInput({ id, label, value, describedBy, invalid, onChange }: {
  id: string
  label: string
  value: number
  describedBy: string
  invalid: boolean
  onChange: (value: number) => void
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}</span>
      <input
        id={id}
        type="number"
        min={0}
        max={300}
        step={1}
        value={value}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="tool-field"
      />
    </label>
  )
}

function validReserve(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 300
}

function officialQuotaStatusLabel(status: BrevoEmailStats['official_quota']['status']): string {
  if (status === 'fresh') return copy.admin.registration_brevo_sync_fresh
  if (status === 'stale') return copy.admin.registration_brevo_sync_stale
  return copy.admin.registration_brevo_sync_unavailable
}
