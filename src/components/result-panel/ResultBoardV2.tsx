import { useId, useState, type KeyboardEvent } from 'react'
import { BedDouble, Building2, Factory, HandCoins, Users, Wrench, Zap, type LucideIcon } from 'lucide-react'
import { copy } from '../../copy/index'
import DroneSummary from './DroneSummary'
import { formatCompactNumber, formatProduct, type PreparedResult } from './formatters'
import { ROOM_LABELS } from './labels'
import OperatorAvatarStrip from './OperatorAvatarStrip'
import type { RoomRow } from './types'

const PRODUCTION_TYPES = ['control', 'trading', 'manufacture', 'power']
const ROOM_STYLES: Record<string, { icon: LucideIcon; tone: string }> = {
  control: { icon: Building2, tone: 'text-brand-400' },
  trading: { icon: HandCoins, tone: 'text-brand-400' },
  manufacture: { icon: Factory, tone: 'text-warning' },
  power: { icon: Zap, tone: 'text-success' },
  meeting: { icon: Users, tone: 'text-ink-secondary' },
  processing: { icon: Wrench, tone: 'text-ink-secondary' },
  dormitory: { icon: BedDouble, tone: 'text-success' },
}

type BoardRoom = {
  key: string;
  roomType: string;
  label: string;
  indexLabel: string;
  product: string;
  row?: RoomRow;
}

export default function ResultBoardV2({ prepared, isRotationMode, shiftHours }: {
  prepared: PreparedResult;
  isRotationMode: boolean;
  shiftHours?: number[];
}) {
  const id = useId()
  const [activePlan, setActivePlan] = useState(0)
  const selectedIndex = activePlan < prepared.plans.length ? activePlan : 0
  const plan = prepared.plans[selectedIndex]
  const rooms: BoardRoom[] = Object.entries(plan?.rooms ?? {}).flatMap(([roomType, entries]) => {
    if (!Array.isArray(entries) || (isRotationMode && roomType === 'dormitory')) return []
    const autofill = plan.rows.find((row) => row.roomType === roomType && row.isAutofill)
    return entries.flatMap((room, index) => {
      if (autofill && index > 0) return []
      const row = plan.rows.find((item) => item.roomType === roomType && item.roomIndex === index)
      return [{
        key: `${roomType}-${index}`,
        roomType,
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
    setActivePlan(nextIndex)
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
            <p className="mt-1 text-xs leading-5 text-ink-muted">{label.hint}</p>
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
                  onClick={() => setActivePlan(index)} onKeyDown={(event) => handleTabKeyDown(event, index)}
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
                        {group.map((room) => <RoomCard key={room.key} room={room} />)}
                      </div>
                    )
                  })}
                </section>
              )}
              {supportRooms.length > 0 && (
                <section className="min-w-0 space-y-3" aria-label={label.support}>
                  <h3 className="tool-eyebrow">{label.support}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {supportRooms.map((room) => <RoomCard key={room.key} room={room} className={room.roomType === 'dormitory' ? 'sm:col-span-2' : ''} />)}
                  </div>
                </section>
              )}
            </div>
          ) : <p className="tool-inset border-dashed p-5 text-sm text-ink-muted">{copy.domain.components_result_panel_ResultBoard_008}</p>}
          {plan.drones?.enable && <DroneSummary drones={plan.drones} />}
        </div>
      ) : <p className="p-5 text-sm text-ink-muted">{copy.domain.components_result_panel_ResultBoard_008}</p>}
    </section>
  )
}

function RoomCard({ room, className = '' }: { room: BoardRoom; className?: string }) {
  const { row } = room
  const { icon: Icon, tone } = ROOM_STYLES[room.roomType] ?? { icon: Building2, tone: 'text-ink-secondary' }
  const label = copy.domain.result_board_v2
  return (
    <article className={`tool-inset min-w-0 overflow-hidden p-3.5 sm:p-4 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-primary">
          <Icon size={16} className={`shrink-0 ${tone}`} aria-hidden="true" />
          {room.label}
          {room.indexLabel && <span className="text-xs font-medium text-ink-muted">{room.indexLabel}</span>}
        </h4>
        {room.product !== '-' && <span className={`text-xs font-medium ${tone}`}>{room.product}</span>}
      </header>
      {row && row.efficiency !== '-' && PRODUCTION_TYPES.includes(room.roomType) && room.roomType !== 'control' && (
        <p className={`mt-3 font-mono text-xl font-semibold ${tone}`}>
          {row.efficiency}<span className="ml-2 font-sans text-xs font-normal text-ink-muted">{label.efficiency}</span>
        </p>
      )}
      <div className="mt-3">
        {row?.isAutofill ? (
          <p className="rounded-md border border-dashed border-surface-3 p-3 text-sm leading-6 text-ink-secondary">{row.operatorText}</p>
        ) : row ? (
          <OperatorAvatarStrip operators={row.operators} fallbackText={row.operatorText} large showFullNames />
        ) : (
          <p className="rounded-md border border-dashed border-surface-3 p-3 text-sm leading-6 text-ink-muted">{label.empty_room}</p>
        )}
      </div>
      {row && !row.isAutofill && row.detailItems.length > 0 && (
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
