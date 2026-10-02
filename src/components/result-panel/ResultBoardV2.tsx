import { useId, type KeyboardEvent } from 'react'
import { BedDouble, Building2, Drone, Factory, HandCoins, LockKeyhole, Users, Wrench, Zap, type LucideIcon } from 'lucide-react'
import { copy } from '../../copy/index'
import DroneSummary from './DroneSummary'
import { formatCompactNumber, formatProduct, type PreparedResult } from './formatters'
import { ROOM_LABELS } from './labels'
import OperatorAvatarStrip, { OperatorAvatarTile } from './OperatorAvatarStrip'
import type { PreparedPlan, RoomRow } from './types'
import type { DroneAssignment } from '../../lib/types'
import DroneMarker, { isDroneTarget } from './DroneMarker'
import ProductIcon from '../ProductIcon'

export const PRODUCTION_TYPES = ['control', 'trading', 'manufacture', 'power']
const ROOM_STYLES: Record<string, { icon: LucideIcon; tone: string }> = {
  control: { icon: Building2, tone: 'text-brand-400' },
  trading: { icon: HandCoins, tone: 'text-brand-400' },
  manufacture: { icon: Factory, tone: 'text-warning' },
  power: { icon: Zap, tone: 'text-success' },
  meeting: { icon: Users, tone: 'text-ink-secondary' },
  processing: { icon: Wrench, tone: 'text-ink-secondary' },
  dormitory: { icon: BedDouble, tone: 'text-success' },
}

export type BoardRoom = {
  key: string;
  roomType: string;
  roomIndex: number;
  label: string;
  indexLabel: string;
  product: string;
  row?: RoomRow;
}

type BoardEditing = {
  rooms: Record<string, string[][]>;
  lockedOperators: Set<string>;
  onEditRoom: (room: BoardRoom, slot: number) => void;
  onDroneTarget: (room: BoardRoom) => void;
}

