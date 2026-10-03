import { useId, useState, type KeyboardEvent } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, BedDouble, Building2, Clock3, Drone, Factory, GraduationCap, HandCoins, LayoutGrid, List, UserRoundSearch, Users, Wrench, Zap, type LucideIcon } from 'lucide-react'
import { copy } from '../../copy'
import { prepareResult, formatAmount } from '../../components/result-panel/formatters'
import { buildBoardV2Rooms, type BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { isDroneTarget } from '../../components/result-panel/DroneMarker'
import ProductIcon from '../../components/ProductIcon'
import { AnimatedValue, MotionNavIndicator, motionTokens } from '../../components/MotionPrimitives'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import V2Transition from './V2Transition'

const text = copy.v2
const ROOM_ORDER = ['trading', 'manufacture', 'control', 'power', 'meeting', 'processing', 'hire', 'training', 'dormitory']
const ROOM_ICONS: Record<string, LucideIcon> = {
  trading: HandCoins, manufacture: Factory, control: Building2, power: Zap,
  meeting: Users, processing: Wrench, hire: UserRoundSearch, training: GraduationCap, dormitory: BedDouble,
}

export function Avatar({ operator, small = false }: { operator: { id?: string; name: string }; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`v2-avatar ${small ? 'v2-avatar-small' : ''}`} title={operator.name}>
      {operator.id && !failed
        ? <img src={`/webp96/${operator.id}.webp`} alt={operator.name} onError={() => setFailed(true)} loading="lazy" width={96} height={96} />
        : <span aria-label={operator.name}>{operator.name.slice(0, 1)}</span>}
    </span>
  )
}

export default function ScheduleBoard({ result, operators, expanded, shift, onShiftChange, view, onViewChange, onRoom }: {
  result: OptimizeResult
  operators: LicenseOperator[]
  expanded: boolean
  shift: number
  onShiftChange: (shift: number) => void
  view: 'grid' | 'list'
  onViewChange: (view: 'grid' | 'list') => void
  onRoom: (room: BoardRoom) => void
}) {
  const id = useId()
  const selected = Math.min(shift, Math.max(result.plans.length - 1, 0))
  const prepared = prepareResult(result, result.schedule_mode === 'rotation', result.dormitory_rule === 'maa_pure_autofill', operators)
  const plan = prepared.plans[selected]
  const allRooms = buildBoardV2Rooms(plan, result.schedule_mode === 'rotation')
    .map((room) => room.roomType === 'training' ? { ...room, label: copy.domain.building_skills.training } : room)
    .sort((a, b) => {
      const aRank = ROOM_ORDER.indexOf(a.roomType)
      const bRank = ROOM_ORDER.indexOf(b.roomType)
      return (aRank < 0 ? ROOM_ORDER.length : aRank) - (bRank < 0 ? ROOM_ORDER.length : bRank)
    })
  const roomGroups = [
    { label: text.productionRooms, compact: false, rooms: allRooms.filter((room) => ['trading', 'manufacture'].includes(room.roomType)) },
    { label: text.controlAndPower, compact: !expanded, rooms: allRooms.filter((room) => ['control', 'power'].includes(room.roomType)) },
    { label: text.supportAndDormitories, compact: !expanded, rooms: allRooms.filter((room) => !['trading', 'manufacture', 'control', 'power'].includes(room.roomType)) },
  ]
  const count = new Set(plan?.rows.flatMap((row) => row.operators.map((operator) => operator.name))).size
  const hours = result.shift_hours ?? result.plans.map((plan) => plan.shift_hours ?? 8)

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = result.plans.length
    const next = event.key === 'ArrowRight' ? (index + 1) % count
      : event.key === 'ArrowLeft' ? (index - 1 + count) % count
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
    if (next === null) return
    event.preventDefault()
    onShiftChange(next)
    document.getElementById(`${id}-tab-${next}`)?.focus({ preventScroll: true })
  }

  return (
    <LayoutGroup id={id}>
    <section className="v2-panel v2-schedule">
      <div className="v2-panel-heading">
        <div className="v2-heading-inline"><h2>{expanded ? text.allRooms : text.result}</h2><span className="v2-neutral-tag">{text.shifts(result.plans.length)}</span></div>
        <div className="v2-view-toggle" role="group" aria-label={text.result}>
          <button type="button" aria-label={text.grid} aria-pressed={view === 'grid'} onClick={() => onViewChange('grid')}>
            {view === 'grid' && <MotionNavIndicator layoutId="board-view" />}<LayoutGrid size={16} />
          </button>
          <button type="button" aria-label={text.list} aria-pressed={view === 'list'} onClick={() => onViewChange('list')}>
            {view === 'list' && <MotionNavIndicator layoutId="board-view" />}<List size={17} />
          </button>
        </div>
      </div>
      <div className="v2-shifts" role="tablist" aria-label={text.shiftTabs}>
        {result.plans.map((plan, index) => {
          const start = hours.slice(0, index).reduce((sum, value) => sum + value, 0)
          return (
            <button type="button" role="tab" key={index} id={`${id}-tab-${index}`}
              aria-selected={selected === index} aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
              onClick={() => onShiftChange(index)} onKeyDown={(event) => moveTab(event, index)}>
              {selected === index && <MotionNavIndicator layoutId="shift" />}
              <span className="v2-shift-label">{plan.name || text.shift(index + 1)}{selected === index && <span className="v2-shift-dot" />}</span>
              <small>{String(start % 24).padStart(2, '0')}:00 — {String((start + hours[index]) % 24).padStart(2, '0')}:00</small>
            </button>
          )
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
        <V2Transition motionKey={String(selected)}>
        <div className="v2-board-meta"><span><Users size={14} />{text.assigned(count)}</span><span><Clock3 size={14} />{text.shiftHours(String(hours[selected] ?? 8))}</span></div>
        {roomGroups.filter((group) => group.rooms.length > 0).map((group) => (
          <section key={group.label} className="v2-room-group" aria-label={group.label}>
            <h3 className="v2-room-group-title">{group.label}</h3>
            <div className={`v2-room-grid ${view === 'list' ? 'v2-room-list' : ''}`}>
              {group.rooms.map((room) => <RoomCard key={room.key} room={room} compact={group.compact} onClick={() => onRoom(room)}
                autofill={room.roomType === 'dormitory' && Boolean(plan?.rooms.dormitory?.[room.roomIndex]?.autofill)}
                drone={isDroneTarget(plan?.drones, room.roomType, room.roomIndex)} />)}
            </div>
          </section>
        ))}
        </V2Transition>
      </div>
    </section>
    </LayoutGroup>
  )
}

function RoomCard({ room, drone = false, compact = false, autofill = false, onClick }: { room: BoardRoom; drone?: boolean; compact?: boolean; autofill?: boolean; onClick: () => void }) {
  const reduceMotion = useReducedMotion()
  const Icon = ROOM_ICONS[room.roomType] ?? Building2
  const automaticDormitory = autofill || room.row?.isAutofill
  const efficiency = room.row && room.row.efficiency !== '-' && ['trading', 'manufacture', 'power'].includes(room.roomType) ? room.row.efficiency : null
  const showBottom = !compact || room.product !== '-' || Boolean(efficiency)
  return (
    <motion.button type="button" className={`v2-room-card v2-room-${room.roomType} ${compact ? 'v2-room-card-compact' : ''}`} onClick={onClick}
      layout={reduceMotion ? false : 'position'} whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }} transition={motionTokens.spring}>
      <motion.div layout={reduceMotion ? false : 'position'} className="v2-room-header">
        <span className="v2-room-icon"><Icon size={16} /></span>
        <span className="v2-room-title">{room.label}<small>{room.indexLabel}</small></span>
        {drone && <span className="v2-drone-tag" title={text.drones}><Drone size={14} /></span>}
        <ArrowUpRight size={14} className="v2-room-arrow" />
      </motion.div>
      <motion.div layout={reduceMotion ? false : 'position'} className="v2-room-operators">
        {room.row?.operators.map((operator) => (
          <span className="v2-operator" key={operator.name}><Avatar operator={operator} small={compact} /><span>{operator.name}</span></span>
        ))}
        {automaticDormitory && <span className="v2-muted">{room.row?.isAutofill ? room.row.operatorText : copy.domain.components_result_panel_formatters_005}</span>}
        {!room.row?.operators.length && !automaticDormitory && <span className="v2-muted">{copy.domain.result_board_v2.empty_room}</span>}
      </motion.div>
      {showBottom && <motion.div layout={reduceMotion ? false : 'position'} className="v2-room-bottom">
        {(!compact || room.product !== '-') && <span><ProductIcon product={room.product} size={18} />{room.product === '-' ? text.support : room.product}</span>}
        {efficiency && <span>{text.efficiency}<strong>{efficiency}</strong></span>}
      </motion.div>}
    </motion.button>
  )
}

