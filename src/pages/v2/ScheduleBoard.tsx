import { memo, useId, useRef, useState, type KeyboardEvent, type ComponentType } from 'react'
import { AnimatePresence, LayoutGroup, motion, useIsPresent } from 'motion/react'
import { OpenDetailsIcon as ArrowUpRight, DormitoryIcon as BedDouble, ControlRoomIcon as Building2, ShiftTimeIcon as Clock3, DroneIcon as Drone, ManufactureIcon as Factory, TrainingRoomIcon as GraduationCap, GridViewIcon as LayoutGrid, ListViewIcon as List, RecruitmentIcon as UserRoundSearch, MeetingRoomIcon, OperatorsIcon as Users, ProcessingRoomIcon as Wrench, PowerPlantIcon as Zap, RecyclingStationIcon, UnknownFacilityIcon } from '../../components/icons'
import { copy } from '../../copy'
import type { PreparedResult } from '../../components/result-panel/formatters'
import OperatorSkillPreview from '../../components/result-panel/OperatorSkillPreview'
import type { RoomOperator } from '../../components/result-panel/types'
import { buildBoardV2Rooms, type BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { isDroneTarget } from '../../components/result-panel/DroneMarker'
import ProductIcon from '../../components/ProductIcon'
import { AnimatedValue, MotionNavIndicator, motionTokens } from '../../components/MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'
import type { OptimizeResult } from '../../lib/types'
import TradingIcon from './TradingIcon'
import SharedCardDialog from '../../components/ui/shared-card-dialog'
import { DialogDescription, DialogTitle } from '../../components/ui/dialog'
import BuildingSkills from './BuildingSkills'
import { RoomProduction } from './IncomeAnalysis'

const text = copy.v2
const ROOM_ORDER = ['trading', 'manufacture', 'control', 'power', 'meeting', 'processing', 'hire', 'training', 'dormitory']
const MAXIMUM_LEVELS: Record<string, number> = { trading: 3, manufacture: 3, power: 3, control: 5, dormitory: 5, meeting: 3, processing: 3, hire: 3, training: 3 }
const ROOM_ICONS: Record<string, ComponentType<{size?: number}>> = {
  trading: TradingIcon, manufacture: Factory, control: Building2, power: Zap,
  meeting: MeetingRoomIcon, processing: Wrench, hire: UserRoundSearch, training: GraduationCap, recycling: RecyclingStationIcon, dormitory: BedDouble,
}

export function roomLevelLabel(room: BoardRoom) {
  const maximum = MAXIMUM_LEVELS[room.roomType]
  const level = room.level
  return level === undefined ? text.unknownLevel : level === maximum ? text.maxLevel : `Lv.${level}`
}

export function Avatar({ operator, small = false }: { operator: RoomOperator; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`v2-avatar ${small ? 'v2-avatar-small' : ''}`}>
      {operator.id && !failed
        ? <img src={`/webp96/${operator.id}.webp`} alt={operator.name} onError={() => setFailed(true)} loading="lazy" decoding="async" width={96} height={96} />
        : <span aria-label={operator.name}>{operator.name.slice(0, 1)}</span>}
    </span>
  )
}

