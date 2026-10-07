import { useState } from 'react'
import { Bell, LockKeyhole, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { copy } from '../../../copy'
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from '../../../lib/auth-constraints'
import { deletionEmailMessage, formatAccountDeletionDeadline } from '../../../lib/account-lifecycle-client'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import AnimationSettings from '../../../components/AnimationSettings'
import DebugModePanel from '../../../components/DebugModePanel'
import QqBotSettingsPanel from '../../../components/QqBotSettingsPanel'
import { useAccountSettings } from '../../tool/dashboard/SettingsSection'
import type { V2Session } from '../OptionsDrawer'
import { EmptyState, Field, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.dashboard.settings
const labels = copy.dashboard

export default function Settings({ session }: { session: V2Session }) {
  const { features } = useSiteFeatures()
  const model = useAccountSettings({ profiles: session.profiles, onPayload: session.applyAuthPayload })
  const [section, setSection] = useState('security')
  const sections = [
    { id: 'security', label: text.security, icon: LockKeyhole, hint: text.password_help },
    { id: 'preferences', label: text.preferences, icon: SlidersHorizontal, hint: copy.v2.preferenceDescription },
    ...(features.qqbot ? [{ id: 'notifications', label: copy.notifications.title, icon: Bell, hint: copy.notifications.title }] : []),
    { id: 'data', label: text.data, icon: ShieldCheck, hint: text.deletion_help },
  ]
  return <div className="v2-settings-workspace">
    <nav className="v2-settings-index" aria-label={text.navigation}>{sections.map((item) => <button key={item.id} type="button" aria-label={item.label} aria-pressed={section === item.id} onClick={() => setSection(item.id)}><item.icon size={20} aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</nav>
    <div className="v2-settings-content">
      <section hidden={section !== 'security'}>
        <SectionTitle title={text.security} description={text.password_help} />
        <form className="v2-settings-form" onSubmit={model.submit} noValidate>
          <Notice error>{model.error}</Notice><Notice>{model.status}</Notice>
          {([
            ['oldPassword', labels.pages_tool_dashboard_SettingsSection_017, model.oldPassword, model.setOldPassword, 'current-password'],
            ['newPassword', labels.pages_tool_dashboard_SettingsSection_018, model.newPassword, model.setNewPassword, 'new-password'],
            ['confirmPassword', labels.pages_tool_dashboard_SettingsSection_019, model.confirmPassword, model.setConfirmPassword, 'new-password'],
          ] as const).map(([key, label, value, update, autocomplete]) => <div key={key}><Field label={label} type="password" autoComplete={autocomplete} value={value} maxLength={AUTH_PASSWORD_MAX_LENGTH} aria-invalid={Boolean(model.fieldErrors[key])} aria-describedby={model.fieldErrors[key] ? `v2-${key}-error` : undefined} onChange={(event) => { update(event.target.value); model.clearFieldError(key); if (key === 'newPassword') model.clearFieldError('confirmPassword') }} onFocus={() => model.clearFieldError(key)} />{model.fieldErrors[key] && <p id={`v2-${key}-error`} role="alert" className="v2-field-error">{model.fieldErrors[key]}</p>}</div>)}
          <button type="submit" className="v2-button v2-button-primary" disabled={model.loading}>{model.loading ? labels.pages_tool_dashboard_SettingsSection_020 : labels.pages_tool_dashboard_SettingsSection_021}</button>
        </form>
      </section>
      <section hidden={section !== 'preferences'}><SectionTitle title={text.preferences} description={copy.v2.preferenceDescription} /><AnimationSettings className="v2-preference-control" /><DebugModePanel /></section>
      {features.qqbot && <section hidden={section !== 'notifications'}><QqBotSettingsPanel /></section>}
      <section hidden={section !== 'data'}>
        <SectionTitle title={text.data} />
        <Notice error>{model.privacyError}</Notice><Notice>{model.privacyStatus}</Notice>
        <h3 className="v2-subheading">{text.credentials}</h3>
        {model.boundProfiles.length === 0 ? <EmptyState title={text.no_credentials} /> : <div className="v2-credential-list">{model.boundProfiles.map((profile) => {
          const available = profile.skland_binding?.credential_status === 'available' && !model.clearedCredentialIds.has(profile.id)
          return <article key={profile.id}><div><h3>{profile.display_name}</h3><p>{available ? labels.pages_tool_dashboard_SettingsSection_035 : labels.pages_tool_dashboard_SettingsSection_038}</p></div>{available && <button type="button" className="v2-button v2-button-secondary" disabled={model.privacyLoading !== null} onClick={() => void model.clearCredential(profile)}>{labels.pages_tool_dashboard_SettingsSection_026}</button>}</article>
        })}</div>}
        <details className="v2-disclosure"><summary>{text.privacy_details}</summary><p>{labels.pages_tool_dashboard_SettingsSection_023}</p></details>
        <details className="v2-disclosure v2-danger-zone" open={Boolean(model.deletion)}><summary>{labels.pages_tool_dashboard_SettingsSection_029}</summary><p>{text.deletion_help}</p><p>{labels.pages_tool_dashboard_SettingsSection_030}</p><Notice error>{model.deletionError}</Notice>
          {model.deletion ? <div role="status"><h3>{copy.features.delete_accepted_title}</h3><p>{copy.features.delete_accepted_before}<strong>{formatAccountDeletionDeadline(model.deletion.scheduled_for)}</strong>{copy.features.delete_accepted_after}</p><p>{deletionEmailMessage(model.deletion.cancellation_email)}</p><button className="v2-button v2-button-primary" onClick={() => void session.handleLogout()}>{copy.features.delete_accepted_leave}</button></div> : <form className="v2-settings-form" onSubmit={(event) => { event.preventDefault(); void model.requestDeletion() }}>
            <Field label={labels.pages_tool_dashboard_SettingsSection_031} type="email" autoComplete="email" value={model.deleteEmail} maxLength={AUTH_EMAIL_MAX_LENGTH} onChange={(event) => model.setDeleteEmail(event.target.value)} />
            <Field label={labels.pages_tool_dashboard_SettingsSection_032} type="password" autoComplete="current-password" value={model.deletePassword} maxLength={AUTH_PASSWORD_MAX_LENGTH} onChange={(event) => model.setDeletePassword(event.target.value)} />
            <button type="submit" className="v2-button v2-button-danger" disabled={model.privacyLoading !== null || !model.deleteEmail || !model.deletePassword}>{model.privacyLoading === 'delete' ? labels.pages_tool_dashboard_SettingsSection_033 : labels.pages_tool_dashboard_SettingsSection_034}</button>
          </form>}
        </details>
      </section>
    </div>
  </div>
}
