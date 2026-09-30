import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, LockKeyhole, Search, Upload } from 'lucide-react'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { copy } from '../../copy/index'
import { canonicalJson } from '../../lib/crypto'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import ResultBoardV2, { type BoardRoom } from './ResultBoardV2'
import OperatorAvatarStrip from './OperatorAvatarStrip'
import { prepareResult } from './formatters'
import { ROOM_LABELS } from './labels'
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
  const [search, setSearch] = useState('')
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

  function update(next: ManualPlan[]) {
    setPlans(next)
    setError(null)
    setNotice(null)
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
      <ResultBoardV2 prepared={prepared} isRotationMode={source.schedule_mode === 'rotation'} shiftHours={source.shift_hours}
        activePlan={activePlan} onPlanChange={setActivePlan} editing={{
          onEditRoom: (nextRoom) => {
            setRoom(nextRoom)
            setSlot(Math.max(0, plans[activePlan].rooms[nextRoom.roomType][nextRoom.roomIndex].findIndex((name) => !locked.has(name))))
            setSearch('')
          },
          onDroneTarget: (target) => {
            try { update(changeManualDrone(source, plans, operators, activePlan, target.roomType, target.roomIndex)) }
            catch { setError(label.invalid_edit) }
          },
        }} />
      <Dialog open={Boolean(room)} onOpenChange={(open) => { if (!open) setRoom(null) }}>
        <DialogContent className="max-w-3xl" showCloseButton closeLabel={label.close}>
          <DialogTitle>{room ? label.edit_room(`${room.label} ${room.indexLabel}`) : label.picker}</DialogTitle>
          <DialogDescription>{label.move_hint}</DialogDescription>
          <div className="flex flex-wrap gap-2">
            {selectedRoom.map((name, index) => (
              <button key={index} type="button" disabled={locked.has(name)} aria-pressed={slot === index}
                title={locked.has(name) ? label.lock_operator : label.slot(index + 1)}
                className={`min-h-11 rounded-md border px-3 py-2 text-sm ${slot === index ? 'border-brand-400 text-brand-400' : 'border-surface-3 text-ink-secondary'} disabled:opacity-70`}
                onClick={() => setSlot(index)}>
                {locked.has(name) && <LockKeyhole size={12} className="mr-1 inline" aria-hidden="true" />}
                {name || label.empty_slot(index + 1)}
              </button>
            ))}
          </div>
          {locked.has(selectedName) ? <p className="text-sm text-warning">{label.lock_operator}</p> : (
            <>
              <label className="flex items-center gap-2 rounded-md border border-surface-3 px-3">
                <Search size={16} aria-hidden="true" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={label.search}
                  aria-label={label.search} className="min-h-11 w-full bg-transparent text-sm outline-none" />
              </label>
              <button type="button" className="tool-secondary-action" disabled={!selectedName} onClick={() => chooseOperator('')}>{label.clear}</button>
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5" aria-label={label.picker}>
                {operators.filter((operator) => operator.own && !locked.has(operator.name) && operator.name.includes(search.trim())).map((operator) => {
                  const assigned = Object.entries(plans[activePlan].rooms).find(([, rooms]) => rooms.some((roomOperators) => roomOperators.includes(operator.name)))
                  return (
                    <button key={operator.id} type="button" aria-label={operator.name} aria-pressed={selectedName === operator.name}
                      title={assigned ? label.assigned(ROOM_LABELS[assigned[0]] ?? assigned[0]) : operator.name}
                      className={`rounded-md border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${selectedName === operator.name ? 'border-brand-400 bg-brand-500/10' : 'border-surface-3 hover:bg-surface-2'}`}
                      onClick={() => chooseOperator(operator.name)}>
                      <OperatorAvatarStrip operators={[operator]} fallbackText={operator.name} compact showFullNames />
                    </button>
                  )
                })}
              </div>
            </>
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
