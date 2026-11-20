import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { copy } from '../../../copy'
import { ROOM_LABELS } from '../../../components/result-panel/labels'
import { Tabs } from '../../../components/ui/tabs'
import { authPath } from '../../../lib/auth-navigation'
import { BUILDING_RATING_GRADES, buildingRatingCharacter, buildingRatingCombos, buildingRatingCoverage, buildingRatingEdition, buildingRatingGrade, buildingRatingRoster, buildingRatingSkill, comboBuildingRatingRange, ratingMemberStatus, ratingVariantStatus, singleBuildingRatings, type RatingCombo, type RatingMember, type SingleBuildingRating } from '../../../lib/building-skill-ratings'
import type { V2Session } from '../OptionsDrawer'
import { RatingBadge, RatingStageDetails, RatingVariantDetails } from '../BuildingRatingDetails'
import { Avatar } from '../ScheduleBoard'
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
  const entries = source.filter((entry) => {
    const entryUsage = 'stage' in entry ? entry.stage.assessment.usage : entry.usage
    if (room && entry.room !== room || usage && entryUsage !== usage) return false
    if ('variants' in entry) return entry.variants.some((variant) => {
      const match = ratingVariantStatus(variant, roster, config)
      const search = `${entry.title} ${variant.members.map((item) => buildingRatingCharacter(item.id).name).join(' ')}`.toLocaleLowerCase('zh-CN')
      return (!query || search.includes(query)) && (!grade || buildingRatingGrade(variant.score) === grade)
        && (!own || own === 'owned' && match.membersOwned === true || own === 'ready' && match.state === 'ready')
    })
    const state = ratingMemberStatus(member(entry), roster)
    return (!query || `${entry.name} ${entry.stage.skills.map((id) => buildingRatingSkill(id).name).join(' ')}`.toLocaleLowerCase('zh-CN').includes(query))
      && (!grade || buildingRatingGrade(entry.stage.assessment.score!) === grade)
      && (!own || own === 'owned' && Boolean(roster?.get(entry.operatorId)?.own) || own === 'ready' && state === 'ready')
  }).sort((a, b) => rooms.indexOf(a.room) - rooms.indexOf(b.room)
    || ('stage' in a ? a.stage.assessment.usage : a.usage).localeCompare('stage' in b ? b.stage.assessment.usage : b.usage, 'zh-CN')
    || score(b) - score(a) || a.id.localeCompare(b.id))
  const groups = new Map<string, (SingleBuildingRating | RatingCombo)[]>()
  for (const entry of entries.slice(0, limit)) {
    const key = `${ROOM_LABELS[entry.room] ?? entry.room} · ${'stage' in entry ? entry.stage.assessment.usage : entry.usage}`
    groups.set(key, [...groups.get(key) ?? [], entry])
  }
  const reset = () => { const next = new URLSearchParams(); next.set('section', 'building-ratings'); if (profileId) next.set('profile_id', profileId); next.set('kind', pendingParams.current.get('kind') ?? kind); pendingParams.current = next; setLimit(60); void setParams(next) }
  return <div className="v2-ratings">
    <div className="v2-rating-intro"><p className="v2-lead">{text.introduction}</p><p className="v2-muted">{text.coverage(buildingRatingCoverage.operators, buildingRatingCoverage.skills)} · {text.version(buildingRatingEdition.version, buildingRatingEdition.evaluatedAt)}</p>
      <details className="v2-disclosure"><summary>{text.methodology}</summary><div className="v2-rating-method"><p>{text.basis}</p><p>{text.comparison}</p><p>{text.judgement}</p><p>{text.gradeRanges}</p><p>{text.provisionalHelp}</p><ul>{buildingRatingEdition.sources.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> · {item.use}</li>)}</ul></div></details>
    </div>
    <div className="v2-rating-account">{session.authStatus === 'authenticated' ? <><strong>{text.profile}：{session.activeProfile?.display_name ?? text.rosterUnknown}</strong>{!roster && <p>{text.noRoster} <Link className="v2-text-button" to={v2Path('profiles', profileId)}>{text.profileEntry}</Link></p>}</>
      : session.authStatus === 'error' ? <p>{text.profileError} <button type="button" className="v2-text-button" onClick={session.retryAuth}>{copy.v2.retry}</button></p>
        : <p>{text.publicView} <Link className="v2-text-button" to={authPath('login', `/v2?${params}`)}>{text.login}</Link></p>}</div>
    <Tabs.Root value={kind} onValueChange={(value) => update('kind', value)}>
      <Tabs.List className="v2-rating-tabs" aria-label={text.tabs}><Tabs.Trigger value="single">{text.single}</Tabs.Trigger><Tabs.Trigger value="combo">{text.combo}</Tabs.Trigger></Tabs.List>
      <p className="v2-muted">{kind === 'combo' ? text.comboHelp : text.singlesHelp}</p>
      <form className="v2-rating-filters" onSubmit={(event) => event.preventDefault()} aria-label={text.search}>
        <label className="v2-field v2-rating-search"><span>{text.search}</span><input className="v2-input" type="search" placeholder={text.searchPlaceholder} value={params.get('q') ?? ''} onChange={(event) => update('q', event.target.value)} /></label>
        <label className="v2-field"><span id={`${filterId}-room`}>{text.room}</span><select aria-labelledby={`${filterId}-room`} className="v2-input" value={room} onChange={(event) => update('room', event.target.value)}><option value="">{text.all}</option>{rooms.map((value) => <option key={value} value={value}>{ROOM_LABELS[value] ?? value}</option>)}</select></label>
        <label className="v2-field"><span id={`${filterId}-usage`}>{text.usage}</span><select aria-labelledby={`${filterId}-usage`} className="v2-input" value={usage} onChange={(event) => update('usage', event.target.value)}><option value="">{text.all}</option>{usages.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="v2-field"><span id={`${filterId}-grade`}>{text.grade}</span><select aria-labelledby={`${filterId}-grade`} className="v2-input" value={grade} onChange={(event) => update('grade', event.target.value)}><option value="">{text.all}</option>{BUILDING_RATING_GRADES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="v2-field"><span id={`${filterId}-owned`}>{text.ownership}</span><select aria-labelledby={`${filterId}-owned`} className="v2-input" value={own} disabled={!roster} onChange={(event) => update('owned', event.target.value)}><option value="">{text.all}</option><option value="owned">{text.owned}</option><option value="ready">{text.readyFilter}</option></select></label>
      </form>
      <div className="v2-rating-result-count" role="status"><span>{text.count(entries.length)}</span><button type="button" className="v2-text-button" onClick={reset}>{text.reset}</button></div>
      <Tabs.Content value={kind} className="v2-rating-results">
        {!entries.length && <p className="v2-rating-empty">{text.empty}</p>}
        {[...groups].map(([label, items]) => <section className="v2-rating-group" key={label}><h2>{label}</h2><div>{items.map((entry) => {
          if ('variants' in entry) {
            const range = comboBuildingRatingRange(entry)
            const matches = entry.variants.map((variant) => ratingVariantStatus(variant, roster, config))
            return <details className="v2-rating-row" key={entry.id} id={`rating-${entry.id}`}><summary><div className="v2-rating-identity"><strong>{entry.title}{entry.variants.some((variant) => variant.provisional) && <small className="v2-rating-provisional">{text.provisional}</small>}</strong><span>{text.variants(entry.variants.length)}{roster && ` · ${matches.some((match) => match.membersOwned) ? text.membersOwned : text.membersMissing}`}</span></div><RatingBadge score={range.high} low={range.low} /><span className="v2-rating-chevron" aria-hidden="true">⌄</span></summary>
              <div className="v2-rating-details">{entry.variants.map((variant, index) => <RatingVariantDetails key={index} variant={variant} index={index} roster={roster} config={config} />)}</div>
            </details>
          }
          const state = ratingMemberStatus(member(entry), roster)
          return <details className="v2-rating-row" key={entry.id} id={`rating-${entry.id}`}><summary><Avatar operator={{ id: entry.operatorId, name: entry.name }} small /><div className="v2-rating-identity"><strong>{entry.name}{entry.stage.assessment.provisional && <small className="v2-rating-provisional">{text.provisional}</small>}</strong><span>{text.minimum} · {copy.domain.building_skills.unlock(entry.stage.elite, entry.stage.level)}{roster && ` · ${text.memberStates[state]}`}</span></div><RatingBadge score={entry.stage.assessment.score!} /><span className="v2-rating-chevron" aria-hidden="true">⌄</span></summary>
            <RatingStageDetails stages={entry.stages} member={member(entry)} roster={roster} profileId={profileId} />
          </details>
        })}</div></section>)}
        {entries.length > limit && <button type="button" className="v2-button v2-button-secondary v2-rating-more" onClick={() => setLimit((value) => value + 60)}>{text.more(entries.length - limit)}</button>}
      </Tabs.Content>
    </Tabs.Root>
  </div>
}