export function OutputChart({ result }: { result: OptimizeResult }) {
  const reduceMotion = useReducedMotion()
  const output = result.daily_production?.trading?.LMD ?? 0
  const [hour, setHour] = useState<number | null>(null)
  const id = useId().replace(/:/g, '')
  return (
    <div className="v2-output-chart v2-output-chart-large">
      <div className="v2-chart-caption"><span>{text.outputChart}</span><strong><AnimatedValue value={formatAmount(output * (hour ?? 24) / 24)} /><small> / {hour ?? 24}h</small></strong></div>
      <svg viewBox="0 0 320 120" role="img" aria-label={text.chartDescription}>
        <defs><linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-v2-accent)" stopOpacity=".16" /><stop offset="100%" stopColor="var(--color-v2-accent)" stopOpacity="0" /></linearGradient></defs>
        {[20, 55, 90].map((y) => <line key={y} x1="4" y1={y} x2="316" y2={y} stroke="currentColor" strokeOpacity=".08" strokeDasharray="3 4" />)}
        <path d="M4 105 L316 14 L316 110 L4 110 Z" fill={`url(#fill-${id})`} />
        <motion.path d="M4 105 L316 14" fill="none" stroke="var(--color-v2-accent)" strokeWidth="2.5"
          initial={reduceMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: motionTokens.duration.page, ease: motionTokens.ease.enter }} />
        {[0, 4, 8, 12, 16, 20, 24].map((value) => <motion.circle key={value} cx={4 + value * 13} cy={105 - value * 91 / 24}
          initial={false} animate={{ r: hour === value ? 5 : 3 }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.instant }}
          fill="var(--color-v2-surface)" stroke="var(--color-v2-accent)" strokeWidth="2" />)}
      </svg>
      <div className="v2-chart-axis">{[0, 8, 16, 24].map((value) => <button key={value} type="button" onMouseEnter={() => setHour(value)} onMouseLeave={() => setHour(null)}
        onFocus={() => setHour(value)} onBlur={() => setHour(null)} aria-label={`${text.outputChart} ${value}h`}>{String(value).padStart(2, '0')}:00</button>)}</div>
      <p className="v2-chart-note">{text.chartDescription}</p>
    </div>
  )
}
