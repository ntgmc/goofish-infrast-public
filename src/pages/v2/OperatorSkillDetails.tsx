import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Tabs } from '../../components/ui/tabs'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import { operatorBuildingSkills } from '../../components/result-panel/building-skills'
import { copy } from '../../copy'
import { buildingRatingCharacter, buildingRatingRoster, ratingMemberStatus, ratingVariantStatus, relatedBuildingCombos, singleBuildingRatings, type RatingCombo, type RatingRoster, type RatingStage, type SingleBuildingRating } from '../../lib/building-skill-ratings'
import type { LicenseConfig, LicenseOperator } from '../../lib/types'
import { BuildingSkillList } from './BuildingSkills'
import { RatingBadge, RatingVariantDetails } from './BuildingRatingDetails'
import BuildingRatingVariantPicker from './BuildingRatingVariantPicker'
import { Avatar } from './ScheduleBoard'
import { v2Path } from './navigation'
import './building-ratings.css'
import './operator-skill-details.css'

const text = copy.buildingRatings
const detail = copy.v2.operatorManagement
const unlock = copy.domain.building_skills.unlock

export default function OperatorSkillDetails({ operator, operators, config }: { operator: LicenseOperator; operators: LicenseOperator[]; config: LicenseConfig | null }) {
  const [params] = useSearchParams()
  const roster = useMemo(() => buildingRatingRoster(operators), [operators])
  const id = useMemo(() => buildingRatingRoster([operator]).keys().next().value, [operator])
  const singles = singleBuildingRatings.filter((entry) => entry.operatorId === id)
  const combos = id ? relatedBuildingCombos(id).map((combo) => ({ ...combo, variants: combo.variants.filter((variant) => variant.members.some((member) => member.id === id)) })) : []
  const skills = operatorBuildingSkills(operator)
  const [tab, setTab] = useState(singles.length ? 'ratings' : combos.length ? 'combos' : 'skills')
  return <div className="v2-operator-skill-details">
    <Tabs.Root value={tab} onValueChange={setTab}>
      <Tabs.List className="v2-rating-tabs" aria-label={detail.detailTitle}>
        <Tabs.Trigger value="ratings">{detail.ratingTab}</Tabs.Trigger>
        <Tabs.Trigger value="skills">{detail.skillTab}</Tabs.Trigger>
        <Tabs.Trigger value="combos">{text.combo}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="ratings" className="v2-operator-skill-content">
        {singles.length ? singles.map((entry) => <OperatorRating key={entry.id} entry={entry} operator={operator} roster={roster} />) : <div className="v2-operator-skill-empty"><p>{combos.length ? detail.noIndependentRating : detail.noRatings}</p>{combos.length > 0 && <button type="button" className="v2-text-button" onClick={() => setTab('combos')}>{detail.viewCombos}</button>}</div>}
      </Tabs.Content>
      <Tabs.Content value="skills" className="v2-operator-skill-content">
        {skills.length ? <BuildingSkillList skills={skills} owned={operator.own} /> : <p className="v2-muted">{copy.v2.skillsUnavailable}</p>}
      </Tabs.Content>
      <Tabs.Content value="combos" className="v2-operator-skill-content">
        {combos.length ? combos.map((combo) => <OperatorCombo key={combo.id} combo={combo} operatorId={id!} roster={roster} config={config} />) : <p className="v2-muted">{detail.noCombos}</p>}
      </Tabs.Content>
    </Tabs.Root>
    {id && <Link className="v2-text-button v2-operator-rating-link" to={`${v2Path('building-ratings', params.get('profile_id'))}&q=${encodeURIComponent(operator.name)}`}>{text.detailsLink}<span aria-hidden="true">↗</span></Link>}
  </div>
}

