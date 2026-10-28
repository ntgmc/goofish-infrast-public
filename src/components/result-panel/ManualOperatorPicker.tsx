import { useMemo, useState } from 'react'
import { copy } from '../../copy/index'
import type { LicenseOperator } from '../../lib/types'
import type { ManualPlan } from '../../lib/manual-schedule'
import OperatorPicker from '../OperatorPicker'
import { operatorBuildingSkills } from './building-skills'
import { ROOM_LABELS } from './labels'

export default function ManualOperatorPicker({ operators, locked, rooms, roomType, selectedName, onChoose }: {
  operators: LicenseOperator[];
  locked: Set<string>;
  rooms: ManualPlan['rooms'];
  roomType: string;
  selectedName: string;
  onChoose: (name: string) => void;
}) {
  const [facility, setFacility] = useState(roomType)
  const available = useMemo(() => operators
    .filter((operator) => operator.own && !locked.has(operator.name))
    .map((operator) => {
      const skills = operatorBuildingSkills(operator)
      return { ...operator, known: skills.length > 0, skills: skills.filter((skill) => skill.state === 'active') }
    }), [operators, locked])
  const candidates = useMemo(() => available.filter(({ known, skills }) => !facility || !known || skills.some((skill) => skill.room === facility)), [available, facility])
  return <OperatorPicker operators={candidates} selectedId={operators.find((operator) => operator.name === selectedName)?.id}
    onChoose={(operator) => onChoose(operator.name)}
    title={(operator) => {
      const assigned = Object.entries(rooms).find(([, entries]) => entries.some((room) => room.includes(operator.name)))
      return assigned ? copy.domain.manual_schedule.assigned(ROOM_LABELS[assigned[0]] ?? assigned[0]) : operator.name
    }}
    controls={<label className="w-28 shrink-0 border-l border-surface-3 sm:w-36">
      <span className="sr-only">{copy.domain.building_skills.facility}</span>
      <select aria-label={copy.domain.building_skills.facility} value={facility}
        className="min-h-11 w-full rounded-r-lg bg-transparent px-2 text-sm text-ink-primary"
        onChange={(event) => setFacility(event.target.value)}>
        <option value="">{copy.domain.building_skills.all_facilities}</option>
        {Object.entries(ROOM_LABELS).map(([type, name]) => <option key={type} value={type}>{name}</option>)}
        <option value="training">{copy.domain.building_skills.training}</option>
      </select>
    </label>}
    hint={copy.domain.building_skills.filter_hint}
    details={({ known, skills }) => {
      const displayedSkills = skills.filter((skill) => !facility || skill.room === facility)
      return displayedSkills.length > 0 ? displayedSkills.map((skill) => <div key={skill.id} className="flex items-start gap-1.5">
        <img src={`/building-skills/${skill.icon}.png`} alt={skill.name} width={20} height={20}
          loading="lazy" decoding="async" className="h-5 w-5 shrink-0 rounded bg-slate-800 p-0.5" />
        <p className="line-clamp-2 min-w-0 text-[11px] leading-4 text-ink-secondary">{skill.description}</p>
      </div>) : <p className="text-[11px] leading-4 text-ink-muted">{known ? copy.domain.building_skills.no_active_skills : copy.domain.building_skills.unknown}</p>
    }} />
}