export default memo(function ScheduleBoard({ result, prepared, expanded, onExpandedChange, shift, onShiftChange, view, onViewChange, showProduction }: {
  result: OptimizeResult
  prepared: PreparedResult
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  shift: number
  onShiftChange: (shift: number) => void
  view: 'grid' | 'list'
  onViewChange: (view: 'grid' | 'list') => void
  showProduction: boolean
}) {
  const id = useId()
  const reduced = useAppReducedMotion()
  const [roomKey, setRoomKey] = useState<string | null>(null)
  const selected = Math.min(shift, Math.max(result.plans.length - 1, 0))
  const [transition, setTransition] = useState({ shift: selected, direction: 0 })
  if (transition.shift !== selected) setTransition({ shift: selected, direction: selected > transition.shift ? 1 : -1 })
  const layoutKey = `${view}-${expanded}`
  const plan = prepared.plans[selected]
  const fiammettaTarget = result.schedule_mode !== 'rotation' && plan?.Fiammetta?.enable ? plan.Fiammetta.target?.trim() : ''
  const allRooms = buildBoardV2Rooms(plan, result.schedule_mode === 'rotation')
    .map((room) => ({ ...room, level: room.level ?? (String(result.buildingType).endsWith('3') ? MAXIMUM_LEVELS[room.roomType] : undefined) }))
    .map((room) => ({ ...room, indexLabel: [plan?.rooms[room.roomType]?.length > 1 ? String(room.roomIndex + 1) : '', roomLevelLabel(room)].filter(Boolean).join(' · ') }))
    .map((room) => room.roomType === 'training' ? { ...room, label: copy.domain.building_skills.training } : room)
    .sort((a, b) => {
      const aRank = ROOM_ORDER.indexOf(a.roomType)
      const bRank = ROOM_ORDER.indexOf(b.roomType)
      return (aRank < 0 ? ROOM_ORDER.length : aRank) - (bRank < 0 ? ROOM_ORDER.length : bRank)
    })
  const openedRoom = allRooms.find((room) => room.key === roomKey)
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
    <section className="v2-schedule" aria-label={text.result}>
      <div className="v2-panel-heading">
        <span className="v2-schedule-count">{text.shifts(result.plans.length)}</span>
        <div className="v2-board-controls">
        <button type="button" className="v2-text-button" aria-pressed={expanded} aria-controls={`${id}-panel`} onClick={() => onExpandedChange(!expanded)}>
          {expanded ? text.compactRooms : text.expandRooms}
        </button>
        <div className="v2-view-toggle" role="group" aria-label={text.result}>
          <button type="button" aria-label={text.grid} aria-pressed={view === 'grid'} onClick={() => onViewChange('grid')}>
            {view === 'grid' && <MotionNavIndicator layoutId="board-view" />}<LayoutGrid size={16} />
          </button>
          <button type="button" aria-label={text.list} aria-pressed={view === 'list'} onClick={() => onViewChange('list')}>
            {view === 'list' && <MotionNavIndicator layoutId="board-view" />}<List size={17} />
          </button>
        </div>
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
        <div className="v2-transition-pane">
        <div className="v2-board-meta"><span><Users size={14} />{text.assigned(count)}</span><span><Clock3 size={14} />{text.shiftHours(String(hours[selected] ?? 8))}</span>
          {fiammettaTarget && <span>{copy.domain.components_result_panel_ResultBoard_017}{fiammettaTarget}</span>}
        </div>
        {roomGroups.filter((group) => group.rooms.length > 0).map((group) => (
          <section key={group.label} className="v2-room-group" aria-label={group.label}>
            <h3 className="v2-room-group-title">{group.label}</h3>
            <div className={`v2-room-grid ${view === 'list' ? 'v2-room-list' : ''}`}>
              {group.rooms.map((room) => <RoomCard key={room.key} room={room} layoutKey={layoutKey} compact={group.compact} direction={transition.direction} selectedKey={roomKey} onClick={() => setRoomKey(room.key)}
                autofill={room.roomType === 'dormitory' && Boolean(plan?.rooms.dormitory?.[room.roomIndex]?.autofill)}
                drone={isDroneTarget(plan?.drones, room.roomType, room.roomIndex)} />)}
            </div>
          </section>
        ))}
        </div>
      </div>
    </section>
    {openedRoom && <SharedCardDialog key={openedRoom.key} layoutId={`room-${openedRoom.key}`} onClose={() => setRoomKey(null)} closeLabel={text.close} className={`v2-room-detail v2-room-${openedRoom.roomType}`}>
      <header className="v2-room-detail-heading">
        <motion.span className="v2-room-icon" layoutId={reduced ? undefined : `room-icon-${openedRoom.key}`} transition={motionTokens.morph}><FacilityIcon room={openedRoom} /></motion.span>
        <div><DialogTitle asChild><motion.h2 layoutId={reduced ? undefined : `room-title-${openedRoom.key}`} transition={motionTokens.morph}>{openedRoom.label}<small>{openedRoom.indexLabel}</small></motion.h2></DialogTitle>
          <DialogDescription>{text.roomDescription(result.plans[selected]?.name || text.shift(selected + 1), hours[selected] ?? 8)}</DialogDescription></div>
      </header>
      <motion.div initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.18 }}>
        <RoomDetails room={openedRoom} result={result} shift={selected} showProduction={showProduction} />
      </motion.div>
    </SharedCardDialog>}
    </LayoutGroup></OperatorSkillPreview>
  )
})

