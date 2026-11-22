import { memo, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { v2Path } from './navigation'
import { motion } from 'motion/react'
import { motionTokens } from '../../components/MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'
import { copy } from '../../copy'
import { operatorBuildingSkills } from '../../components/result-panel/building-skills'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import type { RoomOperator } from '../../components/result-panel/types'

export default memo(function BuildingSkills({ operator }: { operator: RoomOperator }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const reduced = useAppReducedMotion()
  const skills = operatorBuildingSkills(operator)
  const label = copy.domain.building_skills
  if (!skills.length) return <p className="v2-building-skills v2-muted">{copy.v2.skillsUnavailable}</p>
  return <>
    <button type="button" className="v2-building-skills" aria-label={copy.v2.operatorManagement.skills(operator.name)}
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span>{label.title}</span><span className="v2-skill-icons">
        {skills.filter((skill) => skill.state === 'active' || skill.state === 'unknown').map((skill) =>
          <img key={skill.id} src={`/building-skills/${skill.icon}.png`} alt={skill.name} width={28} height={28} loading="lazy" decoding="async" />)}
      </span><span className="v2-skill-toggle" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    <motion.div id={id} className="v2-building-skills-panel" aria-hidden={!open} inert={!open}
      initial={false} animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: reduced ? 0 : motionTokens.duration.enter, ease: motionTokens.ease.enter }}>
      <BuildingSkillList skills={skills} operatorName={operator.name} />
    </motion.div>
  </>
})

export function BuildingSkillList({ skills, operatorName, owned = true, levelBased = skills.some((skill) => skill.level > 1) }: { skills: ReturnType<typeof operatorBuildingSkills>; operatorName?: string; owned?: boolean; levelBased?: boolean }) {
  const [params] = useSearchParams()
  const label = copy.domain.building_skills
  return <div className="v2-skill-list">{skills.map((skill) => <div className={`v2-skill v2-skill-${owned ? skill.state : 'locked'}`} key={skill.id}>
    <img src={`/building-skills/${skill.icon}.png`} alt="" width={32} height={32} loading="lazy" decoding="async" />
    <div><strong>{skill.name}</strong><p className="v2-muted">{ROOM_LABELS[skill.room] ?? label.training} · {label.stage(skill.elite, skill.level, levelBased)}
       · {owned ? skill.state === 'unknown' ? copy.buildingRatings.memberStates.unknown : label[skill.state as 'active' | 'locked' | 'upgraded'] : copy.v2.notOwnedLabel}</p>
      <p>{skill.description}</p></div>
  </div>)}{operatorName && <Link className="v2-text-button" to={`${v2Path('building-ratings', params.get('profile_id'))}&q=${encodeURIComponent(operatorName)}`}>{copy.buildingRatings.detailsLink}</Link>}</div>
}
