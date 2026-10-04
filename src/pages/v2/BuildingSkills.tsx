import { memo, useState } from 'react'
import { copy } from '../../copy'
import { operatorBuildingSkills } from '../../components/result-panel/building-skills'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import type { RoomOperator } from '../../components/result-panel/types'

export default memo(function BuildingSkills({ operator }: { operator: RoomOperator }) {
  const [open, setOpen] = useState(false)
  const skills = operatorBuildingSkills(operator)
  const label = copy.domain.building_skills
  if (!skills.length) return <p className="v2-muted">{copy.v2.skillsUnavailable}</p>
  return <details className="v2-building-skills" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>{label.title}</span><span className="v2-skill-icons">
      {skills.filter((skill) => skill.state === 'active' || skill.state === 'unknown').map((skill) =>
        <img key={skill.id} src={`/building-skills/${skill.icon}.png`} alt={skill.name} width={28} height={28} loading="lazy" decoding="async" />)}
    </span></summary>
    {open && <div className="v2-skill-list">{skills.map((skill) => <div className={`v2-skill v2-skill-${skill.state}`} key={skill.id}>
      <img src={`/building-skills/${skill.icon}.png`} alt="" width={32} height={32} loading="lazy" decoding="async" />
      <div><strong>{skill.name}</strong><p className="v2-muted">{ROOM_LABELS[skill.room] ?? label.training} · {label.unlock(skill.elite, skill.level)}
        {skill.state !== 'unknown' && <> · {label[skill.state as 'active' | 'locked' | 'upgraded']}</>}</p>
        <p>{skill.description}</p></div>
    </div>)}</div>}
  </details>
})
