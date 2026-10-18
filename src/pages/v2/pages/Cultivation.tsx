import { useMemo, useState } from 'react'
import { RefreshIcon as ArrowRight, UndoIcon as RotateCcw, ExcludeIcon as X } from '../../../components/icons'
import { copy } from '../../../copy'
import { defaultCultivationQuery, type CultivationCandidate, type CultivationData, type CultivationOptions } from '../../../lib/cultivation-contract'
import { useCultivation } from '../../CultivationPlanPage'
import CultivationProjectImport from '../../../components/CultivationProjectImport'
import { projectFromCultivationCandidate } from '../../../lib/cultivation-project-import'
import { number, CultivationTraining, CultivationEvidence } from '../../cultivation/CultivationResults'
import CultivationFilters from '../../cultivation/CultivationFilters'
import { useSpecialItems } from '../../cultivation/CultivationSpecialItems'
import type { V2Session } from '../OptionsDrawer'
import { v2Path } from '../navigation'
import Link from '../../../components/InternalLink'
import { EmptyState, Facts, Field, Notice } from '../components/WorkspaceUI'

type Model = ReturnType<typeof useCultivation>
const text = copy.tools.cultivation

export default function Cultivation({ session }: { session: V2Session }) {
  const m = useCultivation(session)
  const [view, setView] = useState('priorities')
  const appliedQuery = m.appliedOptions.recommendation ?? defaultCultivationQuery
  const projectScope = session.user && m.profileId ? { userId: session.user.id, profileId: m.profileId } : null
  const importProjects = m.recommendations?.flatMap((candidate) => { const project = projectFromCultivationCandidate(candidate); return project ? [project] : [] }) ?? []
  return <div className="v2-cultivation-workspace"><div className="v2-tool-source"><div><span className="v2-label">{copy.v2.toolSource}</span><p>{text.description}</p></div>{session.authStatus === 'authenticated' && m.profiles.length ? <><label className="v2-field"><span>{text.profile}</span><select className="v2-input" value={m.profileId} onChange={(event) => m.setChosenProfile(event.target.value)}>{m.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label><button className="v2-button v2-button-primary" disabled={m.busy} onClick={() => void m.load()}>{m.busy ? text.loadingData : copy.skland.refresh}<ArrowRight size={16} /></button></> : <div><p>{session.authStatus === 'authenticated' ? text.noProfile : text.login}</p><Link className="v2-button v2-button-secondary" to={v2Path('profiles', session.activeProfile?.id)}>{text.loginAction}</Link></div>}</div>
    <Notice error>{m.error}</Notice>
    {m.data && m.recommendations ? <><Facts items={[[text.stats.homeworks, number(m.data.stats.homeworks)], [text.stats.owned, number(m.data.stats.owned)], [text.stats.satisfied, number(m.data.candidates.filter((row) => row.satisfied).length)], [text.stats.incomplete, number(m.data.stats.incomplete)]]} />{m.data.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}<div className="v2-planning-workspace">
      <details className="v2-disclosure v2-cultivation-conditions"><summary>{text.parameters}<small className="ml-3">{appliedQuery.rarity ? text.rarityName(appliedQuery.rarity) : text.rarityGroups[appliedQuery.rarityGroup]} · {text.preferences[m.appliedOptions.preference]}</small></summary><div className="v2-planning-conditions">
        <CultivationFilters query={m.options.recommendation ?? defaultCultivationQuery} data={m.data} v2 onChange={(recommendation) => m.setOptions((options) => ({ ...options, recommendation }))} />
        <fieldset className="v2-choice-list"><legend>{text.preference}</legend>{Object.entries(text.preferences).map(([key, title]) => <label key={key}><input type="radio" name="v2-cultivation-preference" checked={m.options.preference === key} onChange={() => m.setOptions((options) => ({ ...options, preference: key as CultivationOptions['preference'] }))} /><span><strong>{title}</strong></span></label>)}</fieldset><p className="v2-muted">{text.preferenceHints[m.options.preference]}</p>
        {m.options.preference === 'community' && m.data.community?.status !== 'fresh' && <Notice>{m.data.community?.status === 'stale' ? text.communityStale : text.communityUnavailable}</Notice>}
        <Field label={text.limit} type="number" min={1} max={30} value={m.limit} onChange={(event) => m.setLimit(event.target.value)} />
        <div className="v2-actions"><button className="v2-button v2-button-primary" disabled={m.busy} onClick={m.apply}>{text.apply}</button>{m.changed && <Notice>{text.settingsChanged}</Notice>}</div>
      </div></details>
      <div className="v2-planning-outcome"><nav className="v2-view-switch" aria-label={text.title}>{[['priorities', text.suggestions], ['comparison', text.comparison], ['special', text.specialItems]].map(([id, title]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{title}</button>)}</nav>
        <section hidden={view !== 'priorities'}><p className="v2-muted">{text.adviceHint}</p>{projectScope && <CultivationProjectImport key={`${projectScope.profileId}:${JSON.stringify(importProjects)}`} scope={projectScope} projects={importProjects} batch v2 partial={m.recommendations.some((candidate) => Boolean(candidate.target.moduleId) || candidate.target.potential > candidate.current.potential)} />}{!m.recommendations.length ? <EmptyState title={text.empty} /> : <ol className="v2-cultivation-priorities">{m.recommendations.map((row, index) => <li key={row.key}><span className="v2-step-number">{index + 1}</span><div><Operator row={row} /><CultivationTraining row={row} />{projectScope && projectFromCultivationCandidate(row) && <CultivationProjectImport key={row.key} scope={projectScope} projects={[projectFromCultivationCandidate(row)!]} v2 partial={Boolean(row.target.moduleId) || row.target.potential > row.current.potential} />}{row.source === 'community' && <small>{text.communityRate(row.communityRate ?? null)}</small>}<Facts items={[[text.stageCount, String(row.stageCount)], [text.weightedDemand, number(row.weightedFrequency ?? row.frequency)]]} /><CultivationEvidence row={row} /><Community row={row} data={m.data!} /><div className="v2-actions">{row.examples.map((id) => <a className="v2-text-button" key={id} href={`https://prts.plus/?op=${id}`} target="_blank" rel="noreferrer">{text.example} #{id}</a>)}</div></div><button className="v2-icon-button" aria-label={`${text.exclude} ${row.name}`} onClick={() => m.exclude(row.operatorId, true)}><X size={18} /></button></li>)}</ol>}</section>
        <section hidden={view !== 'comparison'}><CandidateComparison model={m} data={m.data} /></section>
        <section hidden={view !== 'special'}><SpecialItems key={m.profileId} data={m.data} preference={m.appliedOptions.preference} /></section>
      </div>
    </div><p className="v2-data-date">{text.dataDate} · {new Date(m.data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br />{text.importDate} · {new Date(m.data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p></> : !m.busy && <EmptyState title={text.load}>{text.description}</EmptyState>}
  </div>
}

function Operator({ row }: { row: CultivationCandidate }) {
  return <div className="v2-cultivation-operator"><img src={`/webp96/${encodeURIComponent(row.operatorId)}.webp`} alt="" width={48} height={48} loading="lazy" /><div><h3>{row.name}</h3><span>{text.skillName(row.target.skill)}{row.target.skillLevel > 7 && ` · ${text.masteryName(row.target.skillLevel - 7)}`}</span></div></div>
}

function Community({ row, data }: { row: CultivationCandidate; data: CultivationData }) {
  const stats = data.community?.operators[row.operatorId]
  if (!stats) return null
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  return <details className="v2-disclosure"><summary>{text.communityTitle} · {text.eliteRate} {percent(stats.elite[2])}</summary><p>{text.communitySample(stats.owned)}</p><dl className="v2-material-list">{stats.skills.map((skill, index) => <div key={index}><dt>{text.skillName(index + 1)}</dt><dd>{[1, 2, 3].map((rank) => `${text.masteryName(rank)} ${percent(skill[rank] ?? 0)}`).join(' · ')}</dd></div>)}{Object.entries(stats.modules).filter(([, ranks]) => ranks.slice(1).some((value) => value > 0)).map(([type, ranks]) => <div key={type}><dt>{text.moduleType(type)}</dt><dd>{text.moduleRate} {percent(ranks.slice(1).reduce((sum, value) => sum + value, 0))}<br />{[1, 2, 3].map((rank) => `${text.moduleRank(rank)} ${percent(ranks[rank] ?? 0)}`).join(' · ')}</dd></div>)}</dl></details>
}

function CandidateComparison({ model: m, data }: { model: Model; data: CultivationData }) {
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(50)
  const rows = useMemo(() => data.candidates.filter((row) => row.name.includes(search)).sort((a, b) => (b.weightedFrequency ?? b.frequency) - (a.weightedFrequency ?? a.frequency)), [data, search])
  return <><p className="v2-muted">{text.comparisonHint}</p><Field label={text.search} value={search} onChange={(event) => { setSearch(event.target.value); setVisible(50) }} /><div className="v2-candidate-list">{rows.slice(0, visible).map((row) => <article key={row.key}><Operator row={row} /><div><strong>{row.satisfied ? text.matched : row.warnings.length ? text.check : text.needsTraining}</strong><CultivationTraining row={row} />{row.source === 'community' && <small>{text.communityRate(row.communityRate ?? null)}</small>}<CultivationEvidence row={row} />{row.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}{m.appliedOptions.excluded.includes(row.operatorId) && <button className="v2-text-button" onClick={() => m.exclude(row.operatorId, false)}><RotateCcw size={14} />{text.excluded}</button>}</div></article>)}</div>{rows.length > visible && <button className="v2-button v2-button-secondary" onClick={() => setVisible(visible + 50)}>{text.showMore}</button>}</>
}

function SpecialItems({ data, preference }: Parameters<typeof useSpecialItems>[0]) {
  const m = useSpecialItems({ data, preference })
  return <><p className="v2-muted">{text.specialHint}</p>{!m.items.length ? <EmptyState title={text.noSpecialItems} /> : <div className="v2-special-items">{m.items.map((item) => <button key={item.id} aria-pressed={m.chosen === item.id} onClick={() => { m.setChosen(item.id); m.setVisible(8) }}><strong>{item.name}</strong><small>{text.itemStock(item.count)}{!item.available && ` · ${text.itemExpired}`}</small></button>)}</div>}{m.selected && <div key={m.selected.id} className="v2-special-detail"><h3>{m.selected.name}</h3><p>{m.selected.scope}</p><p>{text.specialConditions[m.selected.kind]}</p>{m.selected.expiresAt && <p>{text.expiry} {new Date(m.selected.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}<a className="v2-text-button" href={m.selected.sourceUrl} target="_blank" rel="noreferrer">{text.itemDetails}</a>{!m.selected.available ? <Notice>{text.itemExpired}</Notice> : !m.recommendations.length ? <EmptyState title={text.noItemUses} /> : <><h3>{text.specialRecommendations}</h3><ol className="v2-special-recommendations">{m.recommendations.slice(0, m.visible).map((row) => <li key={row.key}><strong>{row.name}{row.skill && ` · ${text.skillName(row.skill)} ◆◆◆`}</strong>{row.owned !== undefined && <small>{row.owned ? text.ownedOperator : text.newOperator}</small>}<small>{text.weightedDemand} {number(row.demand)} · {text.communityRate(row.communityRate)}</small></li>)}</ol>{m.recommendations.length > m.visible && <button className="v2-text-button" onClick={() => m.setVisible(m.visible + 16)}>{text.showMore}</button>}</>}</div>}{data.specialItemsUpdatedAt && <p className="v2-data-date">{text.specialDate} · {new Date(data.specialItemsUpdatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}</>
}
