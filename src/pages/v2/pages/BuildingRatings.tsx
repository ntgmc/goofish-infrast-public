import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { LayoutGroup } from 'motion/react'
import { copy } from '../../../copy'
import { ROOM_LABELS } from '../../../components/result-panel/labels'
import { Tabs } from '../../../components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../components/ui/dialog'
import { authPath } from '../../../lib/auth-navigation'
import { BUILDING_RATING_GRADES, buildingRatingCharacter, buildingRatingCombos, buildingRatingCoverage, buildingRatingEdition, buildingRatingGrade, buildingRatingRoster, buildingRatingSkill, comboBuildingRatingRange, ratingMemberStatus, ratingVariantStatus, singleBuildingRatings, type RatingCombo, type RatingMember, type RatingVariant, type SingleBuildingRating } from '../../../lib/building-skill-ratings'
import type { V2Session } from '../OptionsDrawer'
import { BuildingRatingCard, BuildingRatingDialog, type BuildingRatingEntry } from '../BuildingRatingCards'
import { v2Path } from '../navigation'
import '../building-ratings.css'

const text = copy.buildingRatings
const rooms = ['trading', 'manufacture', 'control', 'power', 'dormitory', 'meeting', 'processing', 'hire', 'training', 'recycling']
const score = (entry: SingleBuildingRating | RatingCombo) => 'variants' in entry ? comboBuildingRatingRange(entry).high : entry.stage.assessment.score!
const member = (entry: SingleBuildingRating): RatingMember => ({ id: entry.operatorId, room: entry.room, elite: entry.stage.elite, level: entry.stage.level, station: 'main' })

