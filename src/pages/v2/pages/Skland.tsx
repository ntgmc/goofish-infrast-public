import { useEffect, useState } from 'react'
import { copy } from '../../../copy'
import { RefreshIcon, ConfigIcon } from '../../../components/icons'
import SklandIcon from '../../../components/SklandIcon'
import SklandBindingDialog from '../../../components/SklandBindingDialog'
import { Tabs } from '../../../components/ui/tabs'
import { useSklandSnapshot } from '../../../hooks/useSklandSnapshot'
import { sklandResourceState } from '../../../lib/skland-snapshot'
import { matchesSearch } from '../../../lib/search'
import { SKLAND_PRODUCTION_SLOTS } from '../../../lib/facility-layout'
import type { SklandGame, SklandRoom } from '../../../lib/skland-game'
import type { V2Session } from '../OptionsDrawer'
import { Facts, Notice } from '../components/WorkspaceUI'

const text = copy.skland
const number = (value: number | null | undefined) => value == null ? text.unavailable : value.toLocaleString('zh-CN')
const date = (value: number | null | undefined) => value ? new Date(value * 1000).toLocaleString('zh-CN') : text.unavailable
const ratio = (value: { current: number; max?: number; total?: number } | null | undefined) => value ? `${number(value.current)} / ${number(value.max ?? value.total)}` : text.unavailable

