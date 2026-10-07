import { ArrowRight, CalendarDays, CalendarClock, Gem } from 'lucide-react'
import { copy } from '../../../copy'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { CONFIG_PRESETS } from '../../../lib/config'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import Link from '../../../components/InternalLink'
import ManualScheduleEditor from '../../../components/result-panel/ManualScheduleEditor'
import FacilityLayoutEditor from '../../../components/FacilityLayoutEditor'
import OperatorSkillPreview from '../../../components/result-panel/OperatorSkillPreview'
import { OperatorAvatarTile } from '../../../components/result-panel/OperatorAvatarStrip'
import { useManualTool } from '../../ManualSchedulePage'
import { Field, Notice, SectionTitle } from '../components/WorkspaceUI'

export default function Tools({ profileId }: { profileId?: string }) {
  const { features } = useSiteFeatures()
  const tools = [
    { section: 'manual-tool' as const, enabled: features.manual_schedule, icon: CalendarClock, title: copy.tools.manualSchedule.title, description: copy.tools.manualSchedule.description },
    { section: 'cultivation' as const, enabled: features.cultivation_plan, icon: CalendarDays, title: copy.tools.cultivation.title, description: copy.tools.cultivation.description },
    { section: 'depot' as const, enabled: features.depot_value, icon: Gem, title: copy.dashboard.pages_tool_dashboard_ToolsSection_001, description: copy.tools.pages_DepotValuePage_011 },
  ].filter((tool) => tool.enabled)
  return <div className="v2-tools-directory">{tools.map((tool, index) => <Link key={tool.section} to={v2Path(tool.section, profileId)}><span className="v2-tool-number">0{index + 1}</span><tool.icon size={28} aria-hidden="true" /><div><h2>{tool.title}</h2><p>{tool.description}</p></div><span className="v2-tool-enter"><ArrowRight size={22} aria-hidden="true" /></span></Link>)}{!tools.length && <Notice>{copy.v2.featureUnavailable}</Notice>}</div>
}

export function ManualTool({ session, onDirtyChange, onOpenProfile }: { session: V2Session; onDirtyChange: (dirty: boolean) => void; onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void> }) {
  const m = useManualTool({ session, embedded: true, onDirtyChange })
  const text = copy.tools.manualSchedule
  const operatorsPath = (profileId: string) => `${v2Path('overview', profileId)}&panel=operators`
  return <div className="v2-manual-workspace"><p className="v2-lead">{text.description}</p><p className="v2-muted">{text.access}</p>
    <div className="v2-manual-preparation">
      <section><span className="v2-step-number">01</span><SectionTitle title={copy.v2.setupAccount} />
        {session.authLoading ? <Notice>{text.loading}</Notice> : session.authStatus === 'error' ? <Notice error>{session.authError?.message}<button className="v2-text-button" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button></Notice> : !m.profile ? <Notice>{text.unavailable}</Notice> : <>
          <label className="v2-field"><span>{text.profile}</span><select className="v2-input" value={m.ready ? m.profile.id : ''} disabled={Boolean(session.openingProfileId) || m.importing} onChange={(event) => { const profile = m.available.find((item) => item.id === event.target.value); if (profile) void onOpenProfile(profile) }}>{!m.ready && <option value="" disabled>{copy.common.pages_tool_useToolSession_004}</option>}{m.available.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
          {m.ready && !m.operators.some((operator) => operator.own) && <p>{text.operatorsRequired} <Link className="v2-text-button" to={operatorsPath(m.profile.id)}>{text.setup}</Link></p>}
          {m.ready && m.operators.some((operator) => operator.own) && <details className="v2-disclosure"><summary>{text.operators} · {m.operators.filter((operator) => operator.own).length}</summary><p>{text.operatorsHint}</p><OperatorSkillPreview><div className="v2-manual-operators">{m.operators.filter((operator) => operator.own).map((operator) => <div key={operator.id}><OperatorAvatarTile operator={operator} compact showFullNames /><small>{copy.domain.building_skills.unlock(operator.elite, Number(operator.level) || 1)}</small></div>)}</div></OperatorSkillPreview><Link className="v2-text-button" to={operatorsPath(m.profile.id)}>{text.editOperators}</Link></details>}
        </>}
      </section>
      <section><span className="v2-step-number">02</span><SectionTitle title={copy.v2.setupLayout} description={text.configHint} />
        <label className="v2-field"><span>{text.layout}</span><select className="v2-input" value={m.preset} disabled={!m.enabled} onChange={(event) => { m.setPreset(event.target.value); m.setConfigDraft(null) }}><option value="">{text.currentLayout}</option>{Object.entries(CONFIG_PRESETS).map(([key, config]) => <option key={key} value={key}>{config.desc}</option>)}</select></label>
        <Field label={text.shiftHours} help={text.shiftHint} value={m.configuredHours} disabled={!m.enabled} onChange={(event) => m.setShiftHours(event.target.value)} />
        {m.ready && m.profile && m.baseConfig.layout === '2-5-2' && <FacilityLayoutEditor key={`${m.profile.id}:${m.preset}`} config={m.baseConfig} onUpdate={(mutate) => { const next = structuredClone(m.baseConfig); mutate(next); m.setConfigDraft(next) }} />}
      </section>
      <section><span className="v2-step-number">03</span><SectionTitle title={copy.v2.setupSchedule} description={text.importHint} /><div className="v2-actions"><button className="v2-button v2-button-primary" disabled={!m.enabled} onClick={m.start}>{text.start}<ArrowRight size={16} /></button><button className="v2-button v2-button-secondary" disabled={!m.enabled} onClick={() => m.upload.current?.click()}>{text.import}</button></div><input ref={m.upload} type="file" accept=".json,application/json" hidden aria-label={text.import} disabled={!m.enabled} onChange={(event) => void m.importSchedule(event.target.files?.[0])} />{m.draft && <Notice>{text.replace}</Notice>}</section>
    </div>
    <Notice error>{m.error ?? session.workspaceLoadError}{session.workspaceLoadError && m.profile && <button className="v2-text-button" disabled={Boolean(session.openingProfileId)} onClick={() => void session.refreshProfileWorkspace(m.profile!).catch(() => undefined)}>{text.retryWorkspace}</button>}</Notice>
    {m.canUse && m.draft && m.draft.profileId === m.profile?.id && <div className="v2-manual-editor"><ManualScheduleEditor key={`${m.draft.profileId}:${m.draft.revision}`} source={m.draft.source} profileId={m.draft.profileId} draftStorageKey={`tool:${m.draft.profileId}`} operators={m.operators} simulationBaseline={{ config: m.draft.config }} onDirtyChange={onDirtyChange} /></div>}
  </div>
}
