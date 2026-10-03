import { useId, useState, type KeyboardEvent } from 'react'
import { ArrowUpRight, Building2, Check, Clock3, Drone, Factory, LayoutGrid, List, Users, Zap } from 'lucide-react'
import { copy } from '../../copy'
import { prepareResult, formatAmount } from '../../components/result-panel/formatters'
import { buildBoardV2Rooms, type BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { isDroneTarget } from '../../components/result-panel/DroneMarker'
import ProductIcon from '../../components/ProductIcon'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'

const text = copy.v2

export function Avatar({ operator, small = false }: { operator: { id?: string; name: string }; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`v2-avatar ${small ? 'v2-avatar-small' : ''}`} title={operator.name}>
      {operator.id && !failed
        ? <img src={`/webp96/${operator.id}.webp`} alt={operator.name} onError={() => setFailed(true)} loading="lazy" />
        : <span aria-label={operator.name}>{operator.name.slice(0, 1)}</span>}
    </span>
  )
}

export default function ScheduleBoard({ result, operators, expanded, onRoom }: {
  result: OptimizeResult
  operators: LicenseOperator[]
  expanded: boolean
  onRoom: (room: BoardRoom) => void
}) {
  const [shift, setShift] = useState(0)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const id = useId()
  const selected = Math.min(shift, Math.max(result.plans.length - 1, 0))
  const prepared = prepareResult(result, result.schedule_mode === 'rotation', result.dormitory_rule === 'maa_pure_autofill', operators)
  const plan = prepared.plans[selected]
  const allRooms = buildBoardV2Rooms(plan, result.schedule_mode === 'rotation')
  const productionRooms = allRooms.filter((room) => ['trading', 'manufacture'].includes(room.roomType))
  const supportRooms = allRooms.filter((room) => !['trading', 'manufacture'].includes(room.roomType))
  const count = new Set(plan?.rows.flatMap((row) => row.operators.map((operator) => operator.name))).size
  const hours = result.shift_hours ?? result.plans.map((plan) => plan.shift_hours ?? 8)

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = result.plans.length
    const next = event.key === 'ArrowRight' ? (index + 1) % count
      : event.key === 'ArrowLeft' ? (index - 1 + count) % count
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
    if (next === null) return
    event.preventDefault()
    setShift(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  return (
    <section className="v2-panel v2-schedule">
      <div className="v2-panel-heading">
        <div className="v2-heading-inline"><h2>{expanded ? text.allRooms : text.result}</h2><span className="v2-neutral-tag">{text.shifts(result.plans.length)}</span></div>
        <div className="v2-view-toggle" role="group" aria-label={text.result}>
          <button type="button" aria-label={text.grid} aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={16} /></button>
          <button type="button" aria-label={text.list} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} /></button>
        </div>
      </div>
      <div className="v2-shifts" role="tablist" aria-label={text.shiftTabs}>
        {result.plans.map((plan, index) => {
          const start = hours.slice(0, index).reduce((sum, value) => sum + value, 0)
          return (
            <button type="button" role="tab" key={index} id={`${id}-tab-${index}`}
              aria-selected={selected === index} aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
              onClick={() => setShift(index)} onKeyDown={(event) => moveTab(event, index)}>
              <span>{plan.name || text.shift(index + 1)}{selected === index && <span className="v2-shift-dot" />}</span>
              <small>{String(start % 24).padStart(2, '0')}:00 — {String((start + hours[index]) % 24).padStart(2, '0')}:00</small>
            </button>
          )
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
        <div className="v2-board-meta"><span><Users size={14} />{text.assigned(count)}</span><span><Clock3 size={14} />{text.shiftHours(String(hours[selected] ?? 8))}</span></div>
        <div className={`v2-room-grid ${view === 'list' ? 'v2-room-list' : ''}`}>
          {productionRooms.map((room) => <RoomCard key={room.key} room={room} onClick={() => onRoom(room)}
            drone={isDroneTarget(plan?.drones, room.roomType, room.roomIndex)} />)}
        </div>
        {expanded ? (
          <div className={`v2-room-grid v2-support-rooms ${view === 'list' ? 'v2-room-list' : ''}`}>
            {supportRooms.map((room) => <RoomCard key={room.key} room={room} onClick={() => onRoom(room)} />)}
          </div>
        ) : (
          <div className="v2-support-strip">
            <Building2 size={17} />
            <span>{ROOM_LABELS.control}</span>
            <div className="v2-mini-avatars">{supportRooms.find((room) => room.roomType === 'control')?.row?.operators.map((operator) => <Avatar key={operator.name} operator={operator} small />)}</div>
            <span className="v2-power-count"><Zap size={14} />{allRooms.filter((room) => room.roomType === 'power').length}</span>
          </div>
        )}
        <div className="v2-board-footer"><Check size={14} /><span>{text.estimateNotice}</span></div>
      </div>
    </section>
  )
}

function RoomCard({ room, drone = false, onClick }: { room: BoardRoom; drone?: boolean; onClick: () => void }) {
  const trading = room.roomType === 'trading'
  const Icon = trading ? Building2 : room.roomType === 'power' ? Zap : Factory
  return (
    <button type="button" className={`v2-room-card ${trading ? 'v2-room-trade' : 'v2-room-manufacture'}`} onClick={onClick}>
      <div className="v2-room-header">
        <span className="v2-room-icon"><Icon size={16} /></span>
        <span className="v2-room-title">{room.label}<small>{room.indexLabel}</small></span>
        {drone && <span className="v2-drone-tag" title={text.drones}><Drone size={14} /></span>}
        <ArrowUpRight size={14} className="v2-room-arrow" />
      </div>
      <div className="v2-room-operators">
        {room.row?.operators.map((operator) => (
          <span className="v2-operator" key={operator.name}><Avatar operator={operator} /><span>{operator.name}</span></span>
        ))}
        {!room.row?.operators.length && <span className="v2-muted">{copy.domain.result_board_v2.empty_room}</span>}
      </div>
      <div className="v2-room-bottom">
        <span><ProductIcon product={room.product} size={18} />{room.product === '-' ? text.support : room.product}</span>
        {room.row && room.row.efficiency !== '-' && ['trading', 'manufacture', 'power'].includes(room.roomType)
          && <span>{text.efficiency}<strong>{room.row.efficiency}</strong></span>}
      </div>
    </button>
  )
}

export function OutputChart({ result, large = false }: { result: OptimizeResult; large?: boolean }) {
  const output = result.daily_production?.trading?.LMD ?? 0
  const [hour, setHour] = useState<number | null>(null)
  const id = useId().replace(/:/g, '')
  return (
    <div className={`v2-output-chart ${large ? 'v2-output-chart-large' : ''}`}>
      <div className="v2-chart-caption"><span>{text.outputChart}</span><strong>{formatAmount(output * (hour ?? 24) / 24)}<small> / {hour ?? 24}h</small></strong></div>
      <svg viewBox="0 0 320 120" role="img" aria-label={text.chartDescription}>
        <defs><linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#53aa8e" stopOpacity=".22" /><stop offset="100%" stopColor="#53aa8e" stopOpacity="0" /></linearGradient></defs>
        {[20, 55, 90].map((y) => <line key={y} x1="4" y1={y} x2="316" y2={y} stroke="currentColor" strokeOpacity=".08" strokeDasharray="3 4" />)}
        <path d="M4 105 L316 14 L316 110 L4 110 Z" fill={`url(#fill-${id})`} />
        <path d="M4 105 L316 14" fill="none" stroke="#38977a" strokeWidth="2.5" />
        {[0, 4, 8, 12, 16, 20, 24].map((value) => <circle key={value} cx={4 + value * 13} cy={105 - value * 91 / 24} r={hour === value ? 5 : 3}
          fill="#fff" stroke="#38977a" strokeWidth="2" />)}
      </svg>
      <div className="v2-chart-axis">{[0, 8, 16, 24].map((value) => <button key={value} type="button" onMouseEnter={() => setHour(value)} onMouseLeave={() => setHour(null)}
        onFocus={() => setHour(value)} onBlur={() => setHour(null)} aria-label={`${text.outputChart} ${value}h`}>{String(value).padStart(2, '0')}:00</button>)}</div>
      <p className="v2-chart-note">{text.chartDescription}</p>
    </div>
  )
}