export default function Skland({ session, onOpenProfile, onProfiles, onConfig }: {
  session: V2Session
  onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>
  onProfiles: () => void
  onConfig: () => void
}) {
  const [tab, setTab] = useState('overview')
  const [binding, setBinding] = useState(false)
  const profile = session.activeProfile
  const snapshot = useSklandSnapshot(session.user?.id, profile, true, 'live')
  const data = snapshot.data
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const remaining = data?.retryAt ? Date.parse(data.retryAt) - Date.now() : 0
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [data?.retryAt])
  const game = data && ['fresh', 'stale'].includes(sklandResourceState(data.game.fetchedAt)) ? data.game.data : null
  const profiles = session.profiles.filter((entry) => entry.status === 'active' && !entry.archived_at)
  const rebind = !profile?.skland_binding || profile.skland_binding.credential_status === 'invalid'
  return <div className="space-y-5">
    <section className="v2-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {profiles.length > 0 ? <label className="v2-field min-w-0 w-full sm:w-auto sm:flex-1 sm:max-w-sm"><span>{text.profile}</span>
          <select className="v2-input" value={profile?.id ?? ''} disabled={Boolean(session.openingProfileId)} onChange={(event) => {
            const next = profiles.find((entry) => entry.id === event.currentTarget.value)
            if (next) void onOpenProfile(next)
          }}>{!profile && <option value="" disabled>{text.manageAccounts}</option>}{profiles.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select>
        </label> : <button type="button" className="v2-button v2-button-secondary" onClick={onProfiles}>{text.manageAccounts}</button>}
        <div className="v2-actions">
          {profile && rebind ? <button type="button" className="v2-button v2-button-primary" onClick={() => setBinding(true)}><SklandIcon />{text.bind}</button>
            : profile && <button type="button" className="v2-button v2-button-secondary" disabled={snapshot.busy || !snapshot.available || Boolean(data?.retryAt && Date.parse(data.retryAt) > now)}
              onClick={() => void snapshot.refresh()}><RefreshIcon size={16} aria-hidden="true" />{snapshot.busy ? text.refreshing : text.refresh}</button>}
          {session.license && <button type="button" className="v2-button v2-button-secondary" onClick={onConfig}><ConfigIcon size={16} aria-hidden="true" />{text.configure}</button>}
        </div>
      </div>
      {rebind && <p className="mt-4 text-sm text-ink-secondary">{text.bindFirst}</p>}
      {snapshot.error && <Notice error>{snapshot.error}</Notice>}
      {snapshot.busy && <p className="mt-4 text-sm text-ink-secondary" role="status">{text.refreshing}</p>}
      <p className="mt-4 text-sm leading-6 text-ink-secondary">{text.snapshotHelp}</p>
      {profile?.skland_binding && <p className="mt-2 text-sm text-ink-muted">UID {profile.skland_binding.uid}</p>}
    </section>
    {data && <Tabs.Root value={tab} onValueChange={setTab}>
      <Tabs.List className="mb-5 flex border-b border-surface-3" aria-label={text.title}>
        {(['overview', 'backpack', 'infrastructure'] as const).map((entry) => <Tabs.Trigger key={entry} value={entry}
          className="min-h-11 flex-1 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-ink-secondary data-[state=active]:border-brand-500 data-[state=active]:text-ink-primary focus-visible:outline-2 focus-visible:outline-brand-500 sm:flex-none sm:px-6">{text[entry]}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="overview" className="space-y-5">
        {game ? <Overview game={game} lmd={data.inventory.lmd} exp={data.inventory.exp} /> : <Notice>{text.noGame}</Notice>}
        <DataTime value={data.game.fetchedAt} />
      </Tabs.Content>
      <Tabs.Content value="backpack" className="space-y-5"><Backpack items={['fresh', 'stale'].includes(sklandResourceState(data.inventory.fetchedAt)) ? data.inventory.items : null} names={data.inventory.itemNames ?? {}} />
        <DataTime value={data.inventory.fetchedAt} />
      </Tabs.Content>
      <Tabs.Content value="infrastructure" className="space-y-5">
        {game?.building ? <Infrastructure building={game.building} /> : <Notice>{text.noBuilding}</Notice>}
        <DataTime value={data.game.fetchedAt} />
      </Tabs.Content>
    </Tabs.Root>}
    <SklandBindingDialog key={profile?.id} open={binding} profile={profile} context={profile?.kind === 'depot_value' ? 'depot' : 'workspace'} autoStart
      onOpenChange={setBinding} onPayload={session.applyAuthPayload} onCompleted={() => { setBinding(false); snapshot.reload() }} />
  </div>
}

function DataTime({ value }: { value: string | null }) {
  return value ? <p className="text-sm text-ink-muted">{text.updated(new Date(value).toLocaleString('zh-CN'))}</p> : null
}

function Overview({ game, lmd, exp }: { game: SklandGame; lmd: number | null; exp: number | null }) {
  const player = game.player
  return <>
    <section className="v2-panel p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">{player.name ?? text.name}{player.level != null && <span className="ml-3 text-sm font-normal text-ink-secondary">Lv.{player.level}</span>}</h2>
      <Facts items={[[text.sanity, ratio(player.sanity)], [text.drones, ratio(game.building?.drones)], [text.lmd, number(lmd)], [text.exp, number(exp)],
        [text.tired, number(game.building?.tired)], [text.operators, number(player.operators)], [text.skins, number(player.skins)], [text.furniture, number(player.furniture)],
        [text.mainStage, player.mainStage ?? text.unavailable], [text.lastOnline, date(player.lastOnline)],
        [text.daily, ratio(game.routine.daily)], [text.weekly, ratio(game.routine.weekly)], [text.campaign, ratio(game.campaign)],
        [text.towerHigher, ratio(game.tower?.higher)], [text.towerLower, ratio(game.tower?.lower)]]} />
      {player.dataAt && <p className="mt-4 text-sm text-ink-muted">{text.sourceTime(date(player.dataAt))}</p>}
    </section>
    <section className="v2-panel p-5 sm:p-6"><h2 className="mb-4 text-base font-semibold">{text.recruitment}</h2>
      {game.recruit ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{game.recruit.map((slot, index) => <div key={index} className="tool-inset p-4">
        <h3 className="text-sm text-ink-secondary">{text.recruitSlot(index)}</h3><p className="mt-2 font-semibold">{text.recruitStates[slot.state === 2 && slot.finishAt && game.currentTs && slot.finishAt <= game.currentTs ? 3 : slot.state] ?? text.unavailable}</p>
        {slot.finishAt != null && slot.finishAt > 0 && <p className="mt-2 text-sm text-ink-secondary">{text.completion} {date(slot.finishAt)}</p>}
      </div>)}</div> : <p className="text-sm text-ink-secondary">{text.unavailable}</p>}
    </section>
  </>
}

function Backpack({ items, names }: { items: Record<string, number> | null; names: Record<string, string> }) {
  const [search, setSearch] = useState('')
  if (!items) return <Notice>{text.noInventory}</Notice>
  const visible = Object.entries(items).filter(([id]) => matchesSearch(`${names[id] ?? ''} ${id}`, search)).sort(([left], [right]) => (names[left] ?? left).localeCompare(names[right] ?? right, 'zh-CN', { numeric: true }))
  return <>
    <section className="v2-panel p-5 sm:p-6"><p className="text-sm leading-6 text-ink-secondary">{text.inventoryHelp}</p>
      <div className="mt-4"><Facts items={text.resources.map((name) => [name, text.unavailable])} /></div>
    </section>
    <section className="v2-panel p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><label className="v2-field min-w-0 flex-1 sm:max-w-sm"><span>{text.search}</span><input type="search" className="v2-input" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="text-sm text-ink-secondary">{text.itemCount(visible.length)}</span></div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map(([id, count]) => <div key={id} className="tool-inset flex min-w-0 items-center justify-between gap-4 p-4">
        <dt className="min-w-0 break-words text-sm">{names[id] ?? id}<span className="mt-1 block text-xs text-ink-muted">{id}</span></dt><dd className="shrink-0 font-semibold tabular-nums">{number(count)}</dd>
      </div>)}</dl>
      {!visible.length && <p className="py-6 text-sm text-ink-secondary">{text.noItems}</p>}
    </section>
  </>
}

