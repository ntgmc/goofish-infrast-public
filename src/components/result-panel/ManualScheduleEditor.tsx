import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Download, LockKeyhole, Search, Upload } from 'lucide-react'
import PinyinMatch from 'pinyin-match'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { copy } from '../../copy/index'
import { canonicalJson } from '../../lib/crypto'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import ResultBoardV2, { type BoardRoom } from './ResultBoardV2'
import OperatorAvatarStrip, { OperatorAvatarTile } from './OperatorAvatarStrip'
import { prepareResult } from './formatters'
import { ROOM_LABELS } from './labels'
import { operatorBuildingSkills } from './building-skills'
import {
  changeManualDrone, changeManualOperator, createManualPlans, lockedManualOperators, manualResult,
  manualSourceKey, parseManualDraft, readManualDraft, saveManualDraft, type ManualDraft, type ManualPlan,
} from './manual-schedule'

export default function ManualScheduleEditor({ source, profileId, operators }: {
  source: OptimizeResult;
  profileId: string;
  operators: LicenseOperator[];
}) {
  const label = copy.domain.manual_schedule
  const [plans, setPlans] = useState<ManualPlan[]>(() => createManualPlans(source))
  const [baseline, setBaseline] = useState(() => canonicalJson(createManualPlans(source)))
  const [stored, setStored] = useState<ManualDraft | null>(null)
  const [activePlan, setActivePlan] = useState(0)
  const [room, setRoom] = useState<BoardRoom | null>(null)
  const [slot, setSlot] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<'reset' | 'restore' | 'import' | null>(null)
  const [imported, setImported] = useState<ManualDraft | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const dirty = canonicalJson(plans) !== baseline
  const changed = canonicalJson(plans) !== canonicalJson(createManualPlans(source))
  const locked = useMemo(() => lockedManualOperators(source), [source])
  const result = useMemo(() => manualResult(source, plans), [source, plans])
  const prepared = useMemo(() => prepareResult(result, result.schedule_mode === 'rotation', result.dormitory_rule === 'maa_pure_autofill', operators), [result, operators])
  const selectedRoom = room ? plans[activePlan].rooms[room.roomType][room.roomIndex] : []
  const selectedName = selectedRoom[slot] ?? ''

  useEffect(() => {
    try { setStored(readManualDraft(profileId, source, operators)) }
    catch { setError(label.invalid_draft) }
  }, [profileId, source, operators, label.invalid_draft])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = useCallback((next: ManualPlan[]) => {
    setPlans(next)
    setError(null)
    setNotice(null)
  }, [])

  function chooseOperator(name: string) {
    if (!room) return
    try {
      update(changeManualOperator(source, plans, operators, activePlan, room.roomType, room.roomIndex, slot, name))
    } catch { setError(label.invalid_edit) }
  }

  function restore(draft: ManualDraft) {
    update(structuredClone(draft.plans))
    setBaseline(canonicalJson(draft.plans))
    setRoom(null)
  }

  function confirm() {
    if (confirmation === 'reset') {
      try {
        localStorage.removeItem(`manual-schedule:${profileId}`)
        const base = createManualPlans(source)
        update(base)
        setBaseline(canonicalJson(base))
        setStored(null)
      } catch { setError(label.storage_failed) }
    } else if (confirmation === 'restore' && stored) restore(stored)
    else if (confirmation === 'import' && imported) {
      update(imported.plans)
      setRoom(null)
    }
    setConfirmation(null)
  }

  function save() {
    try {
      const draft = saveManualDraft(profileId, source, plans, operators)
      setStored(draft)
      setBaseline(canonicalJson(plans))
      setNotice(label.saved)
      setError(null)
    } catch { setError(label.storage_failed) }
  }

  async function download(type: 'current' | 'all' | 'backup') {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (type === 'backup') {
        const draft: ManualDraft = { version: 1, source: manualSourceKey(source), title: source.title, savedAt: new Date().toISOString(), plans }
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'manual-schedule-draft.json'
        try { document.body.append(anchor); anchor.click() }
        finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      } else {
        const { downloadScheduleImage } = await import('./schedule-image')
        await downloadScheduleImage({ prepared, title: source.title, isRotationMode: source.schedule_mode === 'rotation',
          version: 'v2', planIndex: type === 'current' ? activePlan : undefined, shiftHours: source.shift_hours, manual: true })
      }
    } catch { setError(label.download_failed) }
    finally { setBusy(false) }
  }

  async function importBackup(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 5_000_000) throw new Error('Backup too large')
      const draft = parseManualDraft(await file.text(), source, operators)
      if (dirty) { setImported(draft); setConfirmation('import') }
      else update(draft.plans)
      setError(null)
    } catch { setError(label.importing_failed) }
    finally { setBusy(false); if (upload.current) upload.current.value = '' }
  }

  const board = useMemo(() => (
    <ResultBoardV2 prepared={prepared} isRotationMode={source.schedule_mode === 'rotation'} shiftHours={source.shift_hours}
      activePlan={activePlan} onPlanChange={setActivePlan} editing={{
        rooms: plans[activePlan].rooms,
        lockedOperators: locked,
        onEditRoom: (nextRoom, nextSlot) => { setRoom(nextRoom); setSlot(nextSlot) },
        onDroneTarget: (target) => {
          try { update(changeManualDrone(source, plans, operators, activePlan, target.roomType, target.roomIndex)) }
          catch { setError(label.invalid_edit) }
        },
      }} />
  ), [prepared, source, activePlan, plans, locked, operators, update, label])

  return (
    <section className="space-y-4" aria-label={label.title}>
      <div className="tool-alert tool-alert--warning space-y-2 p-4">
        <p className="font-semibold">{label.warning}</p>
        <p className="text-sm"><LockKeyhole size={14} className="mr-1 inline" aria-hidden="true" />{label.locked}</p>
      </div>
      <div className="tool-panel space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tool-primary-action" disabled={!changed || busy} onClick={save}>{label.save}</button>
          <button type="button" className="tool-secondary-action" disabled={!stored || busy}
            onClick={() => dirty ? setConfirmation('restore') : stored && restore(stored)}>{label.restore}</button>
          <button type="button" className="tool-secondary-action" disabled={!changed || busy} onClick={() => setConfirmation('reset')}>{label.reset}</button>
          <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => void download('backup')}><Download size={14} aria-hidden="true" />{label.backup}</button>
          <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => upload.current?.click()}><Upload size={14} aria-hidden="true" />{label.import}</button>
          <input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label={label.import} onChange={(event) => void importBackup(event.target.files?.[0])} />
        </div>
        <p className="text-xs leading-5 text-ink-muted">{label.storage_hint}</p>
        {dirty && <p className="text-sm text-warning" role="status">{label.unsaved}</p>}
        {notice && <p className="text-sm text-success" role="status">{notice}</p>}
      </div>
      {error && <p className="tool-alert tool-alert--warning p-3 text-sm" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => void download('current')}><Download size={14} aria-hidden="true" />{copy.domain.result_image.current}</button>
        <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => void download('all')}><Download size={14} aria-hidden="true" />{copy.domain.result_image.all}</button>
        <button type="button" className="tool-secondary-action" disabled={!plans[activePlan]?.drones.enable || busy} onClick={() => {
          try { update(changeManualDrone(source, plans, operators, activePlan)) } catch { setError(label.invalid_edit) }
        }}>{label.no_drone}</button>
      </div>
      {board}
      <Dialog open={Boolean(room)} onOpenChange={(open) => { if (!open) setRoom(null) }}>
        <DialogContent className="max-w-3xl ease-[ease-out] will-change-[transform,opacity]" showCloseButton closeLabel={label.close}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true })
          }}>
          <DialogTitle>{room ? label.edit_room(`${room.label} ${room.indexLabel}`) : label.picker}</DialogTitle>
          <DialogDescription>{label.move_hint}</DialogDescription>
          <div className="flex flex-wrap gap-2">
            {selectedRoom.map((name, index) => (
              <button key={index} type="button" disabled={locked.has(name)} aria-pressed={slot === index} aria-label={name || label.empty_slot(index + 1)}
                title={locked.has(name) ? label.lock_operator : label.slot(index + 1)}
                className={`relative rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${slot === index ? 'border-brand-400 bg-brand-500/10' : 'border-surface-3 hover:bg-surface-2'} disabled:cursor-not-allowed disabled:opacity-70`}
                onClick={() => setSlot(index)}>
                <OperatorAvatarTile key={name || index} operator={name ? operators.find((operator) => operator.name === name) ?? { name } : undefined}
                  placeholder={label.empty_slot(index + 1)} large showFullNames buttonChild />
                {locked.has(name) && <LockKeyhole size={14} className="absolute right-1 top-1 rounded-sm bg-surface-1 text-warning" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {locked.has(selectedName) ? <p className="text-sm text-warning">{label.lock_operator}</p> : (
            <ManualOperatorPicker key={room?.key} operators={operators} locked={locked} rooms={plans[activePlan].rooms} roomType={room?.roomType ?? ''}
              selectedName={selectedName} onChoose={chooseOperator} />
          )}
          <DialogClose className="tool-primary-action">{label.done}</DialogClose>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null) }}>
        <DialogContent>
          <DialogTitle>{confirmation === 'reset' ? label.reset : label.restore}</DialogTitle>
          <DialogDescription>{confirmation === 'reset' ? label.reset_confirm : label.restore_confirm}</DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose className="tool-secondary-action">{label.close}</DialogClose>
            <button type="button" className="tool-primary-action" onClick={confirm}>{label.done}</button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ManualOperatorPicker({ operators, locked, rooms, roomType, selectedName, onChoose }: {
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
  const [skillName, setSkillName] = useState('')
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
  const skillNames = useMemo(() => [...new Set(available.flatMap(({ skills }) => skills
    .filter((skill) => !facility || skill.room === facility).map((skill) => skill.name)))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  [available, facility])
  const matches = useMemo(() => available
    .filter(({ operator, known, skills }) => (!query || PinyinMatch.match(operator.name, query))
      && (!facility && !skillName || !known && !skillName || skills.some((skill) => (!facility || skill.room === facility) && (!skillName || skill.name === skillName))))
    .map(({ operator }) => operator),
  [available, facility, skillName, query])
  const resetScroll = () => { setVisibleCount(30); if (grid.current) grid.current.scrollTop = 0 }
  const candidates = useDeferredValue(matches, [])
  // ponytail: keep scrolled batches mounted; window rows if inventories grow to thousands.
  const showMore = useCallback(() => setVisibleCount((count) => Math.min(count + 30, matches.length)), [matches.length])
  const choices = useMemo(() => candidates
    .slice(0, visibleCount)
    .map((operator, index) => {
      const assigned = Object.entries(rooms).find(([, entries]) => entries.some((room) => room.includes(operator.name)))
      return (
        <button key={operator.id} type="button" aria-label={operator.name} aria-pressed={selectedName === operator.name}
          title={assigned ? label.assigned(ROOM_LABELS[assigned[0]] ?? assigned[0]) : operator.name}
          className={`rounded-md border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${selectedName === operator.name ? 'border-brand-400 bg-brand-500/10' : 'border-surface-3 hover:bg-surface-2'}`}
          onFocus={index === visibleCount - 1 ? showMore : undefined}
          onClick={() => onChoose(operator.name)}>
          <OperatorAvatarStrip operators={[operator]} fallbackText={operator.name} compact showFullNames buttonChild />
        </button>
      )
    }), [candidates, visibleCount, rooms, selectedName, onChoose, label, showMore])

  return (
    <>
      <label className="flex items-center gap-2 rounded-md border border-surface-3 bg-surface-2/40 px-3 transition-[border-color,box-shadow] duration-150 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20">
        <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          placeholder={label.search} aria-label={label.search} style={{ outline: 'none' }}
          className="min-h-11 min-w-0 w-full bg-transparent text-sm text-ink-primary placeholder:text-ink-muted" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 space-y-1 text-xs text-ink-muted">
          <span>{copy.domain.building_skills.facility}</span>
          <select aria-label={copy.domain.building_skills.facility} value={facility}
            className="min-h-11 w-full rounded-md border border-surface-3 bg-surface-1 px-3 text-sm text-ink-primary"
            onChange={(event) => { setFacility(event.target.value); setSkillName(''); resetScroll() }}>
            <option value="">{copy.domain.building_skills.all_facilities}</option>
            {Object.entries(ROOM_LABELS).map(([type, name]) => <option key={type} value={type}>{name}</option>)}
            <option value="training">{copy.domain.building_skills.training}</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-xs text-ink-muted">
          <span>{copy.domain.building_skills.filter}</span>
          <select aria-label={copy.domain.building_skills.filter} value={skillName}
            className="min-h-11 w-full rounded-md border border-surface-3 bg-surface-1 px-3 text-sm text-ink-primary"
            onChange={(event) => { setSkillName(event.target.value); resetScroll() }}>
            <option value="">{copy.domain.building_skills.all_skills}</option>
            {skillNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs leading-5 text-ink-muted">{copy.domain.building_skills.filter_hint}</p>
      <button type="button" className="tool-secondary-action" disabled={!selectedName} onClick={() => onChoose('')}>{label.clear}</button>
      <div ref={grid} className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto sm:max-h-72 sm:grid-cols-5" aria-label={label.picker}
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
