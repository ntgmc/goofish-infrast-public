import { copy } from '../../copy'
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from '../../lib/auth-constraints'
import type { useAccountSettings } from '../../hooks/useAccountSettings'
import AccountDeletionSurvey from '../../components/AccountDeletionSurvey'
import { EmptyState, Field, Notice, SectionTitle } from './components/WorkspaceUI'

const text = copy.dashboard.settings
const labels = copy.dashboard

export default function AccountDataSettings({ model, safetyOnly = false }: {
  model: ReturnType<typeof useAccountSettings>
  safetyOnly?: boolean
}) {
  return <>
    <SectionTitle title={text.data} />
    <Notice error>{model.privacyError}</Notice><Notice>{model.privacyStatus}</Notice>
    {!safetyOnly && <>
      <h3 className="v2-subheading">{text.credentials}</h3>
      {model.boundProfiles.length === 0 ? <EmptyState title={text.no_credentials} /> : <div className="v2-credential-list">{model.boundProfiles.map((profile) => {
        const available = profile.skland_binding?.credential_status === 'available' && !model.clearedCredentialIds.has(profile.id)
        return <article key={profile.id}><div><h3>{profile.display_name}</h3><p>{available ? labels.pages_tool_dashboard_SettingsSection_035 : labels.pages_tool_dashboard_SettingsSection_038}</p></div>{available && <button type="button" className="v2-button v2-button-secondary" disabled={model.privacyLoading !== null} onClick={() => void model.clearCredential(profile)}>{labels.pages_tool_dashboard_SettingsSection_026}</button>}</article>
      })}</div>}
    </>}
    <details className="v2-disclosure"><summary>{text.privacy_details}</summary><p>{labels.pages_tool_dashboard_SettingsSection_023}</p></details>
    <details className="v2-disclosure v2-danger-zone"><summary>{labels.pages_tool_dashboard_SettingsSection_029}</summary><p>{labels.pages_tool_dashboard_SettingsSection_030}</p><Notice error>{model.deletionError}</Notice>
      <form className="v2-settings-form" onSubmit={(event) => { event.preventDefault(); void model.requestDeletion() }}>
        <AccountDeletionSurvey reason={model.deleteReason} detail={model.deleteDetail} onReasonChange={model.setDeleteReason} onDetailChange={model.setDeleteDetail} fieldClassName="v2-input" />
        <Field label={labels.pages_tool_dashboard_SettingsSection_031} type="email" autoComplete="email" value={model.deleteEmail} maxLength={AUTH_EMAIL_MAX_LENGTH} onChange={(event) => model.setDeleteEmail(event.target.value)} />
        <Field label={labels.pages_tool_dashboard_SettingsSection_032} type="password" autoComplete="current-password" value={model.deletePassword} maxLength={AUTH_PASSWORD_MAX_LENGTH} onChange={(event) => model.setDeletePassword(event.target.value)} />
        <button type="submit" className="v2-button v2-button-danger" disabled={model.privacyLoading !== null || !model.deleteEmail || !model.deletePassword || !model.deleteReason}>{model.privacyLoading === 'delete' ? labels.pages_tool_dashboard_SettingsSection_033 : labels.pages_tool_dashboard_SettingsSection_034}</button>
      </form>
    </details>
  </>
}