function FacilityIcon({ room }: { room: BoardRoom }) {
  const Icon = ROOM_ICONS[room.roomType] ?? UnknownFacilityIcon
  return <Icon size={16} />
}

function RoomCard({ room, layoutKey, direction, selectedKey, drone = false, compact = false, autofill = false, onClick }: { room: BoardRoom; layoutKey: string; direction: number; selectedKey: string | null; drone?: boolean; compact?: boolean; autofill?: boolean; onClick: () => void }) {
  const reduceMotion = useAppReducedMotion()
  const layout = reduceMotion ? false : 'position'
  const geometryTransition = { duration: 0.28, ease: motionTokens.ease.enter }
  const automaticDormitory = autofill || room.row?.isAutofill
  const efficiency = room.row && room.row.efficiency !== '-' && ['trading', 'manufacture', 'power'].includes(room.roomType) ? room.row.efficiency : null
  const showBottom = !compact || room.product !== '-' || Boolean(efficiency)
  return (
    <motion.button type="button" className={`v2-room-card v2-room-${room.roomType} ${compact ? 'v2-room-card-compact' : ''}`} onClick={onClick}
      aria-haspopup="dialog" layout={!reduceMotion} layoutId={reduceMotion ? undefined : `room-${room.key}`} style={{ borderRadius: 6 }} layoutDependency={`${layoutKey}-${selectedKey}`} transition={motionTokens.morph}>
      <motion.div layout={layout} layoutDependency={layoutKey} transition={geometryTransition} className="v2-room-header">
        <motion.span className="v2-room-icon" layoutId={reduceMotion ? undefined : `room-icon-${room.key}`} transition={motionTokens.morph}><FacilityIcon room={room} /></motion.span>
        <motion.span className="v2-room-title" layoutId={reduceMotion ? undefined : `room-title-${room.key}`} transition={motionTokens.morph}><span>{room.label}</span><small>{room.indexLabel}</small></motion.span>
      </motion.div>
      <span className="v2-room-marker">
        {drone && <span className="v2-drone-tag" title={text.drones}><Drone size={16} /></span>}
        <ArrowUpRight size={14} className="v2-room-arrow" />
      </span>
      <motion.div layout={layout} layoutDependency={layoutKey} transition={geometryTransition} className="v2-room-operators">
        {room.row?.operators.map((operator, index) => (
          <span className="v2-operator" key={index} data-operator-name={operator.name}
            data-operator-id={operator.id} data-operator-elite={operator.elite} data-operator-level={operator.level}>
            {reduceMotion ? <OperatorOccupant operator={operator} compact={compact} direction={0} reducedMotion /> : <AnimatePresence initial={false} mode="sync" custom={direction}>
              <OperatorOccupant key={operator.name} operator={operator} compact={compact} direction={direction} reducedMotion={false} />
            </AnimatePresence>}
          </span>
        ))}
        {automaticDormitory && <span className="v2-muted">{room.row?.isAutofill ? room.row.operatorText : copy.domain.components_result_panel_formatters_005}</span>}
        {!room.row?.operators.length && !automaticDormitory && <span className="v2-muted">{copy.domain.result_board_v2.empty_room}</span>}
      </motion.div>
      {showBottom && <motion.div layout={layout} layoutDependency={layoutKey} transition={geometryTransition} className="v2-room-bottom">
        {(!compact || room.product !== '-') && <span><ProductIcon product={room.product} size={18} />{room.product === '-' ? text.support : room.product}</span>}
        {efficiency && <span className="v2-room-efficiency"><span>{room.roomType === 'trading' ? text.equivalentEfficiency : text.efficiency}</span><strong><AnimatedValue value={efficiency} /></strong></span>}
      </motion.div>}
    </motion.button>
  )
}