function OperatorRating({ entry, operator, roster }: { entry: SingleBuildingRating; operator: LicenseOperator; roster: RatingRoster }) {
  const state = (stage: RatingStage) => ratingMemberStatus({ id: entry.operatorId, room: entry.room, elite: stage.elite, level: stage.level, station: 'main' }, roster)
  const states = entry.stages.map((stage) => state(stage))
  const current = states.lastIndexOf('ready')
  if (current >= 0 && states.slice(current + 1).includes('unknown')) states[current] = 'unknown'
  const [selected, setSelected] = useState<number | null>(null)
  const index = selected ?? Math.max(0, current)
  const stage = entry.stages[index]
  const assessment = stage.assessment
  const status = states[index]
  const label = status === 'ready' ? index === current ? detail.currentRating : detail.replacedRating : text.memberStates[status]
  const skills = operatorBuildingSkills(operator).filter((skill) => stage.skills.includes(skill.id))
  return <section className="v2-operator-rating" aria-label={`${ROOM_LABELS[entry.room]} · ${assessment.usage}`}>
    <header><div><h3>{ROOM_LABELS[entry.room]}</h3><p>{assessment.usage}</p></div><RatingBadge score={assessment.score!} /></header>
    {entry.stages.length > 1 ? <label className="v2-field"><span>{detail.ratingStage(ROOM_LABELS[entry.room])}</span><select className="v2-input" value={index} onChange={(event) => setSelected(Number(event.target.value))}>
      {entry.stages.map((item, itemIndex) => <option key={itemIndex} value={itemIndex}>{unlock(item.elite, item.level)} · {states[itemIndex] === 'ready' ? itemIndex === current ? detail.currentRating : detail.replacedRating : text.memberStates[states[itemIndex]]}</option>)}
    </select></label> : <p className="v2-muted">{unlock(stage.elite, stage.level)}</p>}
    {(entry.stages.length === 1 || assessment.provisional) && <div className="v2-operator-rating-status">{entry.stages.length === 1 && <span className="v2-rating-state" data-state={status}>{label}</span>}{assessment.provisional && <span className="v2-rating-provisional">{text.provisional}</span>}</div>}
    <p>{assessment.reason}</p>
    {assessment.conditions && <p className="v2-operator-rating-condition"><strong>{text.conditions}：</strong>{assessment.conditions}</p>}
    {assessment.scenarios?.length ? <ul className="v2-rating-scenarios">{assessment.scenarios.map((scenario) => <li key={scenario.label}><span>{scenario.label}</span><RatingBadge score={scenario.score} /><p>{scenario.reason}</p></li>)}</ul> : null}
    <BuildingSkillList skills={skills} owned={operator.own} />
  </section>
}

function OperatorCombo({ combo, operatorId, roster, config }: { combo: RatingCombo; operatorId: string; roster: RatingRoster; config: LicenseConfig | null }) {
  const states = combo.variants.map((variant) => ratingVariantStatus(variant, roster, config))
  let initial = states.findIndex((state) => state.state === 'ready')
  if (initial < 0) initial = combo.variants.findIndex((variant) => ratingMemberStatus(variant.members.find((member) => member.id === operatorId)!, roster) === 'ready')
  const [index, setIndex] = useState(Math.max(0, initial))
  const variant = combo.variants[index]
  const members = variant.members
  return <details className="v2-operator-combo">
    <summary><span className="v2-operator-combo-heading"><strong>{combo.title}</strong><span>{ROOM_LABELS[combo.room]} · {combo.usage}</span><span className="v2-rating-state" data-state={states[index].state}>{states[index].membersOwned ? text.membersOwned : text.membersMissing} · {text.states[states[index].state]}</span><span className="v2-operator-combo-portraits">{members.slice(0, 4).map((member) => <Avatar key={member.id} operator={{ id: member.id, name: buildingRatingCharacter(member.id).name }} small />)}{members.length > 4 && <span>+{members.length - 4}</span>}</span></span><RatingBadge score={variant.score} /></summary>
    <div className="v2-operator-combo-body">
      <BuildingRatingVariantPicker combo={combo} index={index} onChange={setIndex} roster={roster} />
      <RatingVariantDetails variant={variant} roster={roster} config={config} />
    </div>
  </details>
}
