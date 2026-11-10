import { ScheduleComparisonIcon, NextIcon as ArrowRight, TrainingRatioIcon as Calculator, ProjectsIcon, CultivationIcon, ThanksRecruitmentIcon, MaterialDemandIcon, ManualScheduleIcon as CalendarClock, DepotValueIcon as Gem } from '../../../components/icons'
import { copy } from '../../../copy'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { useListReveal } from '../../../lib/use-list-reveal'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import Link from '../../../components/InternalLink'
import ManualScheduleEditor from '../../../components/result-panel/ManualScheduleEditor'
import ManualBlankScheduleSetup from '../../../components/ManualBlankScheduleSetup'
import OperatorSkillPreview from '../../../components/result-panel/OperatorSkillPreview'
import { OperatorAvatarTile } from '../../../components/result-panel/OperatorAvatarStrip'
import { useManualTool } from '../../ManualSchedulePage'
import { Field, Loading, Notice, SectionTitle } from '../components/WorkspaceUI'
import ManualResultExport from '../ManualResultExport'
import type { V2Workflow } from '../WorkspaceSections'
import type { V2Section } from '../navigation'
import { materialDemandCopy } from '../../../copy/zh-CN/material-demand'

export default function Tools({ profileId }: { profileId?: string }) {
  const { features } = useSiteFeatures()
  const reveal = useListReveal()
  const text = copy.tools.directory
  const groups = [
    { id: 'base', title: text.groups.base, tools: [
      { section: 'manual-tool' as const, enabled: features.manual_schedule, icon: CalendarClock, title: copy.tools.manualSchedule.title, description: text.descriptions.manualSchedule },
      { section: 'schedule-comparison' as const, enabled: features.manual_schedule, icon: ScheduleComparisonIcon, title: copy.tools.scheduleComparison.title, description: text.descriptions.scheduleComparison },
    ] },
    { id: 'cultivation', title: text.groups.cultivation, tools: [
      { section: 'cultivation-projects' as const, enabled: features.cultivation_plan, icon: ProjectsIcon, title: copy.cultivationProjects.title, description: text.descriptions.cultivationProjects },
      { section: 'cultivation' as const, enabled: features.cultivation_plan, icon: CultivationIcon, title: copy.tools.cultivation.title, description: text.descriptions.cultivation },
      { section: 'training-ratio' as const, enabled: features.tools, icon: Calculator, title: copy.trainingRatio.title, description: text.descriptions.trainingRatio },
      { section: 'thanks-recruitment' as const, enabled: features.thanks_recruitment, icon: ThanksRecruitmentIcon, title: copy.tools.thanksRecruitment.title, description: text.descriptions.thanksRecruitment },
    ] },
    { id: 'materials', title: text.groups.materials, tools: [
      { section: 'material-demand' as const, enabled: features.tools, icon: MaterialDemandIcon, title: materialDemandCopy.title, description: text.descriptions.materialDemand },
      { section: 'depot' as const, enabled: features.depot_value, icon: Gem, title: copy.dashboard.pages_tool_dashboard_ToolsSection_001, description: text.descriptions.depot },
    ] },
  ].map((group) => ({ ...group, tools: group.tools.filter((tool) => tool.enabled) })).filter((group) => group.tools.length)
  return <div ref={reveal} className="v2-tools-directory">
    {groups.map((group) => <section key={group.id} aria-labelledby={`v2-tool-group-${group.id}`}>
      <h2 id={`v2-tool-group-${group.id}`}>{group.title}</h2>
      <ul className="v2-tool-list">{group.tools.map((tool) => <li key={tool.section} data-reveal-id={tool.section}>
        <Link to={v2Path(tool.section, profileId)}><tool.icon size={24} aria-hidden="true" /><div><h3>{tool.title}</h3><p>{tool.description}</p></div><span className="v2-tool-enter"><ArrowRight size={20} aria-hidden="true" /></span></Link>
      </li>)}</ul>
    </section>)}
    {!groups.length && <Notice>{copy.v2.featureUnavailable}</Notice>}
  </div>
}

