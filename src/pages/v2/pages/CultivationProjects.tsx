import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NextIcon as ArrowRight, AddIcon as Plus, RefreshIcon, SaveIcon, CultivationIcon, ResourceCalendarIcon, DailyOutputIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import OperatorPicker from '../../../components/OperatorPicker'
import { AnimatedValue } from '../../../components/MotionPrimitives'
import { TweenValue } from '../../../components/NumberMotion'
import { DataActivity, DataRefresh, DataSkeleton } from '../components/DataActivity'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog'
import { Tabs } from '../../../components/ui/tabs'
import { Avatar } from '../ScheduleBoard'
import { canEditConfig } from '../../../lib/license'
import { isCultivationProject, prepareProjectProduction, type CultivationProject, type ProjectOperator, type ProjectRoute } from '../../../lib/cultivation-projects'
import type { CultivationData } from '../../../lib/cultivation-contract'
import type { UserGameAccount, WorkspaceResultHistorySummary } from '../../../lib/types'
import { useCultivationProjects } from '../../cultivation/useCultivationProjects'
import Link from '../../../components/InternalLink'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import { EmptyState, Facts, Field, Loading, Notice, SectionTitle } from '../components/WorkspaceUI'
import { MaterialBrowser, MaterialButton } from './ProjectMaterials'
import ProjectGoal from './ProjectGoal'
import { ProjectMaaExport } from './ProjectMaaExport'
import './cultivation-projects.css'

const text = copy.cultivationProjects
const number = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const profession = (operator: ProjectOperator) => copy.tools.cultivation.professions[operator.profession as keyof typeof copy.tools.cultivation.professions] ?? ''

export default function CultivationProjects({ session, onConfig }: { session: V2Session; onConfig: () => void }) {
  const profile = session.activeProfile
  if (session.authLoading) return <Loading label={copy.v2.loading} />
  if (session.authStatus === 'error') return <Notice error>{session.authError?.message ?? text.authFailed}<button className="v2-text-button" onClick={session.retryAuth}>{text.retry}</button></Notice>
  if (!session.user || !profile?.skland_binding || profile.status !== 'active' || profile.archived_at) return <EmptyState title={session.user ? text.noBinding : text.login} action={<Link className="v2-button v2-button-primary" to={v2Path('profiles', profile?.id)}>{text.profiles}</Link>} />
  return <ProjectWorkspace key={`${session.user.id}:${profile.id}`} session={session} profile={profile} onConfig={onConfig} />
}

