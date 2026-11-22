import { useState } from 'react'
import { NotificationSettingsIcon as Bell, SecurityIcon as LockKeyhole, PersonalDataIcon as ShieldCheck, PreferencesIcon as SlidersHorizontal } from '../../../components/icons'
import { copy } from '../../../copy'
import { AUTH_PASSWORD_MAX_LENGTH } from '../../../lib/auth-constraints'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import AppearanceSettings from '../AppearanceSettings'
import { AnimationInspectorSetting } from '../AnimationInspector'
import DeploymentPromptPreview from '../DeploymentPromptPreview'
import DebugModePanel from '../../../components/DebugModePanel'
import QqBotSettingsPanel from '../../../components/QqBotSettingsPanel'
import { useAccountSettings } from '../../../hooks/useAccountSettings'
import AccountDataSettings from '../AccountDataSettings'
import type { V2Session } from '../OptionsDrawer'
import { Field, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.dashboard.settings
const labels = copy.dashboard

export default function Settings({ session }: { session: V2Session }) {
  const { features } = useSiteFeatures()
  const model = useAccountSettings({ profiles: session.profiles, activeProfileId: session.activeProfile?.id, onPayload: session.applyAuthPayload })
  const [section, setSection] = useState('security')
  const sections = [
    { id: 'security', label: text.security, icon: LockKeyhole },
    { id: 'preferences', label: text.preferences, icon: SlidersHorizontal },
    ...(features.qqbot ? [{ id: 'notifications', label: copy.notifications.title, icon: Bell }] : []),
    { id: 'data', label: text.data, icon: ShieldCheck },
  ]
  return <div className="v2-settings-workspace">
    <nav className="v2-settings-index" aria-label={text.navigation}>{sections.map((item) => <button key={item.id} type="button" aria-label={item.label} aria-pressed={section === item.id} onClick={() => setSection(item.id)}><item.icon size={20} aria-hidden="true" /><span><strong>{item.label}</strong></span></button>)}</nav>
    <div className="v2-settings-content">
      <section hidden={section !== 'security'}>
        <SectionTitle title={text.security} />
        <form className="v2-settings-form" onSubmit={model.submit} noValidate>
          <Notice error>{model.error}</Notice><Notice>{model.status}</Notice>
          {([
            ['oldPassword', labels.pages_tool_dashboard_SettingsSection_017, model.oldPassword, model.setOldPassword, 'current-password'],
            ['newPassword', labels.pages_tool_dashboard_SettingsSection_018, model.newPassword, model.setNewPassword, 'new-password'],
            ['confirmPassword', labels.pages_tool_dashboard_SettingsSection_019, model.confirmPassword, model.setConfirmPassword, 'new-password'],
          ] as const).map(([key, label, value, update, autocomplete]) => <div key={key}><Field label={label} type="password" autoComplete={autocomplete} value={value} maxLength={AUTH_PASSWORD_MAX_LENGTH} aria-invalid={Boolean(model.fieldErrors[key])} aria-describedby={model.fieldErrors[key] ? `v2-${key}-error` : undefined} onChange={(event) => { update(event.target.value); model.clearFieldError(key); if (key === 'newPassword') model.clearFieldError('confirmPassword') }} onFocus={() => model.clearFieldError(key)} />{model.fieldErrors[key] && <p id={`v2-${key}-error`} role="alert" className="v2-field-error">{model.fieldErrors[key]}</p>}</div>)}
          <button type="submit" className="v2-button v2-button-primary" disabled={model.loading} aria-busy={model.loading}>{model.loading ? labels.pages_tool_dashboard_SettingsSection_020 : labels.pages_tool_dashboard_SettingsSection_021}</button>
        </form>
      </section>
      <section hidden={section !== 'preferences'}><SectionTitle title={text.preferences} /><div className="v2-preference-control v2-appearance-settings"><AppearanceSettings /><AnimationInspectorSetting /><DeploymentPromptPreview /></div><DebugModePanel /></section>
      {features.qqbot && <section hidden={section !== 'notifications'}><QqBotSettingsPanel /></section>}
      <section hidden={section !== 'data'}>
        <AccountDataSettings model={model} />
      </section>
    </div>
  </div>
}