export function ManualTool({ session, workflow, onDirtyChange, onOpenProfile, onNavigate }: { session: V2Session; workflow?: V2Workflow; onDirtyChange: (dirty: boolean) => void; onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>; onNavigate: (section: V2Section) => void }) {
  const m = useManualTool({ session, embedded: true, onDirtyChange })
  const text = copy.tools.manualSchedule
  const operatorsPath = (profileId: string) => `${v2Path('overview', profileId)}&panel=operators`
  return <div className="v2-manual-workspace"><p className="v2-lead">{text.description}</p><p className="v2-muted">{text.access}</p>
    <div className="v2-manual-preparation">
      <section><span className="v2-step-number">01</span><SectionTitle title={copy.v2.setupAccount} />
        {session.authLoading ? <Loading label={text.loading} /> : session.authStatus === 'error' ? <Notice error>{session.authError?.message}<button className="v2-text-button" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button></Notice> : !m.profile ? <Notice>{text.unavailable}</Notice> : <>
          <label className="v2-field"><span>{text.profile}</span><select className="v2-input" value={m.ready ? m.profile.id : ''} disabled={Boolean(session.openingProfileId) || m.importing} onChange={(event) => { const profile = m.available.find((item) => item.id === event.target.value); if (profile) void onOpenProfile(profile) }}>{!m.ready && <option value="" disabled>{copy.common.pages_tool_useToolSession_004}</option>}{m.available.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
          {m.ready && !m.operators.some((operator) => operator.own) && <p>{text.operatorsRequired} <Link className="v2-text-button" to={operatorsPath(m.profile.id)}>{text.setup}</Link></p>}
          {m.ready && m.operators.some((operator) => operator.own) && <details className="v2-disclosure"><summary>{text.operators} · {m.operators.filter((operator) => operator.own).length}</summary><p>{copy.v2.manualOperatorsHelp}</p><OperatorSkillPreview><div className="v2-manual-operators">{m.operators.filter((operator) => operator.own).map((operator) => <div key={operator.id}><OperatorAvatarTile operator={operator} compact showFullNames /><small>{copy.domain.building_skills.unlock(operator.elite, Number(operator.level) || 1)}</small></div>)}</div></OperatorSkillPreview><Link className="v2-text-button" to={operatorsPath(m.profile.id)}>{text.editOperators}</Link></details>}
        </>}
      </section>
      <section><span className="v2-step-number">02</span><SectionTitle title={text.prepareSchedule} description={text.importHint} />
        <div className="v2-actions"><button className="v2-button v2-button-primary" disabled={!m.enabled} aria-busy={m.importing} onClick={() => m.upload.current?.click()}>{text.import}<ArrowRight size={16} /></button></div>
        <input ref={m.upload} type="file" accept=".json,application/json" hidden aria-label={text.import} disabled={!m.enabled} onChange={(event) => void m.importSchedule(event.target.files?.[0])} />
        <Field label={text.shiftHours} help={text.shiftHint} value={m.configuredHours} disabled={!m.enabled} onChange={(event) => m.setShiftHours(event.target.value)} />
        {m.draft && <Notice>{text.replace}</Notice>}
      </section>
    </div>
    <ManualBlankScheduleSetup key={m.profile?.id} config={m.baseConfig} preset={m.preset} enabled={m.enabled}
      onPresetChange={(preset) => { m.setPreset(preset); m.setConfigDraft(null) }}
      onUpdate={(mutate) => { const next = structuredClone(m.baseConfig); mutate(next); m.setConfigDraft(next) }} onStart={m.start} />
    <Notice error>{m.error ?? session.workspaceLoadError}{session.workspaceLoadError && m.profile && <button className="v2-text-button" disabled={Boolean(session.openingProfileId)} onClick={() => void session.refreshProfileWorkspace(m.profile!).catch(() => undefined)}>{text.retryWorkspace}</button>}</Notice>
    {m.canUse && m.draft && m.draft.profileId === m.profile?.id && <div className="v2-manual-editor"><ManualScheduleEditor revealCandidates key={`${m.draft.profileId}:${m.draft.revision}`} source={m.draft.source} profileId={m.draft.profileId} draftStorageKey={`tool:${m.draft.profileId}`} operators={m.operators} simulationBaseline={{ config: m.draft.config }} onDirtyChange={onDirtyChange} renderExport={(props) => workflow && <ManualResultExport key={props.resultId} {...props} workflow={workflow}
      onRecover={(action) => { onNavigate(action === 'login' ? 'generation' : action); if (action === 'login') session.retryAuth() }} />} /></div>}
  </div>
}
