import { useState } from 'react'
import { ArrowRight, Check, Search, UserRound } from 'lucide-react'
import { copy } from '../../../copy'
import type { V2Session } from '../OptionsDrawer'
import { useProfiles, useProfileDetails } from '../../tool/dashboard/ProfilesSection'
import { formatDate, formatShanghaiDateTime, getProfileAccessLabel, isFreePreviewProfile } from '../../tool/tool-utils'
import type { AuthSuccessResponse, UserGameAccount } from '../../../lib/types'
import { EmptyState, Facts, Field, Notice } from '../components/WorkspaceUI'
import { useSiteFeatures } from '../../../lib/site-feature-context'

const text = copy.dashboard

export default function Accounts({ session, onOpen }: { session: V2Session; onOpen: (profile: UserGameAccount) => Promise<void> }) {
  const { features } = useSiteFeatures()
  const model = useProfiles({ profiles: session.cdkProfiles, onEdit: session.applyAuthPayload, meteredEnabled: features.metered_billing })
  const [chosen, setChosen] = useState(session.activeProfile?.id ?? '')
  const [search, setSearch] = useState('')
  const profiles = model.profiles.filter((profile) => `${profile.display_name} ${profile.note ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const selected = profiles.find((profile) => profile.id === chosen) ?? profiles[0]
  return <div className="v2-accounts">
    <Notice error>{model.meteredError}</Notice>
    {model.meteredEnabled && !model.profiles.some((profile) => profile.kind === 'metered_personal') && <button className="v2-button v2-button-secondary" disabled={model.meteredBusy} onClick={() => model.createMetered()}>{copy.metered.personal_profiles.create}</button>}
    {model.profiles.length === 0 ? <EmptyState title={text.pages_tool_dashboard_ProfilesSection_001}>{text.pages_tool_dashboard_ProfilesSection_002}</EmptyState> : <div className="v2-selection-workspace">
      <aside className="v2-account-index">
        <label className="v2-search"><Search size={18} aria-hidden="true" /><input aria-label={copy.v2.profileSearch} placeholder={copy.v2.profileSearch} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="v2-selection-list" role="group" aria-label={copy.v2.account}>
          {profiles.map((profile, index) => <button key={profile.id} type="button" className="v2-account-choice" aria-pressed={selected?.id === profile.id} onClick={() => setChosen(profile.id)}>
            <span className="v2-account-monogram">{(profile.display_name || 'D').slice(0, 1)}</span><span><strong>{profile.display_name || `${text.pages_tool_dashboard_ProfilesSection_003}${index + 1}`}</strong><small>{getProfileAccessLabel(profile)}</small></span>{profile.id === session.activeProfile?.id && <Check size={16} aria-label={copy.v2.currentAccount} />}
          </button>)}
        </div>
        {!profiles.length && <p className="v2-muted">{copy.v2.noMatches}</p>}
      </aside>
      {selected && <AccountDetails key={selected.id} profile={selected} opening={session.openingProfileId === selected.id} onOpen={() => void onOpen(selected)} onSaved={session.applyAuthPayload} onConvert={() => model.createMetered(selected.id)} meteredEnabled={model.meteredEnabled} converting={model.meteredBusy} />}
    </div>}
    {model.declarationDialog}
  </div>
}

function AccountDetails({ profile, opening, onOpen, onSaved, onConvert, meteredEnabled, converting }: { profile: UserGameAccount; opening: boolean; onOpen: () => void; onSaved: (payload: AuthSuccessResponse) => void; onConvert: () => void; meteredEnabled: boolean; converting: boolean }) {
  const model = useProfileDetails(profile, text.pages_tool_dashboard_ProfilesSection_003, onSaved)
  return <article className="v2-account-detail">
    <div className="v2-detail-heading"><UserRound size={28} aria-hidden="true" /><div><span className="v2-label">{getProfileAccessLabel(profile)}</span><h2>{profile.display_name || text.pages_tool_dashboard_ProfilesSection_003}</h2></div></div>
    {model.description && <p className="v2-lead">{model.description}</p>}
    <Facts items={[
      [copy.v2.operatorData, profile.operator_count ?? 0],
      [copy.v2.updated, formatDate(profile.updated_at)],
      [copy.v2.validity, model.activeTrial ? formatShanghaiDateTime(model.activeTrial.ends_at) : profile.expires_at ? formatShanghaiDateTime(profile.expires_at) : copy.inventory.permanent],
    ]} />
    <div className="v2-actions"><button className="v2-button v2-button-primary" disabled={opening} onClick={onOpen}>{opening ? text.pages_tool_dashboard_ProfilesSection_009 : text.pages_tool_dashboard_ProfilesSection_010}<ArrowRight size={16} /></button><button className="v2-text-button" onClick={() => model.setEditing(!model.editing)} aria-expanded={model.editing}>{text.pages_tool_dashboard_ProfilesSection_011}</button></div>
    {meteredEnabled && isFreePreviewProfile(profile) && <button className="v2-button v2-button-secondary" disabled={converting} onClick={onConvert}>{copy.metered.personal_profiles.convert}</button>}
    {model.editing && <form className="v2-inline-editor" onSubmit={(event) => { event.preventDefault(); void model.save() }}>
      <Notice error>{model.error}</Notice>
      <Field label={text.pages_tool_dashboard_ProfilesSection_012} value={model.displayName} maxLength={40} onChange={(event) => model.setDisplayName(event.target.value)} />
      <label className="v2-field"><span>{text.pages_tool_dashboard_ProfilesSection_013}</span><textarea className="v2-input" value={model.note ?? ''} maxLength={500} rows={3} onChange={(event) => model.setNote(event.target.value)} /></label>
      <button className="v2-button v2-button-primary" type="submit">{text.pages_tool_dashboard_ProfilesSection_015}</button>
    </form>}
  </article>
}