function ProjectWorkspace({ session, profile, onConfig }: { session: V2Session; profile: UserGameAccount; onConfig: () => void }) {
  const m = useCultivationProjects(session, profile)
  const [editing, setEditing] = useState<CultivationProject | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [view, setView] = useState('targets')
  const workbench = useRef<HTMLDivElement>(null)
  const changeView = (next: string) => { setView(next); workbench.current?.scrollIntoView({ block: 'start' }) }
  const route = !m.pendingRefresh ? m.plans?.route : null
  const [applied, setApplied] = useState(false)
  const canConfigure = Boolean(session.license && canEditConfig(session.license))
  const baseConfig = m.production?.normal?.config ?? session.configOverride ?? session.license?.config
  const proposedConfig = route && baseConfig && (route.missing.exp || route.missing['4001']) ? prepareProjectProduction(baseConfig, route.focus) : null
  const change = (id: string, update: (row: CultivationProject) => CultivationProject) => m.setProjects((rows) => rows.map((row) => row.operatorId === id ? update(row) : row))
  const select = (label: string, value: string, onChange: (id: string) => void, empty: string) => <label className="v2-field"><span>{label}</span><select className="v2-input" value={value} onChange={(event) => { onChange(event.target.value); setApplied(false) }}><option value="">{empty}</option>{m.history.map((item) => <HistoryOption key={item.id} item={item} />)}</select></label>
  const applyConfig = (temporary: boolean) => {
    const config = (temporary ? m.production?.temporary : m.production?.normal)?.config
    if (!config || !session.license || !canEditConfig(session.license)) return
    session.setConfigOverride(structuredClone(config))
    setApplied(true)
  }
  return <div className="v2-projects">
    <div className="v2-tool-source v2-project-source"><div><span className="v2-label">{text.account} · {profile.display_name}</span></div><button className="v2-button v2-button-secondary" disabled={m.busy} aria-busy={m.busy} onClick={() => void m.load()}>{copy.skland.refresh}<RefreshIcon size={16} aria-hidden="true" /></button>
      <div className="v2-data-feedback"><DataRefresh pending={m.busy} revision={m.data} error={Boolean(m.error)}
        label={m.phase === 'syncing' ? copy.v2.dataActivity.syncing : copy.v2.dataActivity.calculating} /></div>
    </div>
    <Notice error>{m.error}</Notice><Notice>{m.storageError ? text.storageFailed : null}</Notice>
    {m.busy && !m.data && !m.projects.length && <DataSkeleton layout="projects" />}
    {m.data?.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
    {(m.data || m.projects.length > 0) && <>
      <Tabs.Root ref={workbench} value={view} onValueChange={changeView} className="v2-project-workbench">
        <div className="v2-project-toolbar">
          <Tabs.List className="v2-project-tabs" aria-label={text.workspace}>
            <Tabs.Trigger value="targets" onClick={() => { if (view === 'targets') changeView('targets') }}>{text.targetList}<span aria-hidden="true">{m.projects.length}</span></Tabs.Trigger>
            <Tabs.Trigger value="plan" onClick={() => { if (view === 'plan') changeView('plan') }}>{text.route}</Tabs.Trigger>
          </Tabs.List>
          <button type="button" className="v2-button v2-button-primary" disabled={!m.data || m.busy || m.projects.length >= 30} onClick={() => { setEditing(null); setEditorOpen(true) }}><Plus size={16} aria-hidden="true" />{text.add}</button>
        </div>
        {m.projects.length >= 30 && <p className="v2-muted">{text.targetLimit}</p>}
        <Tabs.Content value="targets" forceMount hidden={view !== 'targets'} className="v2-project-view v2-project-targets">
          <div className="v2-project-list-heading"><SectionTitle title={text.targets} description={text.orderHint} />
            <span className="v2-muted">{text.targetCount(m.projects.filter(project => !project.paused).length, m.projects.filter(project => project.paused).length)}</span>
          </div>
          <ol className="v2-project-list">{m.projects.map((project, index) => {
            const operator = m.data?.projectOperators?.find((row) => row.id === project.operatorId)
            const name = operator?.name ?? session.license?.operators?.find((row) => row.id === project.operatorId)?.name ?? project.operatorId
            const row = route?.rows.find((row) => row.project.operatorId === project.operatorId)
            const materials = m.materials.find((row) => row.project.operatorId === project.operatorId)
            const first = m.projects.find((row) => !row.paused)?.operatorId === project.operatorId
            return <ProjectGoal key={project.operatorId} project={project} operator={operator} name={name} index={index} primary={first && !project.paused}
              data={m.data} materials={materials} row={row} pauseGain={m.plans?.pauseGains[project.operatorId]} busy={m.busy}
              onEdit={() => { setEditing(project); setEditorOpen(true) }}
              onPause={() => change(project.operatorId, row => ({ ...row, paused: !row.paused }))}
              onPrioritize={() => m.setProjects(rows => [project, ...rows.filter(row => row.operatorId !== project.operatorId)])}
              onRemove={() => m.setProjects(rows => rows.filter(row => row.operatorId !== project.operatorId))} />
          })}</ol>
          {!m.projects.length && <div className="v2-project-empty"><CultivationIcon size={32} aria-hidden="true" /><h3>{text.empty}</h3><p className="v2-muted">{text.emptyHint}</p></div>}
          <Link className="v2-text-button" to={v2Path('cultivation', profile.id)}>{text.suggestionsEntry}<ArrowRight size={14} /></Link>
          <ProjectMaaExport projects={m.projects} operators={m.data?.projectOperators ?? []} />
          <p className="v2-data-date">{text.stored}</p>
        </Tabs.Content>
        <Tabs.Content value="plan" forceMount hidden={view !== 'plan'} className="v2-project-view">
        <details className="v2-project-plan-settings" open={!route || !m.validSettings || m.productionInvalid}>
          <summary><span>{text.planSettings}</span><small>{text.planSettingsSummary(m.dailySanity, m.startDate)}</small></summary>
          <div className="v2-project-settings">
          <section className="v2-project-conditions"><SectionTitle title={text.conditions} />
          <Field label={text.dailySanity} type="number" min={0} max={2000} step={1} value={m.dailySanity} onChange={(event) => m.setDailySanity(event.target.value)} help={text.dailyHint} />
          <Field label={text.start} type="date" value={m.startDate} onChange={(event) => m.setStartDate(event.target.value)} />
          <label className="v2-check"><input type="checkbox" checked={m.allOpen} onChange={(event) => m.setAllOpen(event.target.checked)} />{text.allOpen}</label><p className="v2-muted">{text.allOpenHint}</p>
          {!m.validSettings && <Notice error>{text.invalidSettings}</Notice>}
          </section>
          <section className="v2-project-production"><SectionTitle title={text.production} description={text.incomeHint} />
          {select(text.normal, m.normalId, m.setNormalId, text.noResult)}
          {select(text.temporary, m.temporaryId, m.setTemporaryId, text.noTemporary)}
          {!m.production ? <DataActivity label={text.incomeLoading} /> : m.production.error ? <Notice error>{m.production.error}<button className="v2-text-button" onClick={m.retryProduction}>{text.retry}</button></Notice> : m.productionInvalid ? <Notice>{text.incomeUnavailable}</Notice> : !m.normalIncome && <Notice>{text.noIncome}</Notice>}
          {m.normalIncome && <Facts items={[[text.dailyLmd, <TweenValue key="daily-lmd" value={m.normalIncome.lmd} format={number} />], [text.dailyExp, <TweenValue key="daily-exp" value={m.normalIncome.exp} format={number} />]]} />}
          {m.temporaryIncome && <Facts items={[[text.temporaryLmd, <TweenValue key="temporary-lmd" value={m.temporaryIncome.lmd} format={number} />], [text.temporaryExp, <TweenValue key="temporary-exp" value={m.temporaryIncome.exp} format={number} />]]} />}
          {(m.normalIncome?.lmd && m.normalIncome.goldNet === null || m.temporaryIncome?.lmd && m.temporaryIncome.goldNet === null) ? <Notice>{text.goldUnknown}</Notice> : null}
          <div className="v2-actions"><Link className="v2-text-button" to={v2Path('generation', profile.id)}>{text.generate}<ArrowRight size={14} /></Link><button className="v2-text-button" onClick={onConfig}>{text.configure}</button></div>
          </section>
          <div className="v2-project-advice">
          {route && <><SectionTitle title={text.balance} /><p className="v2-project-focus">{!(route.missing.exp || route.missing['4001']) ? text.balanced : route.focus === 'exp' ? text.needExp : text.needLmd}</p><p className="v2-muted">{!(route.missing.exp || route.missing['4001']) ? text.readyAdvice : route.focus === 'exp' ? text.expAdvice : text.lmdAdvice}</p></>}
          {m.temporaryId && m.plans && <Notice>{m.plans.useTemporary ? m.plans.gain === null ? text.temporaryReady(m.plans.alternative!.rows[0].estimatedDate!) : text.temporaryBetter(m.plans.gain) : m.plans.gain === null ? text.compareUnknown : text.keepNormal}{m.plans.useTemporary && route?.switchDate && <p>{text.switchBack(route.switchDate)}</p>}</Notice>}
          {m.production?.temporary?.config && m.plans?.useTemporary && <><div className="v2-actions"><button className="v2-button v2-button-secondary" disabled={!session.license || !canEditConfig(session.license)} onClick={() => applyConfig(true)}>{text.apply}</button>{m.production.normal?.config && <button className="v2-text-button" disabled={!session.license || !canEditConfig(session.license)} onClick={() => applyConfig(false)}>{text.applyNormal}</button>}</div><p className="v2-muted">{text.applyHint}</p>{session.license && !canEditConfig(session.license) && <p className="v2-muted">{text.configUnavailable}</p>}</>}
          {proposedConfig && canConfigure && <><button className="v2-button v2-button-secondary" onClick={() => { session.setConfigOverride(proposedConfig); onConfig() }}>{route?.focus === 'exp' ? text.prepareExp : text.prepareLmd}</button><p className="v2-muted">{text.prepareHint}</p></>}
          {applied && <Notice error={session.configSyncStatus === 'failed'}>{session.configSyncStatus === 'failed' ? copy.common.pages_tool_useToolSession_002 : text.applied}</Notice>}
          </div>
          </div>
        </details>
        {m.pendingRefresh && !m.busy && <Notice>{text.pendingRefresh}</Notice>}
        {m.materials.some((row) => row.candidate) && !m.plans && <Notice>{text.materialPlanPending}</Notice>}
        {!m.projects.some(project => !project.paused) && <EmptyState title={text.planEmpty} action={<button type="button" className="v2-text-button" onClick={() => changeView('targets')}>{text.targetList}<ArrowRight size={14} /></button>} />}
        {m.data && route && route.rows.length > 0 && <ProjectResults key={`${m.normalId}:${m.temporaryId}`} route={route} data={m.data} useTemporary={Boolean(m.plans?.useTemporary)} />}
        </Tabs.Content>
      </Tabs.Root>
      {m.data && <p className="v2-data-date">{text.dataTime} {new Date(m.data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="v2-dialog v2-project-editor" showCloseButton closeLabel={copy.v2.close}>
          <DialogTitle>{editing ? text.edit : text.add}</DialogTitle><DialogDescription>{text.editorHint}</DialogDescription>
          {m.data && <GoalForm key={editing ? JSON.stringify(editing) : 'new'} operators={m.data.projectOperators ?? []} projects={m.projects} editing={editing} busy={m.busy} onCancel={() => setEditorOpen(false)} onSave={goal => {
            m.setProjects(editing ? m.projects.map(row => row.operatorId === editing.operatorId ? goal : row) : [...m.projects, goal]); setEditorOpen(false)
          }} />}
        </DialogContent>
      </Dialog>
    </>}
  </div>
}

function HistoryOption({ item }: { item: WorkspaceResultHistorySummary }) {
  return <option value={item.id}>{item.name} · {new Date(item.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</option>
}

function GoalForm({ operators, projects, editing, busy, onSave, onCancel }: { operators: ProjectOperator[]; projects: CultivationProject[]; editing: CultivationProject | null; busy: boolean; onSave: (goal: CultivationProject) => void; onCancel: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [goal, setGoal] = useState<CultivationProject>(editing ?? { operatorId: '', elite: 2, level: 60, skill: 1, skillLevel: 7, paused: false, deadline: '' })
  const [error, setError] = useState(false)
  const operator = operators.find((row) => row.id === goal.operatorId)
  const choices = useMemo(() => {
    const used = new Set(projects.map((project) => {
      const row = operators.find((operator) => operator.id === project.operatorId)
      return row?.baseId ?? project.operatorId
    }))
    const groups = new Map<string, ProjectOperator>()
    for (const row of operators) {
      const id = row.baseId ?? row.id
      if (!used.has(id) && (!groups.has(id) || row.id === id)) groups.set(id, row)
    }
    return [...groups.values()]
  }, [operators, projects])
  const forms = operator ? operators.filter((row) => (row.baseId ?? row.id) === (operator.baseId ?? operator.id)) : []
  function choose(id: string) {
    const row = operators.find((row) => row.id === id)
    if (!row) return
    const elite = row.maxLevels.length - 1
    setGoal({ ...goal, operatorId: id, elite, level: Math.max(row.current.elite === elite ? row.current.level : 1, Math.min(60, row.maxLevels[elite])), skill: 1, skillLevel: row.skills.length ? 7 : 1 })
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!operator || !isCultivationProject(goal) || goal.level > (operator.maxLevels[goal.elite] ?? 0) || !editing && (projects.length >= 30 || projects.some((row) => forms.some((form) => form.id === row.operatorId)))) { setError(true); return }
    setError(false)
    onSave(goal)
    if (!editing) setGoal({ ...goal, operatorId: '' })
  }
  const select = (label: string, value: number, onChange: (value: number) => void, children: ReactNode) => <label className="v2-field"><span>{label}</span><select className="v2-input" value={value} onChange={(event) => onChange(Number(event.target.value))}>{children}</select></label>
  return <form className="v2-project-form" onSubmit={submit}>
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <button type="button" className="v2-project-choose" aria-label={text.operator} onClick={() => setPickerOpen(true)} disabled={Boolean(editing) || busy || projects.length >= 30}>
        {operator ? <><Avatar key={operator.baseId ?? operator.id} operator={{ id: operator.baseId ?? operator.id, name: operator.name }} /><span><strong>{operator.name}</strong><small>★{operator.rarity} · {profession(operator)}</small></span>{!editing && <span className="v2-project-choose-action">{text.changeOperator}</span>}</> : <><Plus size={24} aria-hidden="true" /><span><strong>{text.operator}</strong><small>{text.pickerHint}</small></span><ArrowRight size={18} aria-hidden="true" /></>}
      </button>
      <DialogContent className="v2-dialog v2-project-picker" showCloseButton closeLabel={copy.v2.close}>
        <div><DialogTitle>{text.operator}</DialogTitle><DialogDescription>{text.pickerHint}</DialogDescription></div>
        <OperatorPicker reveal operators={choices} selectedId={operator?.baseId ?? operator?.id} searchLabel={text.search}
          onChoose={(row) => { choose(row.id); setPickerOpen(false) }}
          details={(row) => <><strong>★{row.rarity} · {profession(row)}</strong><p>{text.elites[row.current.elite]} · Lv.{row.current.level}</p></>} />
      </DialogContent>
    </Dialog>
    {operator && forms.length > 1 && <fieldset className="v2-project-forms"><legend>{text.form}</legend>{forms.map((row) => <label key={row.id}><input type="radio" name="operator-form" value={row.id} checked={goal.operatorId === row.id} disabled={Boolean(editing)} onChange={() => choose(row.id)} /><span>{profession(row)}</span></label>)}</fieldset>}
    {operator && <div className="v2-project-form-fields">
      {select(text.elite, goal.elite, (elite) => setGoal({ ...goal, elite, level: Math.min(goal.level, operator.maxLevels[elite]), skill: Math.min(goal.skill, elite + 1), skillLevel: Math.min(goal.skillLevel, elite === 2 ? 10 : elite === 1 ? 7 : 4) }), operator.maxLevels.map((_max, index) => <option key={index} value={index}>{text.elites[index]}</option>))}
      <Field label={text.level} type="number" min={1} max={operator.maxLevels[goal.elite]} value={goal.level} onChange={(event) => setGoal({ ...goal, level: Number(event.target.value) })} />
      {operator.skills.length > 0 && <>{select(text.skill, goal.skill, (skill) => setGoal({ ...goal, skill, elite: Math.max(goal.elite, skill - 1) }), operator.skills.map((_skill, index) => <option key={index} value={index + 1}>{text.skillName(index + 1)}</option>))}
      {select(text.skillLevel, goal.skillLevel, (skillLevel) => setGoal({ ...goal, skillLevel, elite: Math.max(goal.elite, skillLevel > 7 ? 2 : skillLevel > 4 ? 1 : 0) }), Array.from({ length: operator.maxLevels.length > 2 ? 10 : operator.maxLevels.length > 1 ? 7 : 4 }, (_, index) => <option key={index} value={index + 1}>{text.skillRank(index + 1)}</option>))}</>}
    </div>}
    {operator && <Field label={text.deadline} type="date" value={goal.deadline} onChange={(event) => setGoal({ ...goal, deadline: event.target.value })} />}
    <Notice error>{error ? text.invalidTarget : null}</Notice>
    <div className="v2-actions"><button type="submit" className="v2-button v2-button-primary" disabled={busy || !operator || !editing && projects.length >= 30}>{editing ? <SaveIcon size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{editing ? text.save : text.add}</button><button type="button" className="v2-text-button" onClick={onCancel}>{text.cancel}</button></div>
    {projects.length >= 30 && !editing && <p className="v2-muted">{text.targetLimit}</p>}
  </form>
}

function ProjectResults({ route, data, useTemporary }: { route: ProjectRoute; data: CultivationData; useTemporary: boolean }) {
  const [visible, setVisible] = useState(7)
  const [section, setSection] = useState('resources')
  const material = (id: string) => data.itemNames[id] ?? id
  const { ready, waiting } = route.synthesis
  return <section className="v2-project-results v2-data-arrival">
    <header className="v2-project-result-summary" data-ready={Boolean(route.readyDate)}><div><SectionTitle title={text.route} /><p className="v2-muted">{text.dateHint}</p></div><ResourceCalendarIcon size={28} aria-hidden="true" /></header>
    <Facts items={[[text.readyDate, <AnimatedValue key="ready-date" value={route.readyDate ?? text.pending} />], [text.totalSanity, <TweenValue key="total-sanity" value={route.phases.reduce((sum, day) => sum + day.spent, 0)} format={number} />], [text.farmingDays, <AnimatedValue key="farming-days" value={String(route.phases.length)} />]]} />
    {(route.blocked.length > 0 || route.remaining.length > 0 || route.goldLimited) && <div className="v2-project-blockers"><h3>{text.bottlenecks}</h3>
      {route.blocked.length > 0 && <Notice>{text.noSource}{[...new Set(route.blocked.map((row) => material(row.item)))].join('、')}</Notice>}
      {route.goldLimited && <Notice>{text.goldLimited}</Notice>}
      {route.remaining.length > 0 && <Notice>{text.horizon}</Notice>}
    </div>}
    <Tabs.Root value={section} onValueChange={setSection}>
    <Tabs.List className="v2-project-tabs v2-project-plan-tabs" aria-label={text.planViews}>
      <Tabs.Trigger value="resources">{text.materialsView}</Tabs.Trigger>
      <Tabs.Trigger value="synthesis">{text.synthesis}</Tabs.Trigger>
      <Tabs.Trigger value="calendar">{text.calendarView}</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="resources" forceMount hidden={section !== 'resources'} className="v2-project-result-tab">
    <section className="v2-project-result-section"><h3>{text.resources}</h3><p className="v2-muted">{text.resourceHint}</p>
    {Object.keys(route.missing).length ? <MaterialBrowser data={data}>{(select) => <ul className="v2-project-resource-grid">{Object.entries(route.missing).map(([id, count]) => {
      const income = id === '4001' || id === 'exp'
      const sources = [[text.fromBase, route.supplied[id] ?? 0, 'base'], [text.fromFarm, route.farmed[id] ?? 0, 'farm'], [text.remaining, route.remaining.filter((row) => row.item === id).reduce((sum, row) => sum + row.remaining, 0), 'remaining']] as const
      const farms = new Map<string, number>()
      for (const day of route.phases) for (const farm of day.farms) if (farm.item === id) farms.set(farm.stage, (farms.get(farm.stage) ?? 0) + farm.runs)
      return <li key={id} data-income={income}><MaterialButton id={id} count={count} data={data} onSelect={select} className="v2-project-resource-button">{text.shortage} · {number(count)}</MaterialButton>
        {income ? <><div className="v2-project-resource-track" role="img" aria-label={sources.map(([label, amount]) => `${label} ${number(amount)}`).join('，')}>{sources.map(([_label, amount, source]) => <span key={source} data-source={source} style={{ width: `${Math.min(100, amount / count * 100)}%` }} />)}</div>
        <dl>{sources.map(([label, amount, source]) => <div key={source} data-source={source}><dt>{label}</dt><dd>{number(amount)}</dd></div>)}</dl></> : <p className="v2-project-resource-source">{farms.size ? [...farms].map(([stage, runs]) => <span key={stage}>{stage}<b>{text.stageRuns(runs)}</b></span>) : data.farms[id]?.length ? text.noFarmingPlan : text.noFarm}</p>}
      </li>
    })}</ul>}</MaterialBrowser> : <p className="v2-muted">{text.noShortage}</p>}</section>
    </Tabs.Content>
    <Tabs.Content value="synthesis" forceMount hidden={section !== 'synthesis'} className="v2-project-result-tab">
    <section className="v2-project-result-section" aria-labelledby="project-synthesis-title"><h3 id="project-synthesis-title">{text.synthesis}</h3>
      {ready.length || waiting.length ? <><p className="v2-muted">{text.synthesisHint}</p>
        <MaterialBrowser data={data}>{(select) => <>{([[text.synthesisReady, ready], [text.synthesisWaiting, waiting]] as const).map(([label, steps]) => steps.length > 0 && <div className="v2-project-synthesis" key={label}>
          <h4>{label}</h4><ol className="v2-project-synthesis-list" aria-label={label}>{steps.map((step, index) => <li key={`${step.item}:${index}`}>
            <MaterialButton id={step.item} count={step.count} data={data} onSelect={select}>{text.recipeOutput(number(step.count))}</MaterialButton>
          </li>)}</ol>
        </div>)}</>}</MaterialBrowser>
      </> : <p className="v2-muted">{text.noSynthesis}</p>}
    </section>
    </Tabs.Content>
    <Tabs.Content value="calendar" forceMount hidden={section !== 'calendar'} className="v2-project-result-tab">
    {route.phases.length > 0 ? <section className="v2-project-result-section"><h3>{text.calendar}</h3><ol className="v2-project-calendar">{route.phases.slice(0, visible).map((day, index) => <li key={day.date}>
      <div className="v2-project-day"><b>{String(index + 1).padStart(2, '0')}</b><div><time dateTime={day.date}>{day.date}</time><small>{text.daySanity(day.spent)}</small>{useTemporary && <small>{day.temporary ? text.temporaryDay : text.normalDay}</small>}</div></div>
      <div className="v2-project-day-plan"><p className="v2-project-day-income"><DailyOutputIcon size={16} aria-hidden="true" />{text.baseDay(number(day.income['4001']), number(day.income.exp))}</p>{day.farms.length ? <MaterialBrowser data={data}>{(select) => <ul className="v2-project-day-farms">{day.farms.map((farm) => <li key={`${farm.item}:${farm.stage}`}><MaterialButton id={farm.item} count={farm.quantity} data={data} onSelect={select}><b>{farm.stage}</b><small>{text.farmRuns(farm.runs, number(farm.quantity))}</small></MaterialButton></li>)}</ul>}</MaterialBrowser> : <p className="v2-muted">{text.noFarms}</p>}</div>
    </li>)}</ol>{visible < route.phases.length && <button className="v2-button v2-button-secondary" onClick={() => setVisible((value) => value + 14)}>{text.moreDays}</button>}</section> : <p className="v2-muted v2-project-result-section">{text.noCalendar}</p>}
    </Tabs.Content>
    </Tabs.Root>
  </section>
}
