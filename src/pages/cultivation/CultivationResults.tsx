import { memo, useMemo, useState } from 'react'
import { ExternalLink, RotateCcw, X } from 'lucide-react'
import { copy } from '../../copy/index'
import type { CultivationCandidate, CultivationData } from '../../lib/cultivation-contract'
import type { buildCultivationPlan } from '../../lib/cultivation-planner'

const label = copy.tools.cultivation
export const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)

function progress(row: CultivationCandidate, target = false) {
  return target ? label.targetProgress(row.target.elite, row.target.level, row.target.skill, row.target.skillLevel, row.target.moduleLevel)
    : label.progress(row.current.elite, row.current.level, row.target.skill, row.current.skillLevel, row.current.masteries[row.skillId], row.target.moduleId ? row.current.modules[row.target.moduleId] ?? 0 : undefined)
}

function Operator({ row, data }: { row: CultivationCandidate; data: CultivationData }) {
  return <div className="flex items-center gap-3">
    <img src={`/webp96/${encodeURIComponent(row.operatorId)}.webp`} alt="" width={48} height={48} loading="lazy" className="size-12 rounded-lg bg-surface-2 object-cover" />
    <div className="min-w-0"><h3 className="text-base font-semibold">{row.name}</h3>
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
        {row.skillId && <img src={`https://torappu.prts.wiki/assets/skill_icon/skill_icon_${encodeURIComponent(data.skillIcons?.[row.skillId] ?? row.skillId)}.png`} alt="" width={24} height={24} loading="lazy" className="size-6 rounded object-contain" />}
        <span>{label.skillName(row.target.skill)}</span>{row.target.skillLevel > 7 && <span aria-label={label.masteryName(row.target.skillLevel - 7)} className="rounded bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-500">{'◆'.repeat(row.target.skillLevel - 7)}</span>}
      </div>
    </div>
  </div>
}

