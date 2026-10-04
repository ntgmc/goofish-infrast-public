import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { apiJson } from '../lib/api-client'
import type { CultivationCandidate, CultivationData, CultivationOptions } from '../lib/cultivation-contract'
import { buildCultivationPlan } from '../lib/cultivation-planner'
import { useToolSession } from './tool/useToolSession'

const label = copy.tools.cultivation
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)
const today = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)

function progress(row: CultivationCandidate, target = false) {
  return target ? label.targetProgress(row.target.elite, row.target.level, row.target.skill, row.target.skillLevel, row.target.moduleLevel)
    : label.progress(row.current.elite, row.current.level, row.current.skillLevel, row.target.skillLevel > 7 ? row.current.masteries[row.skillId] : undefined, row.target.moduleId ? row.current.modules[row.target.moduleId] ?? 0 : undefined)
}

export default function CultivationPlanPage() {
  const session = useToolSession()
  const profiles = session.profiles.filter((row) => row.status === 'active' && !row.archived_at && row.skland_binding)
  const [chosenProfile, setChosenProfile] = useState('')
  const profileId = profiles.some((row) => row.id === chosenProfile) ? chosenProfile : profiles.find((row) => row.id === session.activeProfile?.id)?.id ?? profiles[0]?.id ?? ''
  const [mode, setMode] = useState<'all' | 'normal' | 'challenge'>('all')
  const [data, setData] = useState<CultivationData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(50)
  const [options, setOptions] = useState<CultivationOptions>({ preference: 'coverage', dailySanity: 240, startDate: today(), days: 30, limit: 5, excluded: [], potions: {}, allOpen: false })
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const plan = useMemo(() => data ? buildCultivationPlan(data, options) : null, [data, options])
  const rows = data?.candidates.filter((row) => row.name.includes(search)).sort((a, b) => b.frequency - a.frequency) ?? []

  useEffect(() => {
    generation.current++
    request.current?.abort()
    setData(null)
    setError(null)
    setBusy(false)
    setOptions((value) => ({ ...value, potions: {}, excluded: [] }))
    return () => { generation.current++; request.current?.abort() }
  }, [profileId, mode])

  async function load() {
    if (!profileId || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const run = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const result = await apiJson<CultivationData>('/api/cultivation-plan', { method: 'POST', json: { profile_id: profileId, mode }, signal: controller.signal, timeoutMs: 90000, fallbackMessage: label.failed })
      if (generation.current === run) {
        setData(result)
        setOptions((value) => ({ ...value, potions: {} }))
      }
    } catch (caught) {
      if (generation.current === run && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : label.failed)
    } finally { if (generation.current === run) setBusy(false) }
  }

  const field = (key: 'dailySanity' | 'days' | 'limit', title: string, min: number, max: number) => <label className="block space-y-2 text-sm">
    <span>{title}</span><input type="number" min={min} max={max} className="tool-field" value={options[key]} onChange={(event) => {
      const value = event.target.valueAsNumber
      if (Number.isFinite(value)) setOptions((prior) => ({ ...prior, [key]: Math.max(min, Math.min(max, Math.floor(value))) }))
    }} />
  </label>

  return <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
    <header className="mb-8 flex items-center justify-between gap-3">
      <Link to="/tool/tools" aria-label={label.back}><BrandLogo /></Link>
      <div className="flex items-center gap-3"><Link to="/tool/tools" className="whitespace-nowrap text-sm text-ink-secondary hover:text-ink-primary">{label.back}</Link><ThemeSwitcher /></div>
    </header>
    <main className="space-y-6">
      <section className="tool-panel space-y-5 p-5 sm:p-6">
        <div><h1 className="text-2xl font-semibold text-ink-primary">{label.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{label.description}</p></div>
        {session.authLoading ? <p role="status">{label.loading}</p> : session.authStatus === 'error' ? <div role="alert"><p>{session.authError?.message}</p><button className="tool-secondary-action mt-3" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button></div>
          : session.authStatus !== 'authenticated' || !profiles.length ? <div className="tool-inset space-y-3 p-4"><p className="text-sm">{session.authStatus !== 'authenticated' ? label.login : label.noProfile}</p><Link to="/tool/profiles" className="tool-secondary-action inline-flex">{label.loginAction}</Link></div>
            : <div className="flex flex-wrap items-end gap-4">
              <label className="min-w-0 flex-1 space-y-2 text-sm"><span className="block">{label.profile}</span><select className="tool-field" value={profileId} onChange={(event) => setChosenProfile(event.target.value)}>{profiles.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}</select></label>
              <label className="space-y-2 text-sm"><span className="block">{label.mode}</span><select className="tool-field" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>{Object.entries(label.modes).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
              <button className="tool-primary-action max-w-full whitespace-nowrap" disabled={busy} onClick={() => void load()}>{busy ? label.loadingData : label.load}</button>
            </div>}
        {error && <p role="alert" className="tool-alert tool-alert--warning p-3 text-sm">{error}</p>}
      </section>
      {data && plan && <>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries({ homeworks: data.stats.homeworks, owned: data.stats.owned, satisfied: data.candidates.filter((row) => row.satisfied).length, incomplete: data.stats.incomplete }).map(([key, value]) => <div key={key} className="tool-inset p-4"><dt className="text-xs text-ink-secondary">{label.stats[key as keyof typeof label.stats]}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{number(value)}</dd></div>)}</dl>
        {data.warnings.length > 0 && <ul className="tool-alert tool-alert--warning space-y-1 p-4 text-sm">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <section className="tool-panel space-y-5 p-5 sm:p-6">
          <fieldset><legend className="mb-3 text-base font-semibold">{label.preference}</legend><div className="flex flex-wrap gap-2">{Object.entries(label.preferences).map(([key, text]) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${options.preference === key ? 'border-brand-500 bg-brand-500/10 text-ink-primary' : 'border-surface-3 text-ink-secondary'}`}><input type="radio" name="preference" value={key} checked={options.preference === key} onChange={() => setOptions((value) => ({ ...value, preference: key as CultivationOptions['preference'] }))} />{text}</label>)}</div><p className="mt-3 text-sm leading-6 text-ink-muted">{label.preferenceHints[options.preference]}</p></fieldset>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{field('dailySanity', label.daily, 0, 2000)}<label className="block space-y-2 text-sm"><span>{label.start}</span><input type="date" className="tool-field" value={options.startDate} onChange={(event) => setOptions((value) => ({ ...value, startDate: event.target.value }))} /></label>{field('days', label.days, 1, 180)}{field('limit', label.limit, 1, 30)}</div>
          <p className="text-xs leading-5 text-ink-muted">{label.dailyHint}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.allOpen} onChange={(event) => setOptions((value) => ({ ...value, allOpen: event.target.checked }))} />{label.allOpen}</label><p className="text-xs leading-5 text-ink-muted">{label.allOpenHint}</p>
          <details className="tool-inset p-4"><summary className="cursor-pointer text-sm font-medium">{label.potions}</summary><p className="my-3 text-xs leading-5 text-ink-muted">{label.potionHint}</p>{!data.potions.length ? <p className="text-sm text-ink-secondary">{label.noPotions}</p> : <div className="grid gap-4 sm:grid-cols-2">{data.potions.map((potion) => <label key={potion.key} className="space-y-2 text-sm"><span className="block font-medium">{potion.name}</span><span className="block text-xs text-ink-muted">{label.potionAmount(potion.count, potion.sanity)} · {potion.expiresAt ? `${label.expiry} ${new Date(potion.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : label.expiryUnknown}</span><input type="number" min={0} max={potion.count} className="tool-field" disabled={potion.sanity === null || Boolean(potion.expiresAt && Date.parse(potion.expiresAt) <= Date.now())} value={options.potions[potion.key] ?? 0} onChange={(event) => {
            const value = event.target.valueAsNumber
            if (Number.isFinite(value)) setOptions((prior) => ({ ...prior, potions: { ...prior.potions, [potion.key]: Math.max(0, Math.min(potion.count, Math.floor(value))) } }))
          }} />{potion.sanity === null && <span className="block text-xs text-warning">{label.potionUnknown}</span>}</label>)}</div>}</details>
        </section>
        <section className="tool-panel p-5 sm:p-6"><div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">{label.suggestions}</h2><p className="text-sm text-ink-secondary">{label.total} · {plan.totalSanity === null ? label.unpriced : number(plan.totalSanity)}</p></div><p className="my-3 text-xs leading-5 text-ink-muted">{label.adviceHint}</p>
          {!plan.selected.length ? <p className="py-4 text-sm text-ink-secondary">{label.empty}</p> : <ol className="divide-y divide-surface-3">{plan.selected.map(({ candidate: row, allocation, estimatedDate }, index) => <li key={row.key} className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div><div className="flex items-baseline gap-3"><span className="text-lg font-semibold tabular-nums text-brand-500">{index + 1}</span><h3 className="text-base font-semibold">{row.name}</h3><button className="ml-auto whitespace-nowrap text-xs text-ink-muted underline" onClick={() => setOptions((value) => ({ ...value, excluded: [...value.excluded, row.operatorId] }))}>{label.exclude}</button></div><p className="mt-2 text-xs text-ink-muted">{label.current} · {progress(row)}</p><p className="mt-1 text-sm">{label.target} · {progress(row, true)}</p><p className="mt-2 text-xs text-ink-secondary">{label.demand} {number(row.frequency)} · {label.stageCount} {row.stageCount}</p></div><div className="space-y-2 text-sm"><p>{label.cost} · <strong className="tabular-nums">{allocation.sanity === null ? label.unpriced : number(allocation.sanity)}</strong></p><p className="text-xs text-ink-secondary">{label.materialDate} · {estimatedDate ?? label.pending}</p><p className="text-xs leading-5 text-ink-muted">{Object.entries(allocation.missing).length ? Object.entries(allocation.missing).map(([id, count]) => `${data.itemNames[id] ?? id} × ${number(count)}`).join(' · ') : label.ready}</p><div className="flex flex-wrap gap-3">{row.examples.map((id) => <a key={id} className="text-xs text-brand-500 underline" href={`https://prts.maa.plus/copilot/${id}`} target="_blank" rel="noreferrer">{label.example} #{id}</a>)}</div></div></li>)}</ol>}
        </section>
        {plan.blocked.length > 0 && <section className="tool-alert tool-alert--warning space-y-3 p-5"><h2 className="font-semibold">{label.blocked}</h2><p className="text-xs leading-5">{label.blockedHint}</p><p className="text-sm">{plan.blocked.map((task) => `${data.itemNames[task.item] ?? task.item} × ${number(task.quantity)}`).join(' · ')}</p></section>}
        <section className="tool-panel p-5 sm:p-6"><h2 className="text-lg font-semibold">{label.calendar}</h2><p className="my-3 text-xs leading-5 text-ink-muted">{label.calendarHint}</p><div className="divide-y divide-surface-3">{plan.days.map((day) => <div key={day.date} className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><div><h3 className="text-sm font-semibold tabular-nums">{day.date}</h3><p className="mt-1 text-xs text-ink-muted">{label.budget(day.spent, day.budget)}</p></div><div className="space-y-2">{!day.farms.length && <p className="text-xs text-ink-muted">{label.noFarms}</p>}{day.farms.map((farm) => <p key={`${farm.item}:${farm.stage}`} className="text-sm">{farm.stage} · {data.itemNames[farm.item] ?? farm.item}<span className="ml-2 text-xs text-ink-secondary">{label.runs(farm.runs, number(farm.expectedQuantity))}</span></p>)}{day.potions.map((potion) => <p key={potion.name} className="text-xs text-ink-secondary">{potion.name} × {potion.count}</p>)}</div></div>)}</div>{plan.remaining.length > 0 && <div className="tool-inset mt-3 p-4"><h3 className="text-sm font-medium">{label.remaining}</h3><p className="mt-2 text-xs leading-5 text-ink-muted">{plan.remaining.map((task) => `${data.itemNames[task.item] ?? task.item} × ${number(task.remaining)}`).join(' · ')}</p></div>}</section>
        <details className="tool-panel p-5 sm:p-6"><summary className="cursor-pointer text-base font-semibold">{label.comparison}</summary><p className="my-3 text-xs leading-5 text-ink-muted">{label.comparisonHint}</p><label className="mb-4 block"><span className="sr-only">{label.search}</span><input className="tool-field" placeholder={label.search} value={search} onChange={(event) => { setSearch(event.target.value); setVisible(50) }} /></label><div className="divide-y divide-surface-3">{rows.slice(0, visible).map((row) => <div key={row.key} className="grid gap-2 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]"><div className="text-sm font-medium">{row.name}<span className="mt-1 block text-xs font-normal text-ink-muted">{row.satisfied ? label.matched : row.warnings.length ? label.check : label.needsTraining}</span></div><p className="text-xs leading-5 text-ink-secondary">{label.current} · {progress(row)}<br />{label.target} · {progress(row, true)}</p><div className="text-xs leading-5 text-ink-muted"><p>{label.demand} · {number(row.frequency)}</p>{row.warnings.map((warning) => <p key={warning} className="text-warning">{warning}</p>)}{options.excluded.includes(row.operatorId) && <button className="mt-1 underline" onClick={() => setOptions((value) => ({ ...value, excluded: value.excluded.filter((id) => id !== row.operatorId) }))}>{label.excluded}</button>}</div></div>)}</div>{rows.length > visible && <button className="tool-secondary-action mt-4" onClick={() => setVisible((value) => value + 50)}>{label.showMore}</button>}</details>
        <p className="text-xs leading-5 text-ink-muted">{label.dataDate} · {new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br />{label.importDate} · {new Date(data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
      </>}
    </main>
  </div>
}