export default function BuildingRatings({ session }: { session: V2Session }) {
  const [params, setParams] = useSearchParams()
  const pendingParams = useRef(params)
  useEffect(() => { pendingParams.current = params }, [params])
  const [limit, setLimit] = useState(60)
  const filterId = useId()
  const [selected, setSelected] = useState<{ entry: BuildingRatingEntry; variant: number } | null>(null)
  const sourceCard = useRef<HTMLElement | null>(null)
  useEffect(() => { setSelected(null) }, [params])
  const query = (params.get('q') ?? '').trim().toLocaleLowerCase('zh-CN')
  const kind = params.get('kind') === 'combo' || !params.has('kind') && query && !singleBuildingRatings.some((entry) => entry.name.toLocaleLowerCase('zh-CN').includes(query)) ? 'combo' : 'single'
  const room = params.get('room') ?? '', usage = params.get('usage') ?? '', grade = params.get('grade') ?? '', own = params.get('owned') ?? ''
  const profileId = session.activeProfile?.id
  const roster = useMemo(() => session.user && session.workspace?.operators?.length ? buildingRatingRoster(session.workspace.operators) : null, [session.user, session.workspace?.operators])
  const config = session.configOverride ?? session.workspace?.config ?? null
  const source = kind === 'combo' ? buildingRatingCombos : singleBuildingRatings
  const usages = [...new Set(source.filter((entry) => !room || entry.room === room).map((entry) => 'stage' in entry ? entry.stage.assessment.usage : entry.usage))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(pendingParams.current)
    if (!next.has('kind')) next.set('kind', kind)
    if (value) next.set(key, value); else next.delete(key)
    if (key === 'room' || key === 'kind') next.delete('usage')
    pendingParams.current = next
    setLimit(60)
    void setParams(next, { replace: key === 'q' })
  }
  const matchesVariant = (entry: RatingCombo, variant: RatingVariant) => {
    const match = ratingVariantStatus(variant, roster, config)
    const search = `${entry.title} ${variant.members.map((item) => buildingRatingCharacter(item.id).name).join(' ')}`.toLocaleLowerCase('zh-CN')
    return (!query || search.includes(query)) && (!grade || buildingRatingGrade(variant.score) === grade)
      && (!own || own === 'owned' && match.membersOwned === true || own === 'ready' && match.state === 'ready')
  }
  const entries = source.filter((entry) => {
    const entryUsage = 'stage' in entry ? entry.stage.assessment.usage : entry.usage
    if (room && entry.room !== room || usage && entryUsage !== usage) return false
    if ('variants' in entry) return entry.variants.some((variant) => matchesVariant(entry, variant))
    const state = ratingMemberStatus(member(entry), roster)
    return (!query || `${entry.name} ${entry.stage.skills.map((id) => buildingRatingSkill(id).name).join(' ')}`.toLocaleLowerCase('zh-CN').includes(query))
      && (!grade || buildingRatingGrade(entry.stage.assessment.score!) === grade)
      && (!own || own === 'owned' && Boolean(roster?.get(entry.operatorId)?.own) || own === 'ready' && state === 'ready')
  }).sort((a, b) => rooms.indexOf(a.room) - rooms.indexOf(b.room) || score(b) - score(a) || a.id.localeCompare(b.id))
  const groups = new Map<string, (SingleBuildingRating | RatingCombo)[]>()
  for (const entry of entries.slice(0, limit)) {
    const key = ROOM_LABELS[entry.room] ?? entry.room
    groups.set(key, [...groups.get(key) ?? [], entry])
  }
  const reset = () => { const next = new URLSearchParams(); next.set('section', 'building-ratings'); if (profileId) next.set('profile_id', profileId); next.set('kind', pendingParams.current.get('kind') ?? kind); pendingParams.current = next; setLimit(60); void setParams(next) }
  return <LayoutGroup id={filterId}><div className="v2-ratings">
    <Tabs.Root value={kind} onValueChange={(value) => update('kind', value)}>
      <div className="v2-rating-toolbar"><Tabs.List className="v2-rating-tabs" aria-label={text.tabs}><Tabs.Trigger value="single">{text.single}</Tabs.Trigger><Tabs.Trigger value="combo">{text.combo}</Tabs.Trigger></Tabs.List>
        <Dialog><DialogTrigger asChild><button type="button" className="v2-text-button">{text.methodology}</button></DialogTrigger>
          <DialogContent className="v2-dialog v2-rating-method-dialog" showCloseButton closeLabel={copy.v2.close}>
            <DialogTitle>{text.methodology}</DialogTitle><DialogDescription>{text.introduction}</DialogDescription>
            <div className="v2-rating-method"><p>{text.catalogSummary(buildingRatingCoverage.operators, buildingRatingCombos.length)}</p><p>{text.coverage(buildingRatingCoverage.operators, buildingRatingCoverage.skills)} · {text.version(buildingRatingEdition.version, buildingRatingEdition.evaluatedAt)}</p><p>{text.basis}</p><p>{text.comparison}</p><p>{text.judgement}</p><p>{text.gradeRanges}</p><p>{text.provisionalHelp}</p><p>{text.comboHelp}</p><p>{text.singlesHelp}</p><ul>{buildingRatingEdition.sources.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> · {item.use}</li>)}</ul></div>
          </DialogContent>
        </Dialog>
      </div>
      <form className="v2-rating-filters" onSubmit={(event) => event.preventDefault()} aria-label={text.search}>
        <label className="v2-field v2-rating-search"><span>{text.search}</span><input className="v2-input" type="search" placeholder={text.searchPlaceholder} value={params.get('q') ?? ''} onChange={(event) => update('q', event.target.value)} /></label>
        <label className="v2-field"><span id={`${filterId}-room`}>{text.room}</span><select aria-labelledby={`${filterId}-room`} className="v2-input" value={room} onChange={(event) => update('room', event.target.value)}><option value="">{text.all}</option>{rooms.map((value) => <option key={value} value={value}>{ROOM_LABELS[value] ?? value}</option>)}</select></label>
        <label className="v2-field"><span id={`${filterId}-usage`}>{text.usage}</span><select aria-labelledby={`${filterId}-usage`} className="v2-input" value={usage} onChange={(event) => update('usage', event.target.value)}><option value="">{text.all}</option>{usages.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="v2-field"><span id={`${filterId}-grade`}>{text.grade}</span><select aria-labelledby={`${filterId}-grade`} className="v2-input" value={grade} onChange={(event) => update('grade', event.target.value)}><option value="">{text.all}</option>{BUILDING_RATING_GRADES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="v2-field"><span id={`${filterId}-owned`}>{text.ownership}</span><select aria-labelledby={`${filterId}-owned`} className="v2-input" value={own} disabled={!roster} onChange={(event) => update('owned', event.target.value)}><option value="">{text.all}</option><option value="owned">{text.owned}</option><option value="ready">{text.readyFilter}</option></select></label>
      </form>
      <div className="v2-rating-result-count"><span role="status">{text.count(entries.length)}</span><div className="v2-rating-account">{session.authStatus === 'authenticated' ? <span>{text.profile}：{session.activeProfile?.display_name ?? text.rosterUnknown}</span>
        : session.authStatus === 'error' ? <><span>{text.profileError}</span><button type="button" className="v2-text-button" onClick={session.retryAuth}>{copy.v2.retry}</button></>
          : <Link className="v2-text-button" to={authPath('login', `/v2?${params}`)}>{text.login}</Link>}</div><button type="button" className="v2-text-button" onClick={reset}>{text.reset}</button></div>
      {session.authStatus === 'authenticated' && !roster && <p className="v2-rating-roster-note">{text.noRoster} <Link className="v2-text-button" to={v2Path('profiles', profileId)}>{text.profileEntry}</Link></p>}
      <Tabs.Content value={kind} className="v2-rating-results">
        {!entries.length && <p className="v2-rating-empty">{text.empty}</p>}
        {[...groups].map(([label, items]) => <section className="v2-rating-group" key={label}><h2>{label}</h2><div className="v2-rating-grid">{items.map((entry) => <BuildingRatingCard key={entry.id} entry={entry} roster={roster} active={selected?.entry.id === entry.id} onOpen={(source) => {
          sourceCard.current = source
          setSelected({ entry, variant: 'variants' in entry ? Math.max(0, entry.variants.findIndex((variant) => matchesVariant(entry, variant))) : 0 })
        }} />)}</div></section>)}
        {entries.length > limit && <button type="button" className="v2-button v2-button-secondary v2-rating-more" onClick={() => setLimit((value) => value + 60)}>{text.more(entries.length - limit)}</button>}
      </Tabs.Content>
    </Tabs.Root>
    {selected && <BuildingRatingDialog key={selected.entry.id} entry={selected.entry} initialVariant={selected.variant} source={sourceCard.current} roster={roster} config={config} profileId={profileId} onClose={() => setSelected(null)} />}
  </div></LayoutGroup>
}
