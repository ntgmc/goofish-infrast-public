import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eraser, LockKeyhole, Search, Upload } from 'lucide-react'
import PinyinMatch from 'pinyin-match'
import type { LicenseConfig, LicenseOperator, OptimizeResult } from '../../lib/types'
import { copy } from '../../copy/index'
import { canonicalJson } from '../../lib/crypto'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import ResultBoardV2, { type BoardRoom } from './ResultBoardV2'
import { OperatorAvatarTile } from './OperatorAvatarStrip'
import { prepareResult } from './formatters'
import { ROOM_LABELS } from './labels'
import { operatorBuildingSkills } from './building-skills'
import ResultMetrics from './ResultMetrics'
import ResultDetail from './ResultDetail'
import ManualMoodSummary from './ManualMoodSummary'
import { getOptimizePollRetryDelayMs } from '../../lib/optimize-poll'
import { submitOptimizationJob } from '../../pages/tool/optimize/optimization-api'
import { fetchOptimizeJobSnapshotStatus, isOptimizeJobPollCancelled, isRetryableOptimizePollError, waitForOptimizePoll } from '../../pages/tool/optimize/job-progress'
import {
  changeManualDrone, changeManualOperator, createManualPlans, fillManualDormitories, lockedManualOperators, manualResult,
  manualSourceKey, parseManualDraft, readManualDraft, saveManualDraft, type ManualDraft, type ManualPlan,
} from '../../lib/manual-schedule'

