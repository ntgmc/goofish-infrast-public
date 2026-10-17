import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Pause, Play, Plus, X } from 'lucide-react'
import { copy } from '../../../copy'
import { canEditConfig } from '../../../lib/license'
import { isCultivationProject, prepareProjectProduction, projectDaysEarlier, type CultivationProject, type ProjectOperator, type ProjectRoute } from '../../../lib/cultivation-projects'
import type { CultivationData } from '../../../lib/cultivation-contract'
import type { UserGameAccount, WorkspaceResultHistorySummary } from '../../../lib/types'
import { useCultivationProjects } from '../../cultivation/useCultivationProjects'
import Link from '../../../components/InternalLink'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import { EmptyState, Facts, Field, Notice, SectionTitle } from '../components/WorkspaceUI'
import './cultivation-projects.css'

const text = copy.cultivationProjects
const number = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 1 })

export default function CultivationProjects({ session, onConfig }: { session: V2Session; onConfig: () => void }) {
  const profile = session.activeProfile
  if (session.authLoading) return <Notice>{copy.v2.loading}</Notice>
  if (session.authStatus === 'error') return <Notice error>{session.authError?.message ?? text.authFailed}<button className="v2-text-button" onClick={session.retryAuth}>{text.retry}</button></Notice>
  if (!session.user || !profile?.skland_binding || profile.status !== 'active' || profile.archived_at) return <EmptyState title={session.user ? text.noBinding : text.login} action={<Link className="v2-button v2-button-primary" to={v2Path('profiles', profile?.id)}>{text.profiles}</Link>} />
  return <ProjectWorkspace key={`${session.user.id}:${profile.id}`} session={session} profile={profile} onConfig={onConfig} />
}