function Infrastructure({ building }: { building: NonNullable<SklandGame['building']> }) {
  return <>
    <section className="v2-panel p-5 sm:p-6"><Facts items={[[text.drones, ratio(building.drones)], [text.tired, number(building.tired)]]} /></section>
    <section aria-label={text.productionRooms} className="grid gap-4 xl:grid-cols-3">{building.rooms.filter((room) => ['trading', 'manufacture', 'power'].includes(room.type))
      .sort((left, right) => SKLAND_PRODUCTION_SLOTS.indexOf(left.id) - SKLAND_PRODUCTION_SLOTS.indexOf(right.id)).map((room) => <Room key={room.id} room={room} />)}</section>
    <div className="grid gap-4 lg:grid-cols-2">{building.rooms.filter((room) => !['trading', 'manufacture', 'power'].includes(room.type)).map((room) => <Room key={room.id} room={room} />)}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      {building.clues && <section className="v2-panel p-5 sm:p-6"><h2 className="mb-4 font-semibold">{text.clues}</h2><Facts items={[[text.clueBoard, building.clues.board == null ? text.unavailable : `${number(building.clues.board)} / 7`], [text.clueOwned, number(building.clues.owned)], [text.clueReceived, number(building.clues.received)]]} />
        <p className="mt-4 text-sm text-ink-secondary">{building.clues.sharing == null ? text.unavailable : building.clues.sharing ? `${text.sharing} · ${date(building.clues.shareCompleteAt)}` : text.notSharing}</p>
      </section>}
      {building.training && <section className="v2-panel p-5 sm:p-6"><h2 className="mb-4 font-semibold">{text.training}</h2><Facts items={[[text.trainee, building.training.trainee ?? text.noResidents], [text.trainer, building.training.trainer ?? text.noResidents],
        [text.remaining, building.training.remaining == null ? text.unavailable : text.minutes(Math.ceil(building.training.remaining / 60))]]} /></section>}
    </div>
  </>
}

function Room({ room }: { room: SklandRoom }) {
  const position = SKLAND_PRODUCTION_SLOTS.indexOf(room.id)
  return <section className="v2-panel min-w-0 p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{text.roomTypes[room.type]} <span className="ml-1 text-sm font-normal text-ink-secondary">Lv.{room.level}</span></h2>{position >= 0 && <span className="text-xs text-ink-muted">B{Math.floor(position / 3) + 1} · {copy.common.facilityLayoutColumns[position % 3]}</span>}</div>
    {(room.type === 'manufacture' || room.type === 'trading') && <div className="mt-4"><Facts items={[[room.product ?? text.unavailable, `${text.stock} ${number(room.stock)} / ${number(room.capacity)}`], [text.completion, date(room.completeAt)]]} /></div>}
    {room.comfort != null && <p className="mt-3 text-sm text-ink-secondary">{text.comfort} {number(room.comfort)}</p>}
    {room.operators.length ? <ul className="mt-4 flex flex-wrap gap-2">{room.operators.map((operator) => <li key={operator.id} className="tool-inset px-3 py-2 text-sm"><span className="font-medium">{operator.name}</span><span className="ml-2 text-ink-secondary">{text.morale} {operator.morale == null ? text.unavailable : `${Math.round(operator.morale * 10) / 10} / 24`}</span></li>)}</ul>
      : <p className="mt-4 text-sm text-ink-secondary">{text.noResidents}</p>}
  </section>
}
