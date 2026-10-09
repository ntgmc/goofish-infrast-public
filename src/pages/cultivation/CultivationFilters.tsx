import { useId, useState } from 'react'
import { copy } from '../../copy'
import type { CultivationData, CultivationQuery } from '../../lib/cultivation-contract'

const text = copy.tools.cultivation
const professionNames: Record<string, string> = text.professions

function SearchChoice({ label, options, value, onChange, v2 }: { label: string; options: Array<{ id: string; name: string }>; value: string; onChange: (value: string) => void; v2: boolean }) {
  const id = useId()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const words = search.trim().toLowerCase().split(/\s+/)
  const matched = options.filter((option) => words.every((word) => `${option.name} ${option.id}`.toLowerCase().includes(word)))
  const rows = [...(search.trim() ? [] : [{ id: '', name: text.all }]), ...matched.slice(0, 50)]
  const choose = (next: string) => { onChange(next); setOpen(false); setSearch(''); setActive(0) }
  return <div className={`relative min-w-0 ${v2 ? 'v2-field' : 'space-y-2 text-sm'}`}>
    <label htmlFor={id}>{label}</label>
    <div className="relative"><input id={id} className={`${v2 ? 'v2-input' : 'tool-field'} pr-12`} role="combobox" autoComplete="off" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && rows[active] ? `${id}-${active}` : undefined}
      value={open ? search : options.find((row) => row.id === value)?.name ?? value} placeholder={text.all} onFocus={() => { setOpen(true); setSearch(''); setActive(0) }}
      onChange={(event) => { setSearch(event.target.value); setOpen(true); setActive(0) }} onBlur={() => setOpen(false)} onClick={() => { if (!open) { setOpen(true); setSearch(''); setActive(0) } }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive((prior) => Math.max(0, Math.min(rows.length - 1, prior + (event.key === 'ArrowDown' ? 1 : -1)))) }
        if (event.key === 'Enter' && open) { event.preventDefault(); if (rows[active]) choose(rows[active].id) }
      }} />
    {value && <button type="button" className="absolute top-0 right-0 min-h-11 w-11 text-xl text-ink-secondary" aria-label={text.clearFilter(label)} onClick={() => choose('')}>×</button>}
    {open && <div className="absolute inset-x-0 top-full z-20 max-h-72 overflow-y-auto border border-surface-3 bg-surface-1 shadow-lg">
      <ul id={`${id}-list`} role="listbox" aria-label={label}>{rows.map((row, index) => <li key={row.id} id={`${id}-${index}`} role="option" aria-selected={row.id === value} className={`min-h-11 cursor-pointer px-3 py-3 text-sm break-words ${index === active ? 'bg-surface-2' : ''}`} onMouseDown={(event) => { event.preventDefault(); choose(row.id) }}>{row.name}{row.id && row.name !== row.id && <small className="ml-2 text-ink-muted">{row.id}</small>}</li>)}</ul>
      {matched.length > 50 && <p className="px-3 py-2 text-xs text-ink-muted">{text.narrowSearch}</p>}{!matched.length && <p className="px-3 py-2 text-xs">{text.noMatches}</p>}
    </div>}</div>
  </div>
}

export default function CultivationFilters({ query, data, onChange, v2 = false }: { query: CultivationQuery; data: CultivationData; onChange: (query: CultivationQuery) => void; v2?: boolean }) {
  const update = <K extends keyof CultivationQuery>(key: K, value: CultivationQuery[K]) => onChange({ ...query, [key]: value })
  const stages = (data.recommendation?.stages ?? []).filter((row) => !query.activity || row.activity === query.activity)
  const activities = [...new Set((data.recommendation?.stages ?? []).map((row) => row.activity))].sort()
  const fieldClass = v2 ? 'v2-field' : 'block space-y-2 text-sm'
  const inputClass = v2 ? 'v2-input' : 'tool-field'
  const select = (label: string, key: 'scope' | 'days' | 'coverage' | 'category' | 'profession' | 'rarity', rows: Array<[string | number, string]>) => <label className={fieldClass}><span>{label}</span><select className={inputClass} value={query[key]} onChange={(event) => onChange({ ...query, [key]: ['days', 'coverage', 'rarity'].includes(key) ? Number(event.target.value) : event.target.value })}>{rows.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
  const grid = 'grid min-w-0 gap-4 @sm:grid-cols-2 @lg:grid-cols-3'
  return <fieldset className="@container col-span-full min-w-0 space-y-4"><legend className="mb-3 font-semibold">{text.recommendationFilters}</legend>
    <div className={grid}>
      {select(text.scope, 'scope', Object.entries(text.scopes))}
      {select(text.timeWindow, 'days', [[90, text.recentDays(90)], [180, text.recentDays(180)], [365, text.recentDays(365)], [0, text.allTime]])}
      {select(text.coverage, 'coverage', [[0.6, text.coverages.basic], [0.8, text.coverages.practical], [0.9, text.coverages.high]])}
    </div>
    <details className={v2 ? 'v2-disclosure' : 'space-y-4'} open={Boolean(query.stageId || query.activity || query.category || query.profession || query.rarity || query.search)}><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{text.moreFilters}</summary><div className={grid}>
      <SearchChoice label={text.activity} options={activities.map((name) => ({ id: name, name }))} value={query.activity} v2={v2} onChange={(activity) => onChange({ ...query, activity, stageId: '' })} />
      <SearchChoice label={text.stage} options={stages} value={query.stageId} v2={v2} onChange={(value) => update('stageId', value)} />
      {select(text.category, 'category', [['', text.all], ...[...new Set(stages.map((row) => row.category))].sort().map((name): [string, string] => [name, name])])}
      {select(text.profession, 'profession', [['', text.all], ...(data.recommendation?.professions ?? []).map((id): [string, string] => [id, professionNames[id] ?? id])])}
      {select(text.rarity, 'rarity', [[0, text.all], ...[1, 2, 3, 4, 5, 6].map((value): [number, string] => [value, text.rarityName(value)])])}
      <label className={fieldClass}><span>{text.search}</span><input className={inputClass} value={query.search} onChange={(event) => update('search', event.target.value)} /></label>
    </div></details>
    <div className="flex flex-wrap gap-4">{(['includeClosed', 'includeAlternatives', 'includeUncertain'] as const).map((key) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={query[key]} onChange={(event) => update(key, event.target.checked)} />{text[key]}</label>)}</div>
    <p className={v2 ? 'v2-muted' : 'text-xs leading-5 text-ink-muted'}>{text.recommendationHint}</p>
  </fieldset>
}