function RoomDetails({ room, result, shift, showProduction }: { room: BoardRoom; result: OptimizeResult; shift: number; showProduction: boolean }) {
  const maximum = result.plans[shift]?.mood_assumptions?.max_mood
  const maxMood = maximum !== undefined && Number.isFinite(maximum) && maximum > 0 ? maximum : 24
  return <div className="v2-room-detail-content">
    <dl className="v2-room-detail-stats">
      <div><dt>{text.product}</dt><dd><ProductIcon product={room.product} size={20} />{room.product === '-' ? text.support : room.product}</dd></div>
      {room.row && room.row.efficiency !== '-' && <div><dt>{room.roomType === 'trading' ? text.equivalentEfficiency : text.efficiency}</dt><dd>{room.row.efficiency}</dd></div>}
      {showProduction && result.daily_production && <RoomProduction daily={result.daily_production} room={room} shift={result.plans[shift]?.name} />}
    </dl>
    <section className="v2-room-operator-details" aria-label={text.roomOperators}>
      <h3>{text.roomOperators}</h3>
      {room.row?.operators.length ? room.row.operators.map((operator) => {
        const mood = room.data?.mood?.[operator.name]
        return <section className="v2-room-operator" key={operator.name} aria-label={operator.name}>
          <div className="v2-operator-row"><Avatar operator={operator} /><strong>{operator.name}</strong></div>
          <RoomMood start={mood?.start} end={mood?.end} maximum={maxMood} />
          <BuildingSkills operator={operator} />
        </section>
      }) : <p className="v2-muted">{room.row?.isAutofill || room.data?.autofill ? copy.domain.components_result_panel_formatters_005 : copy.domain.result_board_v2.empty_room}</p>}
    </section>
    {Boolean(room.row?.detailItems.length) && <details className="v2-room-calculation"><summary>{text.roomDetails}</summary>
      <ul className="v2-room-detail-list">{room.row?.detailItems.map((item, index) => <li key={item}>{room.roomType === 'trading'
        ? index === 0 ? `${text.equivalentEfficiency} ${room.row?.efficiency}`
          : item.startsWith(copy.domain.components_result_panel_formatters_023) ? `${text.expectedFullOrders}${room.data?.overflow?.time}` : item
        : item}</li>)}</ul>
    </details>}
  </div>
}

function RoomMood({ start, end, maximum }: { start?: number; end?: number; maximum: number }) {
  const known = start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end)
  const percent = (value: number) => Math.min(100, Math.max(0, value / maximum * 100))
  const value = (mood: number | undefined) => mood !== undefined && Number.isFinite(mood) ? mood.toFixed(1) : text.moodUnavailable
  const startPercent = known ? percent(start) : 0
  const endPercent = known ? percent(end) : 0
  return <div className="v2-room-mood" data-recovering={known && end > start || undefined} data-empty={known && end <= 0 || undefined}>
    <dl><div><dt>{text.startMood}</dt><dd>{value(start)}<span aria-hidden="true">→</span></dd></div>
      <div><dt>{text.endMood}</dt><dd>{value(end)}<small>/ {maximum}</small></dd></div></dl>
    {known && <div className="v2-mood-track" aria-hidden="true">
      <span className="v2-mood-level" style={{ width: `${endPercent}%` }} />
      <span className="v2-mood-change" style={{ left: `${Math.min(startPercent, endPercent)}%`, width: `${Math.abs(endPercent - startPercent)}%` }} />
      <span className="v2-mood-start" style={{ left: `${startPercent}%` }} />
    </div>}
  </div>
}

function OperatorOccupant({ operator, compact, direction, reducedMotion }: { operator: RoomOperator; compact: boolean; direction: number; reducedMotion: boolean }) {
  const present = useIsPresent()
  const changedShift = useRef(direction !== 0)
  return <motion.span className="v2-operator-content" data-shift-change={!reducedMotion && changedShift.current || undefined} aria-hidden={!present || undefined} inert={!present || undefined}
    initial={reducedMotion ? false : { opacity: 0, x: direction * 5 }} animate={{ opacity: 1, x: 0 }}
    variants={{ exit: (exitDirection: number) => ({ opacity: 0, x: exitDirection * -3, transition: { duration: motionTokens.duration.exit } }) }} exit="exit"
    transition={{ duration: reducedMotion ? 0 : motionTokens.duration.enter, ease: motionTokens.ease.enter }}>
    <Avatar key={operator.id ?? operator.name} operator={operator} small={compact} /><span className="v2-operator-name">{operator.name}</span>
  </motion.span>
}