function Materials({ items, data }: { items: Record<string, number>; data: CultivationData }) {
  return Object.keys(items).length ? <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(items).map(([id, count]) =>
    <li key={id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">{data.itemNames[id] ?? id}<strong className="float-right ml-2 tabular-nums">{number(count)}</strong></li>)}</ul> : <p className="text-sm text-ink-secondary">{label.ready}</p>
}

function Statistics({ row, data }: { row: CultivationCandidate; data: CultivationData }) {
  const statistics = data.community?.operators[row.operatorId]
  if (!statistics) return null
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  return <details className="tool-inset mt-3 p-3 text-xs">
    <summary className="cursor-pointer font-medium">{label.communityTitle} · {label.eliteRate} {percent(statistics.elite[2])}</summary>
    <p className="mt-3 text-ink-secondary">{label.communitySample(statistics.owned)}</p>
    <dl className="mt-3 space-y-2">{statistics.skills.map((skill, index) => <div key={index} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><dt>{label.skillName(index + 1)}</dt><dd>{[1, 2, 3].map((rank) => `${label.masteryName(rank)} ${percent(skill[rank] ?? 0)}`).join(' · ')}</dd></div>)}
      {Object.entries(statistics.modules).filter(([_type, ranks]) => ranks.slice(1).some((value) => value > 0)).map(([type, ranks]) => <div key={type} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><dt>{label.moduleType(type)}</dt><dd>{label.moduleRate} {percent(ranks.slice(1).reduce((sum, value) => sum + value, 0))}<br />{[1, 2, 3].map((rank) => `${label.moduleRank(rank)} ${percent(ranks[rank] ?? 0)}`).join(' · ')}</dd></div>)}
    </dl>
  </details>
}

type Props = { data: CultivationData; plan: ReturnType<typeof buildCultivationPlan>; excluded: string[]; exclude: (id: string, excluded: boolean) => void }

export default memo(function CultivationResults({ data, plan, excluded, exclude }: Props) {
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(50)
  const rows = useMemo(() => data.candidates.filter((row) => row.name.includes(search)).sort((a, b) => b.frequency - a.frequency), [data, search])
  return <>
    <section className="workspace-cultivation-suggestions tool-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">{label.suggestions}</h2><p className="text-sm text-ink-secondary">{label.total} · {plan.totalSanity === null ? label.unpriced : number(plan.totalSanity)}</p></div>
      <p className="my-3 text-xs leading-5 text-ink-muted">{label.adviceHint}</p>
      {!plan.selected.length ? <p className="py-4 text-sm text-ink-secondary">{label.empty}</p> : <ol className="divide-y divide-surface-3">
        {plan.selected.map(({ candidate: row, allocation, estimatedDate }, index) => <li key={row.key} className="grid gap-4 py-5 lg:grid-cols-2">
          <div><div className="flex flex-wrap items-start gap-3"><span className="pt-2 text-lg font-semibold tabular-nums text-brand-500">{index + 1}</span><Operator row={row} data={data} />
            <button type="button" className="tool-secondary-action ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs" onClick={() => exclude(row.operatorId, true)}><X size={14} />{label.exclude}</button>
          </div><p className="mt-3 text-xs text-ink-muted">{label.current} · {progress(row)}</p>
            <p className="mt-1 text-sm">{row.source === 'community' ? label.communityTarget : label.target} · {progress(row, true)}</p>
            {row.moduleName && <p className="mt-1 text-xs text-ink-secondary">{row.moduleName} · {label.moduleRank(row.target.moduleLevel)}</p>}
            <p className="mt-2 text-xs text-ink-secondary">{row.source === 'community' ? label.communityRate(row.communityRate ?? null) : `${label.demand} ${number(row.frequency)} · ${label.stageCount} ${row.stageCount}`}</p>
            <Statistics row={row} data={data} />
          </div>
          <div className="space-y-3 text-sm"><p>{label.cost} · <strong className="tabular-nums">{allocation.sanity === null ? label.unpriced : number(allocation.sanity)}</strong></p>
            <p className="text-xs text-ink-secondary">{label.materialDate} · {estimatedDate ?? label.pending}</p>
            <p className="text-xs leading-5 text-ink-muted">{Object.keys(allocation.missing).length ? Object.entries(allocation.missing).map(([id, count]) => `${data.itemNames[id] ?? id} × ${number(count)}`).join(' · ') : label.ready}</p>
            {allocation.exchanges.map((exchange) => <p key={exchange.item} className="tool-inset p-2 text-xs">{label.exchange} · {label.exchangeAmount(exchange.count, exchange.cost)}</p>)}
            <div className="flex flex-wrap gap-2">{row.examples.map((id) => <a key={id} className="tool-secondary-action inline-flex items-center gap-1.5 text-xs" href={`https://prts.plus/?op=${id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} />{label.example} #{id}</a>)}</div>
          </div>
        </li>)}
      </ol>}
    </section>
    <section className="workspace-cultivation-summary tool-panel space-y-4 p-5 sm:p-6"><h2 className="text-lg font-semibold">{label.summary}</h2>
      <div className="grid gap-4 sm:grid-cols-2"><div className="tool-inset p-4"><p className="text-sm text-ink-secondary">{label.totalTraining}</p><strong className="mt-2 block text-2xl tabular-nums">{plan.totalTrainingSanity === null ? label.unpriced : number(plan.totalTrainingSanity)}</strong></div><div className="tool-inset p-4"><p className="text-sm text-ink-secondary">{label.total}</p><strong className="mt-2 block text-2xl tabular-nums">{plan.totalSanity === null ? label.unpriced : number(plan.totalSanity)}</strong></div></div>
      <h3 className="text-sm font-medium">{label.totalMaterials}</h3><Materials items={plan.totalMaterials} data={data} />
      <h3 className="text-sm font-medium">{label.missingMaterials}</h3><Materials items={plan.missingMaterials} data={data} />
    </section>
    {plan.blocked.length > 0 && <section className="tool-alert tool-alert--warning space-y-3 p-5"><h2 className="font-semibold">{label.blocked}</h2><p className="text-xs leading-5">{label.blockedHint}</p><Materials items={Object.fromEntries(plan.blocked.map((task) => [task.item, plan.missingMaterials[task.item]]))} data={data} /></section>}
    <section className="workspace-cultivation-calendar tool-panel p-5 sm:p-6"><h2 className="text-lg font-semibold">{label.calendar}</h2><p className="my-3 text-xs leading-5 text-ink-muted">{label.calendarHint}</p>
      <div className="divide-y divide-surface-3">{plan.days.map((day) => <div key={day.date} className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><div><h3 className="text-sm font-semibold tabular-nums">{day.date}</h3><p className="mt-1 text-xs text-ink-muted">{label.budget(day.spent, day.budget)}</p></div><div className="space-y-2">{!day.farms.length && <p className="text-xs text-ink-muted">{label.noFarms}</p>}{day.farms.map((farm) => <p key={`${farm.item}:${farm.stage}`} className="text-sm">{farm.stage} · {data.itemNames[farm.item] ?? farm.item}<span className="ml-2 text-xs text-ink-secondary">{label.runs(farm.runs, number(farm.expectedQuantity))}</span></p>)}{day.potions.map((potion) => <p key={potion.name} className="text-xs text-ink-secondary">{potion.name} × {potion.count}</p>)}</div></div>)}</div>
      {plan.remaining.length > 0 && <div className="tool-inset mt-3 p-4"><h3 className="text-sm font-medium">{label.remaining}</h3><p className="mt-2 text-xs leading-5 text-ink-muted">{plan.remaining.map((task) => `${data.itemNames[task.item] ?? task.item} × ${number(task.remaining)}`).join(' · ')}</p></div>}
    </section>
    <details className="tool-panel p-5 sm:p-6"><summary className="cursor-pointer text-base font-semibold">{label.comparison}</summary><p className="my-3 text-xs leading-5 text-ink-muted">{label.comparisonHint}</p>
      <label className="mb-4 block"><span className="sr-only">{label.search}</span><input className="tool-field" placeholder={label.search} value={search} onChange={(event) => { setSearch(event.target.value); setVisible(50) }} /></label>
      <div className="divide-y divide-surface-3">{rows.slice(0, visible).map((row) => <div key={row.key} className="grid gap-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]"><div><Operator row={row} data={data} /><span className="mt-1 block text-xs text-ink-muted">{row.satisfied ? label.matched : row.warnings.length ? label.check : label.needsTraining}</span></div><p className="text-xs leading-5 text-ink-secondary">{label.current} · {progress(row)}<br />{row.source === 'community' ? label.communityTarget : label.target} · {progress(row, true)}{row.moduleName && <span className="block">{row.moduleName}</span>}</p><div className="text-xs leading-5 text-ink-muted"><p>{row.source === 'community' ? label.communityRate(row.communityRate ?? null) : `${label.demand} · ${number(row.frequency)}`}</p>{row.warnings.map((warning) => <p key={warning} className="text-warning">{warning}</p>)}{excluded.includes(row.operatorId) && <button type="button" className="tool-secondary-action mt-2 inline-flex items-center gap-1.5 text-xs" onClick={() => exclude(row.operatorId, false)}><RotateCcw size={14} />{label.excluded}</button>}</div></div>)}</div>
      {rows.length > visible && <button type="button" className="tool-secondary-action mt-4" onClick={() => setVisible((value) => value + 50)}>{label.showMore}</button>}
    </details>
  </>
})
