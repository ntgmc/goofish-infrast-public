import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Factory, Store, Zap } from 'lucide-react'
import { copy } from '../copy'
import { FACILITY_IDS, facilityLayoutSchema, facilityRoomsSchema } from '../lib/facility-layout'
import { apiJson } from '../lib/api-client'
import type { LicenseConfig } from '../lib/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import SklandIcon from './SklandIcon'
import './FacilityLayoutEditor.css'

const FACILITIES = {
  trading: { label: copy.common.facilityLayoutTrading, icon: Store },
  manufacture: { label: copy.common.facilityLayoutManufacture, icon: Factory },
  power: { label: copy.common.facilityLayoutPower, icon: Zap },
}
type FacilityType = keyof typeof FACILITIES
type Room = { type: FacilityType; level: number }
const TYPES = Object.keys(FACILITIES) as FacilityType[]
const positionLabel = (position: number) => `B${Math.floor(position / 3) + 1} · ${copy.common.facilityLayoutColumns[position % 3]}`

export default function FacilityLayoutEditor({ config, onUpdate, profileId }: {
  profileId?: string
  config: LicenseConfig
  onUpdate: (mutate: (config: LicenseConfig) => void) => void
}) {
  const roomFor = (id: string): Room => {
    const type = id.split('_')[0] as FacilityType
    const levels = type === 'trading' ? config.trading_station_levels : config.manufacturing_station_levels
    return { type, level: type === 'power' ? 3 : levels?.[Number(id.split('_')[1]) - 1] ?? 3 }
  }
  const parsed = facilityLayoutSchema.safeParse(config.facility_layout)
  const savedLayout = parsed.success ? parsed.data.join(',') : ''
  const [editing, setEditing] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const collapsed = Boolean(savedLayout) && !editing
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const [rooms, setRooms] = useState(() => (parsed.success ? parsed.data : FACILITY_IDS).map(roomFor))
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [readNotice, setReadNotice] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)
  const expected = FACILITY_IDS.map(roomFor)
  const expectedSignature = JSON.stringify(expected)
  useEffect(() => () => requestRef.current?.abort(), [])

  const readFacilities = async () => {
    if (!profileId || reading) return
    const controller = new AbortController()
    requestRef.current = controller
    setReading(true)
    setReadNotice('')
    try {
      const response = await apiJson<{ rooms: unknown }>('/api/user/skland/facilities', {
        method: 'POST',
        json: { profile_id: profileId },
        signal: controller.signal,
        fallbackMessage: copy.common.facilityLayoutReadFailed,
      })
      const imported = facilityRoomsSchema.safeParse(response.rooms)
      if (!imported.success) throw new Error(copy.common.facilityLayoutReadFailed)
      if (controller.signal.aborted) return
      setRooms(imported.data)
      setEditing(true)
      setReviewed(false)
      setErrors([])
      onUpdate((next) => { delete next.facility_layout })
      setReadNotice(copy.common.facilityLayoutReadSuccess)
    } catch (error) {
      if (!controller.signal.aborted) setReadNotice(error instanceof Error ? error.message : copy.common.facilityLayoutReadFailed)
    } finally {
      if (!controller.signal.aborted) setReading(false)
    }
  }

  useEffect(() => {
    if (savedLayout) {
      const requirements = JSON.parse(expectedSignature) as Room[]
      setRooms(savedLayout.split(',').map((id) => requirements[FACILITY_IDS.indexOf(id as typeof FACILITY_IDS[number])]))
      setErrors([])
    }
  }, [savedLayout, expectedSignature])

  const updateRoom = (position: number, change: Partial<Room>) => {
    setReviewed(false)
    setRooms((current) => current.map((room, index) => index === position ? { ...room, ...change } : room))
    setErrors([])
    // A draft must never leave the previously confirmed layout available for generation.
    onUpdate((next) => { delete next.facility_layout })
  }
  const confirm = () => {
    const issues = TYPES.flatMap((type) => {
      const actualLevels = rooms.filter((room) => room.type === type).map((room) => room.level).sort()
      const requiredLevels = expected.filter((room) => room.type === type).map((room) => room.level).sort()
      return actualLevels.join() === requiredLevels.join() ? [] : [
        copy.common.facilityLayoutMismatch(FACILITIES[type].label, requiredLevels.join('/'), actualLevels.join('/')),
      ]
    })
    setErrors(issues)
    if (issues.length) {
      setReviewed(false)
      requestAnimationFrame(() => statusRef.current?.focus())
      return
    }
    if (!reviewed) {
      setReviewed(true)
      return
    }
    const available = [...FACILITY_IDS]
    const layout = rooms.map((room) => {
      const index = available.findIndex((id) => {
        const candidate = roomFor(id)
        return candidate.type === room.type && candidate.level === room.level
      })
      return available.splice(index, 1)[0]
    })
    onUpdate((next) => { next.facility_layout = layout })
    setReviewed(false)
    setEditing(false)
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }
  return (
    <section className="facility-layout mt-5 border-t border-surface-3/60 pt-5" aria-labelledby="facility-layout-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="facility-layout-heading" className="font-semibold text-ink-primary">{copy.common.facilityLayoutTitle}</h3>
        <span className={`tool-status ${savedLayout ? 'tool-status--success' : 'tool-status--warning'}`}>
          {savedLayout ? copy.common.facilityLayoutSaved : copy.common.facilityLayoutDraft}
        </span>
      </div>
      {profileId && (
        <button type="button" disabled={reading} onClick={() => { void readFacilities() }} className="tool-secondary-action mt-3 min-h-11 px-3">
          <SklandIcon />
          {reading ? copy.common.facilityLayoutReading : copy.common.facilityLayoutRead}
        </button>
      )}
      {readNotice && <p role="status" className="tool-alert mt-3">{readNotice}</p>}
      <fieldset disabled={reading} className="min-w-0 border-0 p-0" aria-busy={reading}>
      {collapsed ? (
        <div className="tool-inset mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
          <div role="status">
            <p className="flex items-center gap-2 font-semibold text-ink-primary">
              <Check size={18} aria-hidden="true" />{copy.common.facilityLayoutComplete}
            </p>
            <p className="mt-1 text-sm text-ink-secondary">{copy.common.facilityLayoutCompleteHelp}</p>
          </div>
          <button ref={editButtonRef} type="button" className="tool-secondary-action min-h-11 px-4"
            aria-expanded={false}
            onClick={() => {
              setEditing(true)
              setReviewed(false)
              onUpdate((next) => { delete next.facility_layout })
              requestAnimationFrame(() => document.getElementById('facility-layout-editor')?.focus())
            }}>
            {copy.common.facilityLayoutEdit}
          </button>
        </div>
      ) : (
      <div id="facility-layout-editor" tabIndex={-1}>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.common.facilityLayoutHelp}</p>
      <div className="facility-layout-grid">
        {rooms.map((room, position) => {
          const { label, icon: Icon } = FACILITIES[room.type]
          return (
            <div key={position} className={`facility-card facility-card--${room.type}`}>
              <button type="button" className="facility-card-select"
                aria-label={`${positionLabel(position)} · ${label} · ${room.level}${copy.common.facilityLayoutLevel}`}
                aria-haspopup="dialog"
                onClick={(event) => { triggerRef.current = event.currentTarget; setSelectedPosition(position) }}>
                <span className="facility-card-position">{positionLabel(position)}<ChevronDown size={14} aria-hidden="true" /></span>
                <Icon className="facility-card-icon" aria-hidden="true" />
                <span className="facility-card-name">{label}</span>
              </button>
              <div className="facility-card-levels" role="group" aria-label={`${positionLabel(position)} · ${copy.common.facilityLayoutLevelLabel}`}>
                {[1, 2, 3].map((level) => (
                  <button key={level} type="button" aria-pressed={room.level === level}
                    onClick={() => { if (room.level !== level) updateRoom(position, { level }) }}>
                    {level}<span>{copy.common.facilityLayoutLevel}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="facility-layout-footer">
        <div className="facility-layout-counts" aria-label={copy.common.facilityLayoutCounts}>
          {TYPES.map((type) => <span key={type}>{FACILITIES[type].label} <strong>{rooms.filter((room) => room.type === type).length}</strong> / {expected.filter((room) => room.type === type).length}</span>)}
        </div>
        <button type="button" className="tool-primary-action min-h-11 px-4" onClick={confirm}>
          {reviewed ? copy.common.facilityLayoutConfirmCollapse : copy.common.facilityLayoutConfirm}
        </button>
      </div>
      {reviewed && <p role="status" className="tool-alert mt-3">{copy.common.facilityLayoutReviewHelp}</p>}
      {errors.length > 0 && (
        <div ref={statusRef} role="alert" tabIndex={-1} className="tool-alert tool-alert--warning mt-3">
          <p className="font-medium">{copy.common.facilityLayoutInvalid}</p>
          <ul className="mt-1 list-inside list-disc">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}
      </div>
      )}
      </fieldset>
      <Dialog open={selectedPosition !== null} onOpenChange={(open) => { if (!open) setSelectedPosition(null) }}>
        <DialogContent showCloseButton closeLabel={copy.common.facilityLayoutClose}
          onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }}>
          <DialogTitle>{copy.common.facilityLayoutChoose}{selectedPosition !== null ? ` · ${positionLabel(selectedPosition)}` : ''}</DialogTitle>
          <DialogDescription>{copy.common.facilityLayoutDialogHelp}</DialogDescription>
          <div className="facility-picker">
            {TYPES.map((type) => {
              const { label, icon: Icon } = FACILITIES[type]
              const selected = selectedPosition !== null && rooms[selectedPosition].type === type
              return (
                <button type="button" key={type} className={`tool-secondary-action facility-picker-option facility-card--${type} ${selected ? 'tool-option-selected' : ''}`}
                  aria-pressed={selected} onClick={() => {
                    if (selectedPosition !== null && !selected) updateRoom(selectedPosition, { type })
                    setSelectedPosition(null)
                  }}>
                  <Icon className="facility-card-icon" aria-hidden="true" />
                  <span>{label}</span>
                  <span className="facility-picker-check">{selected ? <Check size={16} aria-hidden="true" /> : null}</span>
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
