import { Link } from 'react-router'
import { copy } from '../../copy'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import { buildingRatingCharacter, buildingRatingGrade, buildingRatingSkill, buildingRatingTrainingCost, ratingMemberStatus, ratingVariantStatus, relatedBuildingCombos, type RatingMember, type RatingRoster, type RatingStage, type RatingVariant } from '../../lib/building-skill-ratings'
import type { LicenseConfig } from '../../lib/types'
import { v2Path } from './navigation'
import { Avatar } from './ScheduleBoard'

const text = copy.buildingRatings
const number = (value: number) => value.toLocaleString('zh-CN')
const unlock = copy.domain.building_skills.unlock
export function RatingBadge({ score, low }: { score: number; low?: number }) {
  const grade = buildingRatingGrade(score)
  const lowGrade = low === undefined ? grade : buildingRatingGrade(low)
  return <span className="v2-rating-score" data-grade={grade}><strong>{lowGrade === grade ? grade : `${lowGrade}–${grade}`}</strong><span>{low === undefined || low === score ? text.scores(score) : text.scoreRange(low, score)}</span></span>
}

export function RatingMemberView({ member, roster }: { member: RatingMember; roster: RatingRoster | null }) {
  const character = buildingRatingCharacter(member.id)
  const state = ratingMemberStatus(member, roster)
  return <div className="v2-rating-member"><Avatar operator={{ id: member.id, name: character.name }} small /><div><strong>{character.name}</strong>
    <p>{member.room === 'any' ? text.anyRoom : ROOM_LABELS[member.room] ?? member.room}{['trading', 'manufacture', 'dormitory', 'power'].includes(member.room) && `（${member.station === 'main' ? text.mainRoom : text.otherRoom}）`} · {unlock(member.elite, member.level)}</p>
    {roster && <span className="v2-rating-state" data-state={state}>{text.memberStates[state]}</span>}
  </div></div>
}

function TrainingCost({ members, roster }: { members: RatingMember[]; roster: RatingRoster | null }) {
  const costs = members.map((member) => buildingRatingTrainingCost(member, roster))
  const complete = costs.every((cost) => cost !== null)
  const lmd = costs.reduce((sum, cost) => sum + (cost?.lmd ?? 0), 0)
  const exp = costs.reduce((sum, cost) => sum + (cost?.exp ?? 0), 0)
  return <div className="v2-rating-cost"><strong>{text.cost}</strong>
    {!complete ? <p>{roster && members.some((member) => ratingMemberStatus(member, roster) === 'missing') ? text.costMissing : text.costUnknown}</p>
      : lmd || exp ? <p>{text.lmd} {number(lmd)} · {text.exp} {number(exp)}</p> : <p>{text.noCost}</p>}
    <p className="v2-muted">{!roster && text.guestCost}{text.costScope}</p>
  </div>
}

export function RatingStageDetails({ stages, member, roster, profileId }: { stages: RatingStage[]; member: RatingMember; roster: RatingRoster | null; profileId?: string }) {
  const stage = stages[stages.length - 1]
  const assessment = stage.assessment
  const related = relatedBuildingCombos(member.id)
  return <div className="v2-rating-details">
    <p><strong>{text.reason}：</strong>{assessment.reason}</p>
    {assessment.conditions && <p><strong>{text.conditions}：</strong>{assessment.conditions}</p>}
    {related.length > 0 && <p className="v2-muted">{text.independent}</p>}
    <RatingSkills ids={stage.skills} />
    {stages.length > 1 && <div><h3>{text.stages}</h3><ol className="v2-rating-stages">{stages.map((item) => <li key={`${item.elite}.${item.level}`}><span>{unlock(item.elite, item.level)}</span><RatingBadge score={item.assessment.score!} /><p>{item.assessment.reason}</p></li>)}</ol></div>}
    {assessment.scenarios?.length ? <div><h3>{text.scenarios}</h3><ul className="v2-rating-scenarios">{assessment.scenarios.map((scenario) => <li key={scenario.label}><span>{scenario.label}</span><RatingBadge score={scenario.score} /><p>{scenario.reason}</p></li>)}</ul></div> : null}
    <TrainingCost members={[member]} roster={roster} />
    {related.length > 0 && <div><h3>{text.related}</h3><div className="v2-rating-related">{related.map((combo) => <Link className="v2-text-button" key={combo.id} to={`${v2Path('building-ratings', profileId)}&kind=combo&q=${encodeURIComponent(combo.title)}`}>{combo.title}</Link>)}</div></div>}
  </div>
}

export function RatingVariantDetails({ variant, index, roster, config }: { variant: RatingVariant; index: number; roster: RatingRoster | null; config: LicenseConfig | null }) {
  const match = ratingVariantStatus(variant, roster, config)
  const skillIds = variant.members.flatMap((member) => {
    const active = new Map<number, string>()
    for (const skill of buildingRatingCharacter(member.id).skills) {
      if (skill.elite < member.elite || skill.elite === member.elite && skill.level <= member.level) active.set(skill.slot, skill.id)
    }
    return [...active.values()].filter((id) => buildingRatingSkill(id).room === member.room)
  })
  return <section className="v2-rating-variant" aria-label={text.variant(index)}>
    <header><h3>{text.variant(index)}</h3><RatingBadge score={variant.score} />{variant.provisional && <span className="v2-rating-provisional">{text.provisional}</span>}</header>
    <div className="v2-rating-members">{variant.members.map((member) => <RatingMemberView member={member} roster={roster} key={member.id} />)}</div>
    <p><strong>{text.reason}：</strong>{variant.reason}</p>
    {variant.conditions && <p><strong>{text.conditions}：</strong>{variant.conditions}</p>}
    {roster && <p className="v2-rating-state" data-state={match.state}>{match.membersOwned ? text.membersOwned : text.membersMissing} · {text.states[match.state]}</p>}
    {match.conditions.length > 0 && <ul className="v2-rating-conditions">{match.conditions.map((condition) => <li key={condition.key}>
      <span>{text.requirement[condition.key]}{typeof condition.required === 'number' && ` ${condition.required}`}</span><span data-state={condition.state}>{text.conditionStates[condition.state]}</span>
    </li>)}</ul>}
    <TrainingCost members={variant.members} roster={roster} />
    <details className="v2-disclosure"><summary>{text.skills}</summary><RatingSkills ids={[...new Set(skillIds)]} /></details>
  </section>
}

function RatingSkills({ ids }: { ids: string[] }) {
  return <ul className="v2-rating-skills">{ids.map((id) => {
    const skill = buildingRatingSkill(id)
    return <li key={id}><img src={`/building-skills/${skill.icon}.png`} alt="" width={32} height={32} loading="lazy" decoding="async" /><div><strong>{skill.name}</strong><p>{skill.description}</p></div></li>
  })}</ul>
}
