import { useMemo, useState } from 'react'
import { matchesSearch } from '../../../lib/search'
import { RefreshIcon, UndoIcon, ExcludeIcon, NextIcon, ExternalLinkIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import { defaultCultivationQuery, type CultivationCandidate, type CultivationData, type CultivationOptions } from '../../../lib/cultivation-contract'
import { useCultivation } from '../../CultivationPlanPage'
import CultivationProjectImport from '../../../components/CultivationProjectImport'
import { projectFromCultivationCandidate } from '../../../lib/cultivation-project-import'
import { number, CultivationTraining, CultivationEvidence } from '../../cultivation/CultivationResults'
import CultivationFilters from '../../cultivation/CultivationFilters'
import { SpecialItemRates, useSpecialItems } from '../../cultivation/CultivationSpecialItems'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import Link from '../../../components/InternalLink'
import { EmptyState, Facts, Field, Loading, Notice, SectionTitle } from '../components/WorkspaceUI'
import './cultivation.css'

type Model = ReturnType<typeof useCultivation>
const text = copy.tools.cultivation

export default function Cultivation({ session }: { session: V2Session }) {
  const m = useCultivation(session)
  const [view, setView] = useState('priorities')
  const appliedQuery = m.appliedOptions.recommendation ?? defaultCultivationQuery
  const projectScope = session.user && m.profileId ? { userId: session.user.id, profileId: m.profileId } : null
  const importProjects = m.recommendations?.flatMap((candidate) => { const project = projectFromCultivationCandidate(candidate); return project ? [project] : [] }) ?? []
  return <div className="v2-cultivation-workspace">
    <div className="v2-cultivation-source">
      <p>{text.description}</p>
      <div className="v2-cultivation-source-controls">
        {session.authStatus === 'authenticated' && m.profiles.length ? <>
          <label className="v2-field"><span>{text.profile}</span><select className="v2-input" value={m.profileId} onChange={(event) => m.setChosenProfile(event.target.value)}>{m.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
          <button type="button" className="v2-button v2-button-primary" disabled={m.busy} onClick={() => void m.load()}><RefreshIcon size={16} aria-hidden="true" className={m.busy ? 'v2-spin' : undefined} />{m.busy ? text.loadingData : copy.skland.refresh}</button>
        </> : session.authLoading ? <Loading label={text.loading} /> : <div className="v2-cultivation-access"><p>{session.authStatus === 'authenticated' ? text.noProfile : text.login}</p><Link className="v2-button v2-button-secondary" to={v2Path('profiles', session.activeProfile?.id)}>{text.loginAction}</Link></div>}
        {projectScope && <Link className="v2-text-button v2-cultivation-project-link" to={v2Path('cultivation-projects', m.profileId)}>{copy.cultivationProjects.title}<NextIcon size={14} aria-hidden="true" /></Link>}
      </div>
    </div>
    <Notice error>{m.error}</Notice>
    {m.data && m.recommendations ? <>
      <div className="v2-cultivation-overview"><Facts items={[[text.stats.homeworks, number(m.data.stats.homeworks)], [text.stats.owned, number(m.data.stats.owned)], [text.stats.satisfied, number(m.data.candidates.filter((row) => row.satisfied).length)], [text.stats.incomplete, number(m.data.stats.incomplete)]]} /></div>
      {m.data.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
      <details className="v2-cultivation-conditions">
        <summary><strong>{text.parameters}</strong><span>{text.scopes[appliedQuery.scope]} · {appliedQuery.rarity ? text.rarityName(appliedQuery.rarity) : text.rarityGroups[appliedQuery.rarityGroup]} · {text.preferences[m.appliedOptions.preference]}</span>{m.changed && <small>{text.unapplied}</small>}</summary>
        <div className="v2-cultivation-settings-body">
          <CultivationFilters query={m.options.recommendation ?? defaultCultivationQuery} data={m.data} v2 onChange={(recommendation) => m.setOptions((options) => ({ ...options, recommendation }))} />
          <div className="v2-cultivation-preferences">
            <fieldset className="v2-choice-list"><legend>{text.preference}</legend>{Object.entries(text.preferences).map(([key, title]) => <label key={key}><input type="radio" name="v2-cultivation-preference" checked={m.options.preference === key} onChange={() => m.setOptions((options) => ({ ...options, preference: key as CultivationOptions['preference'] }))} /><span><strong>{title}</strong></span></label>)}</fieldset>
            <p className="v2-muted">{text.preferenceHints[m.options.preference]}</p>
            {m.options.preference === 'community' && m.data.community?.status !== 'fresh' && <Notice>{m.data.community?.status === 'stale' ? text.communityStale : text.communityUnavailable}</Notice>}
            <Field label={text.limit} type="number" min={1} max={30} value={m.limit} onChange={(event) => m.setLimit(event.target.value)} />
          </div>
          <div className="v2-cultivation-apply"><button type="button" className="v2-button v2-button-primary" disabled={m.busy} onClick={m.apply}>{text.apply}</button>{m.changed && <p role="status">{text.settingsChanged}</p>}</div>
        </div>
      </details>
      <div className="v2-cultivation-outcome" aria-busy={m.busy}>
        <nav className="v2-view-switch v2-cultivation-views" aria-label={text.title}>{[['priorities', text.suggestions], ['comparison', text.comparison], ['special', text.specialItems]].map(([id, title]) => <button type="button" key={id} title={title} aria-pressed={view === id} onClick={() => setView(id)}>{text.views[id as keyof typeof text.views]}</button>)}</nav>
        <section hidden={view !== 'priorities'}>
          <SectionTitle title={text.suggestions} description={text.adviceHint} action={projectScope && <CultivationProjectImport key={`${projectScope.profileId}:${JSON.stringify(importProjects)}`} scope={projectScope} projects={importProjects} batch v2 partial={m.recommendations.some((candidate) => Boolean(candidate.target.moduleId) || candidate.target.potential > candidate.current.potential)} />} />
          {!m.recommendations.length ? <EmptyState title={text.empty} /> : <ol className="v2-cultivation-priorities">{m.recommendations.map((row, index) => {
            const project = projectFromCultivationCandidate(row)
            return <li key={row.key}>
              <header className="v2-cultivation-heading"><Operator row={row} data={m.data!} rank={index + 1} /></header>
              <div className="v2-cultivation-target">
                <div className="v2-cultivation-training"><CultivationTraining row={row} /></div>
                <Facts items={[[text.stageCount, String(row.stageCount)], [text.weightedDemand, number(row.weightedFrequency ?? row.frequency)]]} />
              </div>
              <div className="v2-cultivation-details">
                {row.source === 'community' && <p className="v2-muted">{text.communityRate(row.communityRate ?? null)}</p>}
                <CultivationEvidence row={row} /><Community row={row} data={m.data!} />
              </div>
              <footer className="v2-cultivation-row-actions">
                <div className="v2-actions">{projectScope && project && <CultivationProjectImport key={row.key} scope={projectScope} projects={[project]} v2 partial={Boolean(row.target.moduleId) || row.target.potential > row.current.potential} />}<button type="button" className="v2-text-button v2-cultivation-exclude" aria-label={`${text.exclude} ${row.name}`} onClick={() => m.exclude(row.operatorId, true)}><ExcludeIcon size={14} aria-hidden="true" />{text.exclude}</button></div>
                <div className="v2-actions">{row.examples.map((id) => <a className="v2-text-button" key={id} href={`https://prts.plus/?op=${id}`} target="_blank" rel="noreferrer">{text.example} #{id}<ExternalLinkIcon size={12} aria-hidden="true" /></a>)}</div>
              </footer>
            </li>
          })}</ol>}
        </section>
        <section hidden={view !== 'comparison'}><CandidateComparison model={m} data={m.data} /></section>
        <section hidden={view !== 'special'}><SpecialItems key={m.profileId} data={m.data} preference={m.appliedOptions.preference} /></section>
      </div>
      <div className="v2-cultivation-dates"><p>{text.dataDate}<time dateTime={m.data.updatedAt}>{new Date(m.data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time></p><p>{text.importDate}<time dateTime={m.data.importedAt}>{new Date(m.data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time></p></div>
    </> : m.busy ? <Loading label={text.loadingData} /> : !session.authLoading && <EmptyState title={text.load}>{text.description}</EmptyState>}
  </div>
}

function Operator({ row, data, rank }: { row: CultivationCandidate; data: CultivationData; rank?: number }) {
  return <div className="v2-cultivation-operator">
    {rank !== undefined && <span className="v2-cultivation-rank">{String(rank).padStart(2, '0')}</span>}
    <img className="v2-cultivation-portrait" src={`/webp96/${encodeURIComponent(row.operatorId)}.webp`} alt="" width={56} height={56} loading="lazy" />
    <div><h3>{row.name}</h3><span className="v2-cultivation-skill">{row.skillId && <img src={`/skill-icons/${encodeURIComponent(data.skillIcons?.[row.skillId] ?? row.skillId)}.png`} alt="" width={20} height={20} loading="lazy" />}{row.target.skill > 0 && row.target.skillLevel <= 7 ? text.skillTarget(row.target.skill, row.target.skillLevel) : text.skillName(row.target.skill)}{row.target.skillLevel > 7 && <strong>{text.masteryName(row.target.skillLevel - 7)}</strong>}</span></div>
  </div>
}

function Community({ row, data }: { row: CultivationCandidate; data: CultivationData }) {
  const stats = data.community?.operators[row.operatorId]
  if (!stats) return null
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  return <details className="v2-disclosure v2-cultivation-community"><summary>{text.communityTitle} · {text.communityScore(row.communityScore ?? null)} · {text.eliteRate} {percent(stats.elite[2])}</summary><p>{text.communitySample(stats.owned)}</p><dl className="v2-material-list">{stats.skills.map((skill, index) => <div key={index}><dt>{text.skillName(index + 1)}</dt><dd>{[1, 2, 3].map((rank) => `${text.masteryName(rank)} ${percent(skill[rank] ?? 0)}`).join(' · ')}</dd></div>)}{Object.entries(stats.modules).filter(([, ranks]) => ranks.slice(1).some((value) => value > 0)).map(([type, ranks]) => <div key={type}><dt>{text.moduleType(type)}</dt><dd>{text.moduleRate} {percent(ranks.slice(1).reduce((sum, value) => sum + value, 0))}<br />{[1, 2, 3].map((rank) => `${text.moduleRank(rank)} ${percent(ranks[rank] ?? 0)}`).join(' · ')}</dd></div>)}</dl></details>
}

function CandidateComparison({ model: m, data }: { model: Model; data: CultivationData }) {
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(50)
  const rows = useMemo(() => data.candidates.filter((row) => matchesSearch(row.name, search)).sort((a, b) => (b.weightedFrequency ?? b.frequency) - (a.weightedFrequency ?? a.frequency)), [data, search])
  return <>
    <SectionTitle title={text.comparison} description={text.comparisonHint} />
    <div className="v2-cultivation-search"><Field label={text.search} type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisible(50) }} /></div>
    <div className="v2-candidate-list">{rows.slice(0, visible).map((row) => <article key={row.key}>
      <header className="v2-cultivation-heading"><Operator row={row} data={data} /><span className="v2-cultivation-status" data-state={row.satisfied ? 'matched' : row.warnings.length ? 'check' : 'training'}>{row.satisfied ? text.matched : row.warnings.length ? text.check : text.needsTraining}</span></header>
      <div className="v2-cultivation-candidate-detail"><div className="v2-cultivation-training"><CultivationTraining row={row} /></div>
        {row.source === 'community' && <p className="v2-muted">{text.communityRate(row.communityRate ?? null)}</p>}
        <CultivationEvidence row={row} />{row.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
        {m.appliedOptions.excluded.includes(row.operatorId) && <button type="button" className="v2-text-button" onClick={() => m.exclude(row.operatorId, false)}><UndoIcon size={14} aria-hidden="true" />{text.excluded}</button>}
      </div>
    </article>)}</div>
    {!rows.length && <EmptyState title={text.noMatches} />}
    {rows.length > visible && <button type="button" className="v2-button v2-button-secondary" onClick={() => setVisible(visible + 50)}>{text.showMore}</button>}
  </>
}

function SpecialItems({ data, preference }: Parameters<typeof useSpecialItems>[0]) {
  const m = useSpecialItems({ data, preference })
  const [search, setSearch] = useState('')
  const items = m.items.filter((item) => matchesSearch(`${item.name} ${item.scope}`, search))
  return <>
    <SectionTitle title={text.specialItems} description={text.specialHint} />
    {!m.items.length ? <EmptyState title={text.noSpecialItems} /> : <div className="v2-special-workspace">
      <div className="v2-special-index">
        <Field label={text.specialSearch} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="v2-special-items" role="group" aria-label={text.specialItems}>{items.map((item) => <button type="button" key={item.id} aria-pressed={m.chosen === item.id} onClick={() => { m.setChosen(item.id); m.setVisible(8) }}><strong title={item.name}>{item.name}</strong><small title={item.scope}>{item.count === null ? item.scope : text.itemStock(item.count)}{!item.available && ` · ${text.itemExpired}`}</small></button>)}{!items.length && <p className="v2-muted">{text.noMatches}</p>}</div>
      </div>
      {m.selected ? <div key={m.selected.id} className="v2-special-detail">
        <header><h3>{m.selected.name}</h3><a className="v2-text-button" href={m.selected.sourceUrl} target="_blank" rel="noreferrer">{text.itemDetails}<ExternalLinkIcon size={14} aria-hidden="true" /></a></header>
        <p>{m.selected.scope}</p><p className="v2-special-condition">{text.specialConditions[m.selected.kind]}</p>
        {m.selected.expiresAt && <p>{text.expiry} {new Date(m.selected.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
        {!m.selected.available ? <Notice>{text.itemExpired}</Notice> : !m.recommendations.length ? <EmptyState title={text.noItemUses} /> : <>
          <h3 className="v2-special-recommendation-title">{text.specialRecommendations}</h3>
          <ol className="v2-special-recommendations">{m.recommendations.slice(0, m.visible).map((row, index) => <li key={row.key}>
            <span className="v2-cultivation-rank">{String(index + 1).padStart(2, '0')}</span>
            {row.operatorId && <img src={`/webp96/${encodeURIComponent(row.operatorId)}.webp`} alt="" width={40} height={40} loading="lazy" />}
            <div><strong>{row.name}{row.skill && ` · ${text.skillName(row.skill)} ${text.masteryName(3)}`}</strong><small>{text.weightedDemand} {number(row.demand)} · <SpecialItemRates row={row} data={data} /></small></div>
            {row.owned !== undefined && <span className="v2-cultivation-status" data-state={row.owned ? 'matched' : 'training'}>{row.owned ? text.ownedOperator : text.newOperator}</span>}
          </li>)}</ol>
          {m.recommendations.length > m.visible && <button type="button" className="v2-text-button" onClick={() => m.setVisible(m.visible + 16)}>{text.showMore}</button>}
        </>}
      </div> : <EmptyState title={text.chooseSpecialItem} />}
    </div>}
    {data.specialItemsUpdatedAt && <p className="v2-data-date">{text.specialDate} · {new Date(data.specialItemsUpdatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
  </>
}
