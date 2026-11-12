import { NextIcon, PauseIcon, ResumeIcon, RemoveIcon, ResourceStockIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import type { CultivationData } from '../../../lib/cultivation-contract'
import { projectDaysEarlier, type allocateProjectMaterials, type CultivationProject, type ProjectOperator, type ProjectRoute } from '../../../lib/cultivation-projects'
import { AnimatedValue } from '../../../components/MotionPrimitives'
import { Avatar } from '../ScheduleBoard'
import { Notice } from '../components/WorkspaceUI'
import { MaterialNeeds } from './ProjectMaterials'

const text = copy.cultivationProjects

type Props = {
  project: CultivationProject
  operator?: ProjectOperator
  name: string
  index: number
  primary: boolean
  data: CultivationData | null
  materials?: ReturnType<typeof allocateProjectMaterials>[number]
  row?: ProjectRoute['rows'][number]
  pauseGain?: number | null
  busy: boolean
  onEdit: () => void
  onPause: () => void
  onPrioritize: () => void
  onRemove: () => void
}

export default function ProjectGoal({ project, operator, name, index, primary, data, materials, row, pauseGain, busy, onEdit, onPause, onPrioritize, onRemove }: Props) {
  const deadlineDays = row?.estimatedDate && project.deadline ? projectDaysEarlier(project.deadline, row.estimatedDate) : null
  const date = !materials?.candidate ? busy ? text.calculating : text.pendingRefresh : row?.estimatedDate ?? text.pending
  return <li data-paused={project.paused} data-primary={primary}>
    <div className="v2-project-goal-row">
      <div className="v2-project-target-heading">
        <span className="v2-project-portrait"><Avatar operator={{ id: operator?.baseId ?? project.operatorId, name }} /><b>{String(index + 1).padStart(2, '0')}</b></span>
        <div><h3>{name}</h3>{(project.paused || primary) && <span className="v2-project-status">{project.paused ? text.paused : text.main}</span>}</div>
      </div>
      <ProjectTraining project={project} operator={operator} />
      <div className="v2-project-ready"><span>{project.paused ? text.paused : text.goalReadyDate}</span>{!project.paused && <><strong><AnimatedValue value={date} /></strong>{deadlineDays !== null && deadlineDays < 0 && <small>{text.overdue(-deadlineDays)}</small>}</>}</div>
      <button type="button" className="v2-text-button" aria-label={`${text.edit} ${name}`} disabled={busy} onClick={onEdit}>{text.edit}</button>
    </div>
    <details className="v2-project-goal-details">
      <summary><ResourceStockIcon size={16} aria-hidden="true" />{text.goalDetails}<span>{project.paused ? text.paused : materials?.candidate?.warnings.length ? text.materialReview : materials?.allocation ? text.shortageKinds(Object.keys(materials.allocation.missing).length) : text.pendingRefresh}</span></summary>
      <div className="v2-project-goal-detail-body">
        {operator && <p className="v2-muted">★{operator.rarity} · {copy.tools.cultivation.professions[operator.profession as keyof typeof copy.tools.cultivation.professions] ?? ''}</p>}
        {project.deadline && <p className="v2-muted">{text.deadline} · {project.deadline} · {deadlineDays === null ? text.deadlineUnknown : deadlineDays < 0 ? text.overdue(-deadlineDays) : text.onTime}</p>}
        {!project.paused && materials?.candidate && data && <>
          <MaterialNeeds items={materials.candidate.items} data={data} />
          {materials.allocation && Object.keys(materials.allocation.missing).length > 0 && <MaterialNeeds items={materials.allocation.missing} data={data} shortage />}
        </>}
        {materials?.candidate?.warnings.map(warning => <Notice key={warning}>{warning}</Notice>)}
        {project.paused ? <p className="v2-muted">{text.pausedHint}</p> : !primary && row && <p className="v2-muted">{pauseGain == null ? text.pauseUnknown : text.pausePreview(pauseGain)}</p>}
        <div className="v2-actions">
          <button type="button" className="v2-text-button" onClick={onPause}>{project.paused ? <ResumeIcon size={14} /> : <PauseIcon size={14} />}{project.paused ? text.resume : text.pause}</button>
          {!primary && !project.paused && <button type="button" className="v2-text-button" onClick={onPrioritize}>{text.makeMain}</button>}
          <button type="button" className="v2-text-button v2-project-remove" aria-label={`${text.remove} ${name}`} onClick={onRemove}><RemoveIcon size={14} />{text.remove}</button>
        </div>
      </div>
    </details>
  </li>
}

function ProjectTraining({ project, operator }: { project: CultivationProject; operator?: ProjectOperator }) {
  const current = operator?.current
  const skillId = operator?.skills[project.skill - 1]
  const mastery = skillId ? current?.masteries[skillId] : undefined
  let rank = current?.skillLevel ?? null
  if (rank === 7 && project.skillLevel > 7) rank = mastery === undefined ? null : 7 + mastery
  const trainingNeeded = !current || current.elite < project.elite || current.elite === project.elite && current.level < project.level
  const skillNeeded = project.skillLevel > 1 && (rank === null || rank < project.skillLevel)
  const training = (elite: number, level: number) => `${text.elites[elite]} Lv.${level}`
  return <div className="v2-project-training">
    {(trainingNeeded || skillNeeded) ? <ul aria-label={text.upgrades}>
      {trainingNeeded && <li><span>{text.training}</span><div>{current && <><span>{training(current.elite, current.level)}</span><NextIcon size={14} aria-label={text.to} /></>}<strong>{training(project.elite, project.level)}</strong></div></li>}
      {skillNeeded && <li><span>{text.skillName(project.skill)}</span><div><span>{rank === null ? text.unknownTraining : text.skillRank(rank)}</span><NextIcon size={14} aria-label={text.to} /><strong>{text.skillRank(project.skillLevel)}</strong></div></li>}
    </ul> : <strong className="v2-project-goal-met">{text.trainingMet}</strong>}
    {current && !trainingNeeded && <p>{text.trainingMetDetail(training(current.elite, current.level))}</p>}
    {current && !skillNeeded && project.skillLevel > 1 && <p>{text.skillMet(text.skillName(project.skill), text.skillRank(project.skillLevel))}</p>}
  </div>
}