export default function ManualScheduleEditor({ source, profileId, operators, simulationBaseline, draftStorageKey = profileId }: {
  source: OptimizeResult;
  profileId: string;
  operators: LicenseOperator[];
  simulationBaseline?: { id?: string; config: LicenseConfig };
  draftStorageKey?: string;
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
  const [simulation, setSimulation] = useState<OptimizeResult | null>(null)
  const [simulating, setSimulating] = useState(false)
  const simulationRun = useRef(0)
  const simulationLock = useRef(false)
  const operatorsKey = canonicalJson(operators)
  const currentInputKey = useRef(canonicalJson({ plans, operators }))
  currentInputKey.current = canonicalJson({ plans, operators })
  const [confirmation, setConfirmation] = useState<'reset' | 'restore' | 'import' | null>(null)
  const [imported, setImported] = useState<ManualDraft | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const dirty = canonicalJson(plans) !== baseline
  const changed = canonicalJson(plans) !== canonicalJson(createManualPlans(source))
  const locked = useMemo(() => lockedManualOperators(source), [source])
  const result = useMemo(() => simulation ?? manualResult(source, plans), [source, plans, simulation])
  const prepared = useMemo(() => prepareResult(result, result.schedule_mode === 'rotation', result.dormitory_rule === 'maa_pure_autofill', operators), [result, operators])
  const selectedRoom = room ? plans[activePlan].rooms[room.roomType][room.roomIndex] : []
  const selectedName = selectedRoom[slot] ?? ''
  useEffect(() => () => { simulationRun.current += 1 }, [])
  useEffect(() => { setSimulation(null) }, [operatorsKey])

  useEffect(() => {
    try { setStored(readManualDraft(draftStorageKey, source, operators)) }
    catch { setError(label.invalid_draft) }
  }, [draftStorageKey, source, operators, label.invalid_draft])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = useCallback((next: ManualPlan[]) => {
    currentInputKey.current = canonicalJson({ plans: next, operators })
    setPlans(next)
    setSimulation(null)
    setError(null)
    setNotice(null)
  }, [operators])

  async function simulate(submittedPlans = plans) {
    if (!simulationBaseline || simulationLock.current) return
    simulationLock.current = true
    const run = ++simulationRun.current
    const submittedKey = canonicalJson({ plans: submittedPlans, operators })
    const isCancelled = () => simulationRun.current !== run
    setSimulating(true)
    setError(null)
    setSimulation(null)
    try {
      const accepted = await submitOptimizationJob({
        kind: 'schedule', identity: { type: 'profile', profileId },
        operators, config: simulationBaseline.config, includeUpgradeSuggestions: false,
        manualSchedule: simulationBaseline.id
          ? { baselineHistoryId: simulationBaseline.id, plans: submittedPlans }
          : { source, plans: submittedPlans },
      }, label.simulation_failed)
      let failures = 0
      while (!isCancelled()) {
        try {
          const job = await fetchOptimizeJobSnapshotStatus<OptimizeResult>(accepted.job_id, label.simulation_failed, accepted.poll_token, isCancelled)
          if (isCancelled()) return
          failures = 0
          if (job.status === 'succeeded') {
            if (currentInputKey.current === submittedKey) setSimulation(job.result)
            return
          }
          if (job.status !== 'queued' && job.status !== 'running') throw new Error(job.error.message)
          await waitForOptimizePoll(1000, isCancelled)
        } catch (cause) {
          if (isOptimizeJobPollCancelled(cause)) return
          if (!isRetryableOptimizePollError(cause)) throw cause
          await waitForOptimizePoll(getOptimizePollRetryDelayMs(++failures), isCancelled)
        }
      }
    } catch (cause) {
      if (!isCancelled() && !isOptimizeJobPollCancelled(cause)) {
        setError(cause instanceof Error ? cause.message : label.simulation_failed)
      }
    } finally {
      if (!isCancelled()) {
        simulationLock.current = false
        setSimulating(false)
      }
    }
  }

  function fillDormitories() {
    const additions = simulation?.mood_simulation?.dormitory_recovery?.additions
    if (!additions?.length || simulationLock.current) return
    try {
      const next = fillManualDormitories(source, plans, operators, additions)
      update(next)
      void simulate(next)
    } catch {
      setError(label.invalid_edit)
    }
  }

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
        localStorage.removeItem(`manual-schedule:${draftStorageKey}`)
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
      const draft = saveManualDraft(draftStorageKey, source, plans, operators)
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
        <p className="font-semibold" role="status">{simulating ? label.simulating : simulation ? label.simulated : label.warning}</p>
        <p className="text-sm"><LockKeyhole size={14} className="mr-1 inline" aria-hidden="true" />{label.locked}</p>
      </div>
      <div className="tool-panel space-y-3 p-4">
        {draftStorageKey === profileId && <p className="text-sm leading-6 text-ink-secondary">{label.result_scope}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tool-primary-action" disabled={!simulationBaseline || simulating} aria-busy={simulating} onClick={() => void simulate()}>{label.simulate}</button>
          <button type="button" className="tool-primary-action" disabled={!changed || busy} onClick={save}>{label.save}</button>
          <button type="button" className="tool-secondary-action" disabled={!stored || busy}
            onClick={() => dirty ? setConfirmation('restore') : stored && restore(stored)}>{label.restore}</button>
          <button type="button" className="tool-secondary-action" disabled={(!changed && !stored) || busy} onClick={() => setConfirmation('reset')}>{label.reset}</button>
          <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => void download('backup')}><Download size={14} aria-hidden="true" />{label.backup}</button>
          <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => upload.current?.click()}><Upload size={14} aria-hidden="true" />{label.import}</button>
          <input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label={label.import} onChange={(event) => void importBackup(event.target.files?.[0])} />
        </div>
        <p className="text-xs leading-5 text-ink-muted">{label.storage_hint}</p>
        <details className="tool-inset overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-primary">{label.rules_title}</summary>
          <dl className="space-y-3 border-t border-surface-3/60 p-4 text-sm leading-6">
            {[
              [label.save, label.save_rule],
              [label.restore, label.restore_rule],
              [label.reset, label.reset_rule],
              [label.simulate, label.simulation_rule],
              [label.export_rule_title, label.export_rule],
            ].map(([title, description]) => (
              <div key={title}>
                <dt className="font-medium text-ink-primary">{title}</dt>
                <dd className="text-ink-secondary">{description}</dd>
              </div>
            ))}
          </dl>
        </details>
        {!simulationBaseline && <p className="text-sm text-ink-muted">{label.simulation_baseline_required}</p>}
        {!simulation && source.schedule_mode !== 'rotation' && source.dormitory_rule !== 'maa_pure_autofill' &&
          <p className="text-sm text-ink-muted">{label.dormitory_pending}</p>}
        {dirty && <p className="text-sm text-warning" role="status">{label.unsaved}</p>}
        {notice && <p className="text-sm text-success" role="status">{notice}</p>}
      </div>
      {error && <p className="tool-alert tool-alert--warning p-3 text-sm" role="alert">{error}</p>}
      {simulation && <ResultMetrics isRotationMode={source.schedule_mode === 'rotation'} prepared={prepared} />}
      {simulation?.mood_simulation && <ManualMoodSummary result={simulation} activePlan={activePlan}
        onPlanChange={setActivePlan} onFill={fillDormitories} filling={simulating || busy} />}
      {simulation && <details className="tool-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold">{label.simulation_details}</summary>
        <ResultDetail isRotationMode={source.schedule_mode === 'rotation'} prepared={prepared} planTimes={source.planTimes} />
      </details>}
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
          <div className="flex items-center justify-between gap-3 border-t border-surface-3 pt-3">
            <button type="button" className="tool-secondary-action" disabled={!selectedName || locked.has(selectedName)}
              onClick={() => chooseOperator('')}>
              <Eraser size={16} aria-hidden="true" />{label.clear}
            </button>
            <DialogClose className="tool-primary-action min-w-24">{label.done}</DialogClose>
          </div>
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
    .filter(({ operator, known, skills }) => (!query || PinyinMatch.match(operator.name, query))
      && (!facility || !known || skills.some((skill) => skill.room === facility))),
  [available, facility, query])
  const resetScroll = () => { setVisibleCount(30); if (grid.current) grid.current.scrollTop = 0 }
  const candidates = useDeferredValue(matches, [])
  // ponytail: keep scrolled batches mounted; window rows if inventories grow to thousands.
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
        <div className="flex min-w-0 items-center rounded-lg border border-surface-3 bg-surface-2/40 transition-[border-color,box-shadow] duration-150 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20">
          <label className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
              placeholder={label.search} aria-label={label.search} style={{ outline: 'none' }}
              className="min-h-11 min-w-0 w-full bg-transparent text-sm text-ink-primary placeholder:text-ink-muted" />
          </label>
          <label className="w-28 shrink-0 border-l border-surface-3 sm:w-36">
            <span className="sr-only">{copy.domain.building_skills.facility}</span>
            <select aria-label={copy.domain.building_skills.facility} value={facility}
              className="min-h-11 w-full rounded-r-lg bg-transparent px-2 text-sm text-ink-primary focus-visible:outline-none"
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
