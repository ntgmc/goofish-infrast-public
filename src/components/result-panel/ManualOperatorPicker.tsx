import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { SearchIcon as Search } from '../icons'
import { matchesSearch } from '../../lib/search'
import { copy } from '../../copy/index'
import type { LicenseOperator } from '../../lib/types'
import type { ManualPlan } from '../../lib/manual-schedule'
import { OperatorAvatarTile } from './OperatorAvatarStrip'
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
  const label = copy.domain.manual_schedule
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const [facility, setFacility] = useState(roomType)
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (composing || search.trim() === query) return
    const timer = window.setTimeout(() => {
      setQuery(search.trim())
      setVisibleCount(30)
      if (grid.current) grid.current.scrollTop = 0
    }, 200)
    return () => window.clearTimeout(timer)
  }, [search, composing, query])

  const available = useMemo(() => operators
    .filter((operator) => operator.own && !locked.has(operator.name))
    .map((operator) => {
      const skills = operatorBuildingSkills(operator)
      return { operator, known: skills.length > 0, skills: skills.filter((skill) => skill.state === 'active') }
    }),
  [operators, locked])
  const matches = useMemo(() => available
    .filter(({ operator, known, skills }) => matchesSearch(operator.name, query)
      && (!facility || !known || skills.some((skill) => skill.room === facility))),
  [available, facility, query])
  const resetScroll = () => { setVisibleCount(30); if (grid.current) grid.current.scrollTop = 0 }
  const candidates = useDeferredValue(matches, [])
  // shortcut: keep scrolled batches mounted; window rows if inventories grow to thousands.
  const showMore = useCallback(() => setVisibleCount((count) => Math.min(count + 30, matches.length)), [matches.length])
  const choices = useMemo(() => candidates
    .slice(0, visibleCount)
    .map(({ operator, known, skills }, index) => {
      const assigned = Object.entries(rooms).find(([, entries]) => entries.some((room) => room.includes(operator.name)))
      const displayedSkills = skills.filter((skill) => !facility || skill.room === facility)
      return (
        <button key={operator.id} type="button" aria-label={operator.name} aria-pressed={selectedName === operator.name}
          title={assigned ? label.assigned(ROOM_LABELS[assigned[0]] ?? assigned[0]) : operator.name}
          className={`flex min-h-22 min-w-0 items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${selectedName === operator.name ? 'border-brand-400 bg-brand-500/10' : 'border-surface-3 hover:bg-surface-2'}`}
          onFocus={index === visibleCount - 1 ? showMore : undefined}
          onClick={() => onChoose(operator.name)}>
          <div className="shrink-0">
            <OperatorAvatarTile operator={operator} compact showFullNames buttonChild />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {displayedSkills.length > 0 ? displayedSkills.map((skill) => (
              <div key={skill.id} className="flex items-start gap-1.5">
                <img src={`/building-skills/${skill.icon}.png`} alt={skill.name} width={20} height={20}
                  loading="lazy" decoding="async" className="h-5 w-5 shrink-0 rounded bg-slate-800 p-0.5" />
                <p className="line-clamp-2 min-w-0 text-[11px] leading-4 text-ink-secondary">{skill.description}</p>
              </div>
            )) : <p className="text-[11px] leading-4 text-ink-muted">{known ? copy.domain.building_skills.no_active_skills : copy.domain.building_skills.unknown}</p>}
          </div>
        </button>
      )
    }), [candidates, facility, visibleCount, rooms, selectedName, onChoose, label, showMore])

  return (
    <>
      <div className="space-y-2">
        <div className="flex min-w-0 items-center rounded-lg border border-surface-3 bg-surface-2/40 transition-colors duration-150 focus-within:border-brand-500">
          <label className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
              placeholder={label.search} aria-label={label.search}
              className="min-h-11 min-w-0 w-full bg-transparent text-sm text-ink-primary placeholder:text-ink-muted" />
          </label>
          <label className="w-28 shrink-0 border-l border-surface-3 sm:w-36">
            <span className="sr-only">{copy.domain.building_skills.facility}</span>
            <select aria-label={copy.domain.building_skills.facility} value={facility}
              className="min-h-11 w-full rounded-r-lg bg-transparent px-2 text-sm text-ink-primary"
              onChange={(event) => { setFacility(event.target.value); resetScroll() }}>
              <option value="">{copy.domain.building_skills.all_facilities}</option>
              {Object.entries(ROOM_LABELS).map(([type, name]) => <option key={type} value={type}>{name}</option>)}
              <option value="training">{copy.domain.building_skills.training}</option>
            </select>
          </label>
        </div>
        <p className="text-xs leading-5 text-ink-muted">{copy.domain.building_skills.filter_hint}</p>
      </div>
      <div ref={grid} className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:max-h-72 sm:grid-cols-2 lg:grid-cols-3" aria-label={label.picker}
        aria-busy={matches !== candidates || composing || query !== search.trim()} onScroll={(event) => {
          const element = event.currentTarget
          if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) showMore()
        }}>
        {choices.length > 0 ? choices : matches.length > 0
          ? <div className="col-span-full h-52 rounded-md bg-surface-2 sm:h-72" aria-hidden="true" />
          : <p className="col-span-full py-6 text-center text-sm text-ink-muted">{label.no_matches}</p>}
      </div>
    </>
  )
}
