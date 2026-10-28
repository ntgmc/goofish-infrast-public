import { useState, type ReactNode } from 'react'
import {
  ControlRoomIcon, TradingStationIcon, ManufactureIcon, PowerPlantIcon, DormitoryIcon, MeetingRoomIcon,
  RecruitmentIcon, TrainingRoomIcon, DroneIcon, OperatorsIcon, TasksIcon, ShiftTimeIcon, ServiceStatusIcon,
  LmdIcon, ExperienceIcon, type LucideIcon,
} from '../../../components/icons'
import ProductIcon from '../../../components/ProductIcon'
import { copy } from '../../../copy'
import itemCatalog from '../../../data/skland-items.json'
import { SKLAND_PRODUCTION_SLOTS } from '../../../lib/facility-layout'
import type { SklandGame, SklandRoom } from '../../../lib/skland-game'
import './skland-game.css'

const text = copy.skland
const catalog: Record<string, { name: string; icon?: string }> = itemCatalog
const number = (value: number | null | undefined) => value == null ? text.unavailable : value.toLocaleString('zh-CN')
const date = (value: number | null | undefined) => value ? new Date(value * 1000).toLocaleString('zh-CN') : text.unavailable
const shortDate = (value: number | null | undefined) => value ? new Date(value * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : text.unavailable
const ratio = (value: { current: number; max?: number; total?: number } | null | undefined) => value ? `${number(value.current)} / ${number(value.max ?? value.total)}` : text.unavailable
const roomIcons: Record<SklandRoom['type'], LucideIcon> = {
  control: ControlRoomIcon, trading: TradingStationIcon, manufacture: ManufactureIcon, power: PowerPlantIcon,
  dormitory: DormitoryIcon, meeting: MeetingRoomIcon, hire: RecruitmentIcon, training: TrainingRoomIcon,
}
type Building = NonNullable<SklandGame['building']>

export function SklandOverview({ game, lmd, exp }: { game: SklandGame; lmd: number | null; exp: number | null }) {
  const player = game.player
  const control = game.building?.rooms.find((room) => room.type === 'control')
  return <div className="skland-game skland-overview">
    <section className="skland-profile">
      <div className="skland-profile-main">
        <span className="skland-eyebrow"><ControlRoomIcon size={16} aria-hidden="true" />{text.doctorProfile}</span>
        <div className="skland-profile-name"><h2>{player.name ?? text.name}</h2>{player.level != null && <span className="skland-level">Lv.{player.level}</span>}</div>
        <dl className="skland-profile-details"><div><dt>{text.mainStage}</dt><dd>{player.mainStage ?? text.unavailable}</dd></div><div><dt>{text.lastOnline}</dt><dd>{date(player.lastOnline)}</dd></div></dl>
      </div>
      {control && control.operators.length > 0 && <div className="skland-command-team"><h3>{text.roomTypes.control}</h3><ul className="skland-residents">{control.operators.map((operator) => <Resident key={operator.id} operator={operator} />)}</ul></div>}
      <dl className="skland-collection">{([[text.operators, player.operators], [text.skins, player.skins], [text.furniture, player.furniture], [text.tired, game.building?.tired]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{number(count)}</dd></div>)}</dl>
      {player.dataAt != null && player.dataAt > 0 && <p className="skland-profile-time">{text.sourceTime(date(player.dataAt))}</p>}
    </section>
    <div className="skland-resource-grid">
      <Resource label={text.sanity} icon={ServiceStatusIcon} value={ratio(player.sanity)} current={player.sanity?.current} max={player.sanity?.max} tone="trading">
        {player.sanity?.completeAt ? <span>{text.recovery} {date(player.sanity.completeAt)}</span> : null}
      </Resource>
      <Resource label={text.drones} icon={DroneIcon} value={ratio(game.building?.drones)} current={game.building?.drones?.current} max={game.building?.drones?.max} tone="power" />
      <Resource label={text.lmd} icon={LmdIcon} value={number(lmd)} product="LMD" tone="manufacture" />
      <Resource label={text.exp} icon={ExperienceIcon} value={number(exp)} product="Battle Record" tone="manufacture" />
    </div>
    <section className="skland-panel">
      <PanelHeading icon={TasksIcon} title={text.progress} />
      <div className="skland-progress-grid">{([
        [text.daily, game.routine.daily], [text.weekly, game.routine.weekly], [text.campaign, game.campaign],
        [text.towerHigher, game.tower?.higher], [text.towerLower, game.tower?.lower],
      ] as const).map(([label, progress]) => <div className="skland-progress-item" key={label}><div><h3>{label}</h3><strong>{ratio(progress)}</strong></div><Meter label={label} current={progress?.current} max={progress?.total} /></div>)}</div>
    </section>
    <section className="skland-panel">
      <PanelHeading icon={RecruitmentIcon} title={text.recruitment} />
      {game.recruit ? <ol className="skland-recruit-grid">{game.recruit.map((slot, index) => {
        const state = slot.state === 2 && slot.finishAt && game.currentTs && slot.finishAt <= game.currentTs ? 3 : slot.state
        return <li key={index} className="skland-recruit-slot" data-ready={state === 3} data-locked={state === 0}>
          <span className="skland-recruit-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <RecruitmentIcon size={28} aria-hidden="true" /><h3>{text.recruitSlot(index)}</h3>
          <strong>{text.recruitStates[state] ?? text.unavailable}</strong>
          {slot.finishAt != null && slot.finishAt > 0 && <p><ShiftTimeIcon size={14} aria-hidden="true" />{text.completion}<br />{date(slot.finishAt)}</p>}
        </li>
      })}</ol> : <p className="skland-empty">{text.unavailable}</p>}
    </section>
  </div>
}

export function SklandInfrastructure({ building }: { building: Building }) {
  const productionTypes: SklandRoom['type'][] = ['trading', 'manufacture', 'power']
  const production = building.rooms.filter((room) => productionTypes.includes(room.type))
    .sort((left, right) => productionTypes.indexOf(left.type) - productionTypes.indexOf(right.type)
      || SKLAND_PRODUCTION_SLOTS.indexOf(left.id) - SKLAND_PRODUCTION_SLOTS.indexOf(right.id))
  const control = building.rooms.filter((room) => room.type === 'control')
  const support = building.rooms.filter((room) => ['meeting', 'hire', 'training'].includes(room.type))
  const dormitories = building.rooms.filter((room) => room.type === 'dormitory')
  const label = (room: SklandRoom) => {
    const peers = building.rooms.filter((entry) => entry.type === room.type)
      .sort((left, right) => SKLAND_PRODUCTION_SLOTS.indexOf(left.id) - SKLAND_PRODUCTION_SLOTS.indexOf(right.id))
    return `${text.roomTypes[room.type]}${peers.length > 1 ? ` ${peers.findIndex((entry) => entry.id === room.id) + 1}` : ''}`
  }
  return <section className="skland-game skland-infrastructure" aria-label={text.infrastructure}>
    <dl className="skland-base-status">
      <div><dt><DroneIcon size={16} aria-hidden="true" />{text.drones}</dt><dd>{ratio(building.drones)}</dd></div>
      <div data-tired={Boolean(building.tired)}><dt><OperatorsIcon size={16} aria-hidden="true" />{text.tired}</dt><dd>{number(building.tired)}</dd></div>
    </dl>
    <div className="skland-base-map">
      {(control.length > 0 || production.length > 0) && <section className="skland-base-production" aria-label={text.productionRooms}>
        {control.map((room) => <Room key={room.id} room={room} building={building} label={label(room)} />)}
        {production.map((room) => <Room key={room.id} room={room} building={building} label={label(room)} />)}
      </section>}
      {(support.length > 0 || dormitories.length > 0) && <section className="skland-base-support" aria-label={text.supportRooms}>
        {support.map((room) => <Room key={room.id} room={room} building={building} label={label(room)} />)}
        {dormitories.map((room) => <Room key={room.id} room={room} building={building} label={label(room)} />)}
      </section>}
    </div>
  </section>
}

function PanelHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return <div className="skland-panel-heading"><Icon size={20} aria-hidden="true" /><h2>{title}</h2></div>
}

function Resource({ label, icon: Icon, value, current, max, tone, product, children }: {
  label: string; icon: LucideIcon; value: string; current?: number | null; max?: number; tone: string; product?: string; children?: ReactNode
}) {
  return <div className="skland-resource" data-tone={tone}>
    <div className="skland-resource-icon">{product ? <ProductIcon product={product} size={36} /> : <Icon size={26} aria-hidden="true" />}</div>
    <dl><dt>{label}</dt><dd>{value}</dd></dl>
    <Meter label={label} current={current} max={max} />{children && <p>{children}</p>}
  </div>
}

function Meter({ label, current, max }: { label: string; current?: number | null; max?: number | null }) {
  return current != null && max != null && max > 0 ? <progress className="skland-meter" aria-label={label} value={current} max={max} /> : null
}

function Resident({ operator, role, overlay = false }: { operator: SklandRoom['operators'][number]; role?: string; overlay?: boolean }) {
  const [failed, setFailed] = useState(false)
  const morale = operator.morale == null ? null : Math.round(operator.morale * 10) / 10
  const moraleLabel = `${text.morale} ${morale == null ? text.moraleUnavailable : `${morale} / 24`}`
  return <li className="skland-resident" data-overlay={overlay} data-tired={morale != null && morale <= 4}>
    <span className="skland-portrait-frame">
      <span className="skland-portrait" aria-hidden="true">{!failed ? <img src={`/webp96/${encodeURIComponent(operator.id)}.webp`} alt="" width={96} height={96} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span>{operator.name.slice(0, 1)}</span>}</span>
      {overlay && <span className="skland-morale-overlay" aria-label={moraleLabel} title={morale == null ? text.unavailable : moraleLabel}><ServiceStatusIcon size={12} aria-hidden="true" /><b>{morale ?? '—'}</b></span>}
    </span>
    <div className="skland-resident-name">{role && <small>{role}</small>}<strong>{operator.name}</strong></div>
    {!overlay && <><span className="skland-morale" title={morale == null ? text.unavailable : undefined}>{text.morale} <b>{morale == null ? text.moraleUnavailable : `${morale} / 24`}</b></span><Meter label={`${operator.name} · ${text.morale}`} current={operator.morale} max={24} /></>}
  </li>
}

function Room({ room, building, label }: { room: SklandRoom; building: Building; label: string }) {
  const position = SKLAND_PRODUCTION_SLOTS.indexOf(room.id)
  const Icon = roomIcons[room.type]
  const production = room.type === 'manufacture' || room.type === 'trading'
  const productIcon = production ? Object.values(catalog).find((item) => item.name === room.product)?.icon : undefined
  const clues = room.type === 'meeting' ? building.clues : null
  const training = room.type === 'training' ? building.training : null
  return <article className="skland-room" data-tone={room.type} aria-label={label}>
    <Icon className="skland-room-watermark" size={120} strokeWidth={1} aria-hidden="true" />
    <header className="skland-room-heading">
      <div className="skland-room-identity"><h3>{label}</h3><span className="skland-room-level" role="img" aria-label={`${text.level} ${room.level}`} title={`Lv.${room.level}`}>{Array.from({ length: room.level }, (_, index) => <i key={index} aria-hidden="true" />)}</span></div>
      {production && <span className="skland-room-product">{productIcon && <img src={`/item-icons/${encodeURIComponent(productIcon)}.png`} alt="" width={22} height={22} loading="lazy" decoding="async" />}<strong title={room.product == null ? text.unavailable : undefined}>{room.product ?? '—'}</strong></span>}
      {room.comfort != null && <span className="skland-room-comfort">{text.comfort} <b>{number(room.comfort)}</b></span>}
    </header>
    {room.operators.length ? <ul className="skland-residents" aria-label={text.residents}>{room.operators.map((operator) => <Resident key={operator.id} operator={operator} overlay
      role={training ? operator.name === training.trainee ? text.trainee : operator.name === training.trainer ? text.trainer : undefined : undefined} />)}</ul>
      : <p className="skland-room-empty">{text.noResidents}</p>}
    {(production || clues || training || position >= 0) && <footer className="skland-room-footer">
      {production && <><span>{text.stock} <b>{room.stock == null ? '—' : number(room.stock)} / {room.capacity == null ? '—' : number(room.capacity)}</b></span><span>{text.completion} <time dateTime={room.completeAt ? new Date(room.completeAt * 1000).toISOString() : undefined} title={date(room.completeAt)}>{room.completeAt ? shortDate(room.completeAt) : '—'}</time></span></>}
      {clues && <><span>{text.clueBoard} <b>{clues.board == null ? '—' : `${number(clues.board)} / 7`}</b></span><span>{text.clueOwned} <b>{clues.owned == null ? '—' : number(clues.owned)}</b></span><span>{text.clueReceived} <b>{clues.received == null ? '—' : number(clues.received)}</b></span><span>{clues.sharing ? `${text.sharing} · ${shortDate(clues.shareCompleteAt)}` : clues.sharing == null ? text.unavailable : text.notSharing}</span></>}
      {training && <span>{text.remaining} <b>{training.remaining == null ? '—' : text.minutes(Math.ceil(training.remaining / 60))}</b></span>}
      {position >= 0 && <span className="skland-room-position">B{Math.floor(position / 3) + 1} · {copy.common.facilityLayoutColumns[position % 3]}</span>}
    </footer>}
  </article>
}
