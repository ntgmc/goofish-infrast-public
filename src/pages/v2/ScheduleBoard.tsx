import { memo, useId, useState, type KeyboardEvent, type ComponentType } from 'react'
import { LayoutGroup } from 'motion/react'
import { ArrowUpRight, BedDouble, Building2, Clock3, Drone, Factory, GraduationCap, LayoutGrid, List, UserRoundSearch, Users, Wrench, Zap } from 'lucide-react'
import { copy } from '../../copy'
import type { PreparedResult } from '../../components/result-panel/formatters'
import OperatorSkillPreview from '../../components/result-panel/OperatorSkillPreview'
import type { RoomOperator } from '../../components/result-panel/types'
import { buildBoardV2Rooms, type BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { isDroneTarget } from '../../components/result-panel/DroneMarker'
import ProductIcon from '../../components/ProductIcon'
import { MotionNavIndicator } from '../../components/MotionPrimitives'
import type { OptimizeResult } from '../../lib/types'
import V2Transition from './V2Transition'
import TradingIcon from './TradingIcon'

const text = copy.v2
const ROOM_ORDER = ['trading', 'manufacture', 'control', 'power', 'meeting', 'processing', 'hire', 'training', 'dormitory']
const MAXIMUM_LEVELS: Record<string, number> = { trading: 3, manufacture: 3, power: 3, control: 5, dormitory: 5, meeting: 3, processing: 3, hire: 3, training: 3 }
const ROOM_ICONS: Record<string, ComponentType<{size?: number}>> = {
  trading: TradingIcon, manufacture: Factory, control: Building2, power: Zap,
  meeting: Users, processing: Wrench, hire: UserRoundSearch, training: GraduationCap, dormitory: BedDouble,
}

export function roomLevelLabel(room: BoardRoom) {
  const maximum = MAXIMUM_LEVELS[room.roomType]
  const level = room.level
  return level === undefined ? text.unknownLevel : level === maximum ? text.maxLevel : `Lv.${level}`
}

export function Avatar({ operator, small = false }: { operator: RoomOperator; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`v2-avatar ${small ? 'v2-avatar-small' : ''}`} data-operator-name={operator.name}
      data-operator-id={operator.id} data-operator-elite={operator.elite} data-operator-level={operator.level}>
      {operator.id && !failed
        ? <img src={`/webp96/${operator.id}.webp`} alt={operator.name} onError={() => setFailed(true)} loading="lazy" decoding="async" width={96} height={96} />
        : <span aria-label={operator.name}>{operator.name.slice(0, 1)}</span>}
    </span>
  )
}

export default memo(function ScheduleBoard({ result, prepared, expanded, shift, onShiftChange, view, onViewChange, onRoom }: {
  result: OptimizeResult
  prepared: PreparedResult
  expanded: boolean
  shift: number
  onShiftChange: (shift: number) => void
  view: 'grid' | 'list'
  onViewChange: (view: 'grid' | 'list') => void
  onRoom: (room: BoardRoom) => void
}) {
  const id = useId()
  const selected = Math.min(shift, Math.max(result.plans.length - 1, 0))
  const plan = prepared.plans[selected]
  const allRooms = buildBoardV2Rooms(plan, result.schedule_mode === 'rotation')
    .map((room) => ({ ...room, level: room.level ?? (String(result.buildingType).endsWith('3') ? MAXIMUM_LEVELS[room.roomType] : undefined) }))
    .map((room) => ({ ...room, indexLabel: [plan?.rooms[room.roomType]?.length > 1 ? String(room.roomIndex + 1) : '', roomLevelLabel(room)].filter(Boolean).join(' · ') }))
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
    <OperatorSkillPreview><LayoutGroup id={id}>
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
    </LayoutGroup></OperatorSkillPreview>
  )
})

function RoomCard({ room, drone = false, compact = false, autofill = false, onClick }: { room: BoardRoom; drone?: boolean; compact?: boolean; autofill?: boolean; onClick: () => void }) {
  const Icon = ROOM_ICONS[room.roomType] ?? Building2
  const automaticDormitory = autofill || room.row?.isAutofill
  const efficiency = room.row && room.row.efficiency !== '-' && ['trading', 'manufacture', 'power'].includes(room.roomType) ? room.row.efficiency : null
  const showBottom = !compact || room.product !== '-' || Boolean(efficiency)
  return (
    <button type="button" className={`v2-room-card v2-room-${room.roomType} ${compact ? 'v2-room-card-compact' : ''}`} onClick={onClick}>
      <div className="v2-room-header">
        <span className="v2-room-icon"><Icon size={16} /></span>
        <span className="v2-room-title">{room.label}<small>{room.indexLabel}</small></span>
      </div>
      <span className="v2-room-marker">
        {drone && <span className="v2-drone-tag" title={text.drones}><Drone size={16} /></span>}
        <ArrowUpRight size={14} className="v2-room-arrow" />
      </span>
      <div className="v2-room-operators">
        {room.row?.operators.map((operator) => (
          <span className="v2-operator" key={operator.name}><Avatar operator={operator} small={compact} /><span>{operator.name}</span></span>
        ))}
        {automaticDormitory && <span className="v2-muted">{room.row?.isAutofill ? room.row.operatorText : copy.domain.components_result_panel_formatters_005}</span>}
        {!room.row?.operators.length && !automaticDormitory && <span className="v2-muted">{copy.domain.result_board_v2.empty_room}</span>}
      </div>
      {showBottom && <div className="v2-room-bottom">
        {(!compact || room.product !== '-') && <span><ProductIcon product={room.product} size={18} />{room.product === '-' ? text.support : room.product}</span>}
        {efficiency && <span className="v2-room-efficiency"><span>{room.roomType === 'trading' ? text.equivalentEfficiency : text.efficiency}</span><strong>{efficiency}</strong></span>}
      </div>}
    </button>
  )
}