function ProjectWorkspace({ session, profile, onConfig }: { session: V2Session; profile: UserGameAccount; onConfig: () => void }) {
  const m = useCultivationProjects(session, profile)
  const [editing, setEditing] = useState<CultivationProject | null>(null)
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
    <div className="v2-tool-source"><div><span className="v2-label">{text.account} · {profile.display_name}</span><p>{text.description}</p><Link className="v2-text-button" to={v2Path('cultivation', profile.id)}>{text.suggestionsEntry}<ArrowRight size={14} /></Link></div><button className="v2-button v2-button-primary" disabled={m.busy} onClick={() => void m.load()}>{m.busy ? text.loading : m.data ? text.refresh : text.import}<ArrowRight size={16} /></button></div>
    <Notice error>{m.error}</Notice><Notice>{m.storageError ? text.storageFailed : null}</Notice>
    {m.data?.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
    {(m.data || m.projects.length > 0) && <>
      <div className="v2-project-columns">
        <section className="v2-project-targets"><SectionTitle title={text.targets} description={text.orderHint} />
          <ol className="v2-project-list">{m.projects.map((project) => {
            const operator = m.data?.projectOperators?.find((row) => row.id === project.operatorId)
            const name = operator?.name ?? session.license?.operators?.find((row) => row.id === project.operatorId)?.name ?? project.operatorId
            const row = route?.rows.find((row) => row.project.operatorId === project.operatorId)
            const first = m.projects.find((row) => !row.paused)?.operatorId === project.operatorId
            const deadlineDays = row?.estimatedDate && project.deadline ? projectDaysEarlier(project.deadline, row.estimatedDate) : null
            return <li key={project.operatorId} data-paused={project.paused}>
              <img src={`/webp96/${encodeURIComponent(project.operatorId)}.webp`} alt="" width={48} height={48} />
              <div className="v2-project-target-body"><h3>{name}<small>{project.paused ? text.paused : first ? text.main : ''}</small></h3>
                <p>{text.targetDescription(text.elites[project.elite], project.level, project.skill, text.skillRank(project.skillLevel))}</p>
                {operator && <small>{text.currentDescription(operator.current.elite, operator.current.level)}</small>}
                {!project.paused && <p className="v2-project-ready">{text.goalReadyDate} · {m.pendingRefresh ? text.pendingRefresh : row?.estimatedDate ?? text.pending}</p>}
                {!project.paused && project.deadline && <small>{project.deadline} · {deadlineDays === null ? text.deadlineUnknown : deadlineDays < 0 ? text.overdue(-deadlineDays) : text.onTime}</small>}
                {!project.paused && !first && route && <small>{m.plans?.pauseGains[project.operatorId] == null ? text.pauseUnknown : text.pausePreview(m.plans.pauseGains[project.operatorId]!)}</small>}
                {row?.candidate?.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
                <div className="v2-actions"><button className="v2-text-button" disabled={m.busy} onClick={() => setEditing(project)}>{text.edit}</button>
                  <button className="v2-text-button" onClick={() => change(project.operatorId, (row) => ({ ...row, paused: !row.paused }))}>{project.paused ? <Play size={14} /> : <Pause size={14} />}{project.paused ? text.resume : text.pause}</button>
                  {!first && !project.paused && <button className="v2-text-button" onClick={() => m.setProjects((rows) => [project, ...rows.filter((row) => row.operatorId !== project.operatorId)])}>{text.makeMain}</button>}
                </div>
              </div>
              <button className="v2-icon-button" aria-label={`${text.remove} ${name}`} onClick={() => { m.setProjects((rows) => rows.filter((row) => row.operatorId !== project.operatorId)); if (editing?.operatorId === project.operatorId) setEditing(null) }}><X size={18} /></button>
            </li>
          })}</ol>
          {!m.projects.length && <p className="v2-muted">{text.emptyHint}</p>}
          {m.data && <GoalForm key={editing ? JSON.stringify(editing) : 'new'} operators={m.data.projectOperators ?? []} projects={m.projects} editing={editing} busy={m.busy} onCancel={() => setEditing(null)} onSave={(goal) => {
            const next = editing ? m.projects.map((row) => row.operatorId === editing.operatorId ? goal : row) : [...m.projects, goal]
            m.setProjects(next); setEditing(null); void m.load(next)
          }} />}
          <p className="v2-data-date">{text.stored}</p>
        </section>
        <section className="v2-project-conditions"><SectionTitle title={text.conditions} />
          <Field label={text.dailySanity} type="number" min={0} max={2000} step={1} value={m.dailySanity} onChange={(event) => m.setDailySanity(event.target.value)} help={text.dailyHint} />
          <Field label={text.start} type="date" value={m.startDate} onChange={(event) => m.setStartDate(event.target.value)} />
          <label className="v2-check"><input type="checkbox" checked={m.allOpen} onChange={(event) => m.setAllOpen(event.target.checked)} />{text.allOpen}</label><p className="v2-muted">{text.allOpenHint}</p>
          {!m.validSettings && <Notice error>{text.invalidSettings}</Notice>}
          <SectionTitle title={text.production} description={text.incomeHint} />
          {select(text.normal, m.normalId, m.setNormalId, text.noResult)}
          {select(text.temporary, m.temporaryId, m.setTemporaryId, text.noTemporary)}
          {!m.production ? <Notice>{text.incomeLoading}</Notice> : m.production.error ? <Notice error>{m.production.error}<button className="v2-text-button" onClick={m.retryProduction}>{text.retry}</button></Notice> : m.productionInvalid ? <Notice>{text.incomeUnavailable}</Notice> : !m.normalIncome && <Notice>{text.noIncome}</Notice>}
          {m.normalIncome && <Facts items={[[text.dailyLmd, number(m.normalIncome.lmd)], [text.dailyExp, number(m.normalIncome.exp)]]} />}
          {m.temporaryIncome && <Facts items={[[text.temporaryLmd, number(m.temporaryIncome.lmd)], [text.temporaryExp, number(m.temporaryIncome.exp)]]} />}
          {(m.normalIncome?.lmd && m.normalIncome.goldNet === null || m.temporaryIncome?.lmd && m.temporaryIncome.goldNet === null) ? <Notice>{text.goldUnknown}</Notice> : null}
          <div className="v2-actions"><Link className="v2-text-button" to={v2Path('generation', profile.id)}>{text.generate}<ArrowRight size={14} /></Link><button className="v2-text-button" onClick={onConfig}>{text.configure}</button></div>
          {route && <><SectionTitle title={text.balance} /><p className="v2-project-focus">{!(route.missing.exp || route.missing['4001']) ? text.balanced : route.focus === 'exp' ? text.needExp : text.needLmd}</p><p className="v2-muted">{!(route.missing.exp || route.missing['4001']) ? text.readyAdvice : route.focus === 'exp' ? text.expAdvice : text.lmdAdvice}</p></>}
          {m.temporaryId && m.plans && <Notice>{m.plans.useTemporary ? m.plans.gain === null ? text.temporaryReady(m.plans.alternative!.rows[0].estimatedDate!) : text.temporaryBetter(m.plans.gain) : m.plans.gain === null ? text.compareUnknown : text.keepNormal}{m.plans.useTemporary && route?.switchDate && <p>{text.switchBack(route.switchDate)}</p>}</Notice>}
          {m.production?.temporary?.config && m.plans?.useTemporary && <><div className="v2-actions"><button className="v2-button v2-button-secondary" disabled={!session.license || !canEditConfig(session.license)} onClick={() => applyConfig(true)}>{text.apply}</button>{m.production.normal?.config && <button className="v2-text-button" disabled={!session.license || !canEditConfig(session.license)} onClick={() => applyConfig(false)}>{text.applyNormal}</button>}</div><p className="v2-muted">{text.applyHint}</p>{session.license && !canEditConfig(session.license) && <p className="v2-muted">{text.configUnavailable}</p>}</>}
          {proposedConfig && canConfigure && <><button className="v2-button v2-button-secondary" onClick={() => { session.setConfigOverride(proposedConfig); onConfig() }}>{route?.focus === 'exp' ? text.prepareExp : text.prepareLmd}</button><p className="v2-muted">{text.prepareHint}</p></>}
          {applied && <Notice error={session.configSyncStatus === 'failed'}>{session.configSyncStatus === 'failed' ? copy.common.pages_tool_useToolSession_002 : text.applied}</Notice>}
        </section>
      </div>
      {m.pendingRefresh && <Notice>{text.pendingRefresh}</Notice>}
      {m.data && route && route.rows.length > 0 && <ProjectResults key={`${m.normalId}:${m.temporaryId}`} route={route} data={m.data} useTemporary={Boolean(m.plans?.useTemporary)} />}
      {m.data && <p className="v2-data-date">{text.dataTime} {new Date(m.data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
    </>}
  </div>
}

function HistoryOption({ item }: { item: WorkspaceResultHistorySummary }) {
  return <option value={item.id}>{item.name} · {new Date(item.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</option>
}

function GoalForm({ operators, projects, editing, busy, onSave, onCancel }: { operators: ProjectOperator[]; projects: CultivationProject[]; editing: CultivationProject | null; busy: boolean; onSave: (goal: CultivationProject) => void; onCancel: () => void }) {
  const [search, setSearch] = useState('')
  const [goal, setGoal] = useState<CultivationProject>(editing ?? { operatorId: '', elite: 2, level: 60, skill: 1, skillLevel: 7, paused: false, deadline: '' })
  const [error, setError] = useState(false)
  const operator = operators.find((row) => row.id === goal.operatorId)
  const choices = operators.filter((row) => row.name.includes(search.trim()) && (!projects.some((project) => project.operatorId === row.id) || editing?.operatorId === row.id))
  function choose(id: string) {
    const row = operators.find((row) => row.id === id)
    if (!row) return
    const elite = row.maxLevels.length - 1
    setGoal({ ...goal, operatorId: id, elite, level: Math.max(row.current.elite === elite ? row.current.level : 1, Math.min(60, row.maxLevels[elite])), skill: 1, skillLevel: row.skills.length ? 7 : 1 })
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!operator || !isCultivationProject(goal) || goal.level > (operator.maxLevels[goal.elite] ?? 0) || !editing && (projects.length >= 30 || projects.some((row) => row.operatorId === goal.operatorId))) { setError(true); return }
    setError(false)
    onSave(goal)
    if (!editing) setGoal({ ...goal, operatorId: '' })
  }
  const select = (label: string, value: number, onChange: (value: number) => void, children: ReactNode) => <label className="v2-field"><span>{label}</span><select className="v2-input" value={value} onChange={(event) => onChange(Number(event.target.value))}>{children}</select></label>
  return <form className="v2-project-form" onSubmit={submit}>
    <h3>{editing ? text.edit : text.add}</h3>
    {!editing && <Field label={text.search} value={search} onChange={(event) => setSearch(event.target.value)} />}
    <label className="v2-field"><span>{text.operator}</span><select className="v2-input" value={goal.operatorId} disabled={Boolean(editing)} onChange={(event) => choose(event.target.value)}><option value="">{text.choose}</option>{choices.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {operator && <div className="v2-project-form-fields">
      {select(text.elite, goal.elite, (elite) => setGoal({ ...goal, elite, level: Math.min(goal.level, operator.maxLevels[elite]), skill: Math.min(goal.skill, elite + 1), skillLevel: Math.min(goal.skillLevel, elite === 2 ? 10 : elite === 1 ? 7 : 4) }), operator.maxLevels.map((_max, index) => <option key={index} value={index}>{text.elites[index]}</option>))}
      <Field label={text.level} type="number" min={1} max={operator.maxLevels[goal.elite]} value={goal.level} onChange={(event) => setGoal({ ...goal, level: Number(event.target.value) })} />
      {operator.skills.length > 0 && <>{select(text.skill, goal.skill, (skill) => setGoal({ ...goal, skill, elite: Math.max(goal.elite, skill - 1) }), operator.skills.map((_skill, index) => <option key={index} value={index + 1}>{text.skillName(index + 1)}</option>))}
      {select(text.skillLevel, goal.skillLevel, (skillLevel) => setGoal({ ...goal, skillLevel, elite: Math.max(goal.elite, skillLevel > 7 ? 2 : skillLevel > 4 ? 1 : 0) }), Array.from({ length: operator.maxLevels.length > 2 ? 10 : operator.maxLevels.length > 1 ? 7 : 4 }, (_, index) => <option key={index} value={index + 1}>{text.skillRank(index + 1)}</option>))}</>}
    </div>}
    <Field label={text.deadline} type="date" value={goal.deadline} onChange={(event) => setGoal({ ...goal, deadline: event.target.value })} />
    <Notice error>{error ? text.invalidTarget : null}</Notice>
    <div className="v2-actions"><button type="submit" className="v2-button v2-button-primary" disabled={busy || !operator || !editing && projects.length >= 30}><Plus size={16} />{editing ? text.save : text.add}</button>{editing && <button type="button" className="v2-text-button" onClick={onCancel}>{text.cancel}</button>}</div>
    {projects.length >= 30 && !editing && <p className="v2-muted">{text.targetLimit}</p>}
  </form>
}

function ProjectResults({ route, data, useTemporary }: { route: ProjectRoute; data: CultivationData; useTemporary: boolean }) {
  const [visible, setVisible] = useState(7)
  const material = (id: string) => data.itemNames[id] ?? id
  return <section className="v2-project-results"><SectionTitle title={text.route} /><Facts items={[[text.readyDate, route.readyDate ?? text.pending]]} /><p className="v2-muted">{text.dateHint}</p>
    {(route.blocked.length > 0 || route.remaining.length > 0 || route.goldLimited) && <div className="v2-project-blockers"><h3>{text.bottlenecks}</h3>
      {route.blocked.length > 0 && <Notice>{text.noSource}{[...new Set(route.blocked.map((row) => material(row.item)))].join('、')}</Notice>}
      {route.goldLimited && <Notice>{text.goldLimited}</Notice>}
      {route.remaining.length > 0 && <Notice>{text.horizon}</Notice>}
    </div>}
    <h3>{text.resources}</h3>
    {Object.keys(route.missing).length ? <div className="v2-project-resource-scroll"><table><thead><tr>{[text.resource, text.shortage, text.fromBase, text.fromFarm, text.remaining].map((title) => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{Object.entries(route.missing).map(([id, count]) => <tr key={id}><th scope="row">{material(id)}</th><td>{number(count)}</td><td>{number(route.supplied[id] ?? 0)}</td><td>{number(route.farmed[id] ?? 0)}</td><td>{number(route.remaining.filter((row) => row.item === id).reduce((sum, row) => sum + row.remaining, 0))}</td></tr>)}</tbody></table></div> : <p className="v2-muted">{text.noShortage}</p>}
    {route.phases.length > 0 && <><h3>{text.calendar}</h3><ol className="v2-project-calendar">{route.phases.slice(0, visible).map((day) => <li key={day.date}><div><time dateTime={day.date}>{day.date}</time><small>{text.daySanity(day.spent)}</small>{useTemporary && <small>{day.temporary ? text.temporaryDay : text.normalDay}</small>}</div><div><p>{text.baseDay(number(day.income['4001']), number(day.income.exp))}</p>{day.farms.length ? day.farms.map((farm) => <p key={`${farm.item}:${farm.stage}`}><strong>{farm.stage}</strong> · {material(farm.item)}<small>{text.farmRuns(farm.runs, number(farm.quantity))}</small></p>) : <p className="v2-muted">{text.noFarms}</p>}</div></li>)}</ol>{visible < route.phases.length && <button className="v2-button v2-button-secondary" onClick={() => setVisible((value) => value + 14)}>{text.moreDays}</button>}</>}
  </section>
}