export default function ResultBoardV2({ prepared, isRotationMode, shiftHours, activePlan, onPlanChange, editing }: {
  prepared: PreparedResult;
  isRotationMode: boolean;
  shiftHours?: number[];
  activePlan: number;
  onPlanChange: (index: number) => void;
  editing?: BoardEditing;
}) {
  const id = useId()
  const selectedIndex = activePlan < prepared.plans.length ? activePlan : 0
  const plan = prepared.plans[selectedIndex]
  const rooms = buildBoardV2Rooms(plan, isRotationMode)
  const productionRooms = rooms.filter((room) => PRODUCTION_TYPES.includes(room.roomType))
  const supportRooms = rooms.filter((room) => !PRODUCTION_TYPES.includes(room.roomType))
    .sort((a, b) => Number(a.roomType === 'dormitory') - Number(b.roomType === 'dormitory'))
  const operatorCount = new Set(plan?.rows.flatMap((row) => row.operators.map((operator) => operator.id ?? operator.name))).size
  const fiammettaTarget = !isRotationMode && plan?.Fiammetta?.enable ? plan.Fiammetta.target?.trim() : ''
  const label = copy.domain.result_board_v2

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % prepared.plans.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + prepared.plans.length) % prepared.plans.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = prepared.plans.length - 1
    else return
    event.preventDefault()
    onPlanChange(nextIndex)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  return (
    <section className="tool-panel overflow-hidden" aria-label={label.tab}>
      <div className="tool-panel-header space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-primary">
              {isRotationMode ? copy.domain.components_result_panel_ResultBoard_001 : copy.domain.components_result_panel_ResultBoard_002}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{editing ? copy.domain.manual_schedule.board_hint : label.hint}</p>
          </div>
          <span className="tool-status">{label.tab}</span>
        </div>
        {prepared.plans.length > 0 && (
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-surface-3 bg-surface-2/50 p-1"
            role="tablist" aria-label={label.shifts}>
            {prepared.plans.map((item, index) => {
              const hours = item.shift_hours ?? shiftHours?.[index]
              return (
                <button key={index} id={`${id}-shift-${index}-tab`} type="button" role="tab"
                  aria-selected={selectedIndex === index} aria-controls={`${id}-shift-panel`}
                  tabIndex={selectedIndex === index ? 0 : -1}
                  onClick={() => onPlanChange(index)} onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={`inline-flex min-h-11 flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${
                    selectedIndex === index
                      ? 'bg-surface-1 text-brand-400 shadow-sm ring-1 ring-surface-3'
                      : 'text-ink-muted hover:bg-surface-1/60 hover:text-ink-primary'
                  }`}>
                  {item.name?.trim() || label.shift(index + 1)}
                  {typeof hours === 'number' && hours > 0 && (
                    <span className="font-mono text-xs font-normal text-ink-muted">{formatCompactNumber(hours)}h</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {plan ? (
        <div id={`${id}-shift-panel`} role="tabpanel" aria-labelledby={`${id}-shift-${selectedIndex}-tab`}
          tabIndex={0} className="space-y-4 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/45 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tool-status">{label.rooms(rooms.length)}</span>
            <span className="tool-status">{label.operators(operatorCount)}</span>
            {fiammettaTarget && (
              <span className="tool-status tool-status--warning">{copy.domain.components_result_panel_ResultBoard_017}{fiammettaTarget}</span>
            )}
          </div>
          {rooms.length > 0 ? (
            <div className={`grid items-start gap-5 ${productionRooms.length > 0 && supportRooms.length > 0 ? 'xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]' : ''}`}>
              {productionRooms.length > 0 && (
                <section className="min-w-0 space-y-3" aria-label={label.production}>
                  <h3 className="tool-eyebrow">{label.production}</h3>
                  {PRODUCTION_TYPES.map((roomType) => {
                    const group = productionRooms.filter((room) => room.roomType === roomType)
                    return group.length > 0 && (
                      <div key={roomType} className={`grid gap-3 ${roomType === 'control' ? '' : roomType === 'power' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                        {group.map((room) => <RoomCard key={room.key} room={room} drones={plan.drones} editing={editing} />)}
                      </div>
                    )
                  })}
                </section>
              )}
              {supportRooms.length > 0 && (
                <section className="min-w-0 space-y-3" aria-label={label.support}>
                  <h3 className="tool-eyebrow">{label.support}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {supportRooms.map((room) => <RoomCard key={room.key} room={room} drones={plan.drones} editing={editing} className={room.roomType === 'dormitory' ? 'sm:col-span-2' : ''} />)}
                  </div>
                </section>
              )}
            </div>
          ) : <p className="tool-inset border-dashed p-5 text-sm text-ink-muted">{copy.domain.components_result_panel_ResultBoard_008}</p>}
          {plan.drones?.enable && !editing && (
            <details>
              <summary className="cursor-pointer text-xs text-ink-muted">{copy.domain.manual_schedule.drone_details}</summary>
              <DroneSummary drones={plan.drones} />
            </details>
          )}
        </div>
      ) : <p className="p-5 text-sm text-ink-muted">{copy.domain.components_result_panel_ResultBoard_008}</p>}
    </section>
  )
}

export function buildBoardV2Rooms(plan: PreparedPlan | undefined, isRotationMode: boolean): BoardRoom[] {
  if (!plan) return []
  return Object.entries(plan.rooms ?? {}).flatMap(([roomType, entries]) => {
    if (!Array.isArray(entries) || (isRotationMode && roomType === 'dormitory')) return []
    const autofill = plan.rows.find((row) => row.roomType === roomType && row.isAutofill)
    return entries.flatMap((room, index) => {
      if (autofill && index > 0) return []
      const row = plan.rows.find((item) => item.roomType === roomType && item.roomIndex === index)
      return [{
        key: `${roomType}-${index}`,
        roomType,
        roomIndex: index,
        label: row?.label ?? ROOM_LABELS[roomType] ?? roomType,
        indexLabel: row?.indexLabel ?? [
          entries.length > 1 ? String(index + 1) : '',
          room.level === undefined ? '' : `Lv.${room.level}`,
        ].filter(Boolean).join(' · '),
        product: row?.product ?? formatProduct(room.product),
        row,
      }]
    })
  })
}

function RoomCard({ room, drones, editing, className = '' }: { room: BoardRoom; drones?: DroneAssignment; editing?: BoardEditing; className?: string }) {
  const { row } = room
  const { icon: Icon, tone } = ROOM_STYLES[room.roomType] ?? { icon: Building2, tone: 'text-ink-secondary' }
  const label = copy.domain.result_board_v2
  return (
    <article className={`tool-inset min-w-0 overflow-hidden p-3.5 sm:p-4 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-primary">
          <Icon size={16} className={`shrink-0 ${tone}`} aria-hidden="true" />
          {room.label}
          {room.indexLabel && <span className="text-xs font-medium text-ink-muted">{room.indexLabel}</span>}
        </h4>
        <div className="ml-auto flex max-w-full shrink-0 items-center justify-end gap-2">
          {editing && ['trading', 'manufacture'].includes(room.roomType) ? (
            <button type="button" onClick={() => editing.onDroneTarget(room)}
              aria-label={copy.domain.manual_schedule.set_drone(`${room.label} ${room.indexLabel}`)}
              aria-pressed={isDroneTarget(drones, room.roomType, room.roomIndex)}
              className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${
                isDroneTarget(drones, room.roomType, room.roomIndex) ? 'bg-brand-500/15 text-brand-400' : 'text-ink-muted hover:bg-surface-2'
              }`}>
              <Drone size={20} aria-hidden="true" />
            </button>
          ) : <DroneMarker labels={isDroneTarget(drones, room.roomType, room.roomIndex) ? [room.label] : []} />}
          {room.product !== '-' && (
            <span className={`inline-flex min-w-0 items-center gap-1 text-xs font-medium ${tone}`}>
              <ProductIcon product={room.product} size={20} />
              <span className="min-w-0 break-words text-right">{room.product}</span>
            </span>
          )}
        </div>
      </header>
      {!editing && row && row.efficiency !== '-' && PRODUCTION_TYPES.includes(room.roomType) && room.roomType !== 'control' && (
        <p className={`mt-3 font-mono text-xl font-semibold ${tone}`}>
          {row.efficiency}<span className="ml-2 font-sans text-xs font-normal text-ink-muted">{label.efficiency}</span>
        </p>
      )}
      <div className="mt-3">
        {row?.isAutofill ? (
          <p className="rounded-md border border-dashed border-surface-3 p-3 text-sm leading-6 text-ink-secondary">{row.operatorText}</p>
        ) : editing ? (
          <div className="flex flex-wrap gap-2.5">
            {editing.rooms[room.roomType][room.roomIndex].map((name, slot) => {
              const operator = row?.operators.find((item) => item.name === name) ?? (name ? { name } : undefined)
              const locked = editing.lockedOperators.has(name)
              return (
                <button key={slot} type="button" disabled={locked}
                  aria-label={`${copy.domain.manual_schedule.edit_room(`${room.label} ${room.indexLabel}`)} · ${name || copy.domain.manual_schedule.empty_slot(slot + 1)}`}
                  title={locked ? copy.domain.manual_schedule.lock_operator : undefined}
                  className="relative rounded-md p-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={() => editing.onEditRoom(room, slot)}>
                  <OperatorAvatarTile key={name || slot} operator={operator} placeholder={copy.domain.manual_schedule.empty_slot(slot + 1)} large showFullNames buttonChild />
                  {locked && <LockKeyhole size={14} className="absolute right-0 top-0 rounded-sm bg-surface-1 text-warning" aria-label={copy.domain.manual_schedule.lock_operator} />}
                </button>
              )
            })}
          </div>
        ) : row ? (
          <OperatorAvatarStrip operators={row.operators} fallbackText={row.operatorText} large showFullNames />
        ) : (
          <p className="rounded-md border border-dashed border-surface-3 p-3 text-sm leading-6 text-ink-muted">{label.empty_room}</p>
        )}
      </div>
      {!editing && row && !row.isAutofill && !['processing', 'dormitory'].includes(room.roomType) && row.detailItems.length > 0 && (
        <details className="mt-3 border-t border-surface-3/60 pt-2">
          <summary className="min-h-6 cursor-pointer text-xs leading-6 text-ink-muted hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45">{label.details}</summary>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-secondary">
            {row.detailItems.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </details>
      )}
    </article>
  )
}
