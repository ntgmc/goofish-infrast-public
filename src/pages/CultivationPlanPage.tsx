import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { apiJson } from '../lib/api-client'
import type { CultivationData, CultivationOptions } from '../lib/cultivation-contract'
import { buildCultivationPlan } from '../lib/cultivation-planner'
import { useToolSession } from './tool/useToolSession'
import { v2Path } from './v2/navigation'
import CultivationResults, { number } from './cultivation/CultivationResults'
import CultivationSpecialItems from './cultivation/CultivationSpecialItems'

const label = copy.tools.cultivation
const today = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)

type PageProps = { embedded?: boolean; session?: ReturnType<typeof useToolSession> }

export default function CultivationPlanPage({ embedded = false, session }: PageProps = {}) {
  return session ? <CultivationContent session={session} embedded={embedded} /> : <StandaloneCultivation />
}

function StandaloneCultivation() {
  const session = useToolSession()
  return <CultivationContent session={session} />
}

function CultivationContent({ session, embedded = false }: { session: ReturnType<typeof useToolSession>; embedded?: boolean }) {
  const ContentRoot = embedded ? 'div' : 'main'
  const profiles = session.profiles.filter((row) => row.status === 'active' && !row.archived_at && row.skland_binding)
  const [chosenProfile, setChosenProfile] = useState('')
  const profileId = profiles.some((row) => row.id === chosenProfile) ? chosenProfile : profiles.find((row) => row.id === session.activeProfile?.id)?.id ?? profiles[0]?.id ?? ''
  const [data, setData] = useState<CultivationData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<CultivationOptions>({ preference: 'coverage', dailySanity: 240, startDate: today(), days: 30, limit: 5, excluded: [], potions: {}, allOpen: false })
  const [appliedOptions, setAppliedOptions] = useState(options)
  const [numbers, setNumbers] = useState({ dailySanity: '240', days: '30', limit: '5' })
  const [potionNumbers, setPotionNumbers] = useState<Record<string, string>>({})
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const plan = useMemo(() => data ? buildCultivationPlan(data, appliedOptions) : null, [data, appliedOptions])

  useEffect(() => {
    generation.current++
    request.current?.abort()
    setData(null)
    setError(null)
    setBusy(false)
    setOptions((value) => ({ ...value, potions: {}, excluded: [] }))
    setAppliedOptions((value) => ({ ...value, potions: {}, excluded: [] }))
    setPotionNumbers({})
    return () => { generation.current++; request.current?.abort() }
  }, [profileId])

  async function load() {
    if (!profileId || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const run = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const result = await apiJson<CultivationData>('/api/cultivation-plan', { method: 'POST', json: { profile_id: profileId }, signal: controller.signal, timeoutMs: 90000, fallbackMessage: label.failed })
      if (generation.current === run) {
        setData(result)
        setOptions((value) => ({ ...value, potions: {} }))
        setAppliedOptions((value) => ({ ...value, potions: {} }))
        setPotionNumbers({})
      }
    } catch (caught) {
      if (generation.current === run && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : label.failed)
    } finally { if (generation.current === run) setBusy(false) }
  }

  const exclude = useCallback((id: string, remove: boolean) => {
    const update = (value: CultivationOptions) => ({ ...value, excluded: remove ? [...new Set([...value.excluded, id])] : value.excluded.filter((entry) => entry !== id) })
    setOptions(update)
    setAppliedOptions(update)
  }, [])

  const changed = JSON.stringify(options) !== JSON.stringify(appliedOptions) || Object.entries(numbers).some(([key, value]) => value !== String(appliedOptions[key as keyof typeof numbers])) || Object.entries(potionNumbers).some(([key, value]) => Number(value) !== (appliedOptions.potions[key] ?? 0))

  function apply() {
    const numeric = { dailySanity: Number(numbers.dailySanity), days: Number(numbers.days), limit: Number(numbers.limit) }
    const bounds = { dailySanity: [0, 2000], days: [1, 180], limit: [1, 30] }
    if (Object.entries(numeric).some(([key, value]) => !numbers[key as keyof typeof numbers].trim() || !Number.isInteger(value) || value < bounds[key as keyof typeof bounds][0] || value > bounds[key as keyof typeof bounds][1]) || !Number.isFinite(Date.parse(options.startDate + 'T04:00:00+08:00')) || Object.entries(potionNumbers).some(([key, value]) => !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > (data?.potions.find((potion) => potion.key === key)?.count ?? 0))) {
      setError(label.invalidSettings)
      return
    }
    const next = { ...options, ...numeric, potions: Object.fromEntries((data?.potions ?? []).map((potion) => [potion.key, Math.max(0, Math.min(potion.count, Math.floor(Number(potionNumbers[potion.key] ?? 0) || 0)))])) }
    setError(null)
    setOptions(next)
    setAppliedOptions(next)
    setNumbers({ dailySanity: String(numeric.dailySanity), days: String(numeric.days), limit: String(numeric.limit) })
    setPotionNumbers(Object.fromEntries(Object.entries(next.potions).map(([key, value]) => [key, String(value)])))
  }

  const field = (key: 'dailySanity' | 'days' | 'limit', title: string, min: number, max: number) => <label className="block space-y-2 text-sm">
    <span>{title}</span><input type="number" min={min} max={max} className="tool-field" value={numbers[key]} onChange={(event) => setNumbers((prior) => ({ ...prior, [key]: event.target.value }))} />
  </label>

  return <div className={embedded ? 'v2-embedded-tool' : 'mx-auto max-w-7xl px-4 py-6 sm:px-6'}>
    {!embedded && <header className="mb-8 flex items-center justify-between gap-3">
      <Link to="/tool/tools" aria-label={label.back}><BrandLogo /></Link>
      <div className="flex items-center gap-3"><Link to="/tool/tools" className="whitespace-nowrap text-sm text-ink-secondary hover:text-ink-primary">{label.back}</Link><ThemeSwitcher /></div>
    </header>}
    <ContentRoot className="workspace-cultivation space-y-6">
      <section className="workspace-cultivation-source tool-panel space-y-5 p-5 sm:p-6">
        <div>{!embedded && <h1 className="text-2xl font-semibold text-ink-primary">{label.title}</h1>}<p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{label.description}</p></div>
        {session.authLoading ? <p role="status">{label.loading}</p> : session.authStatus === 'error' ? <div role="alert"><p>{session.authError?.message}</p><button className="tool-secondary-action mt-3" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button></div>
          : session.authStatus !== 'authenticated' || !profiles.length ? <div className="tool-inset space-y-3 p-4"><p className="text-sm">{session.authStatus !== 'authenticated' ? label.login : label.noProfile}</p><Link to={embedded ? v2Path('profiles', session.activeProfile?.id) : '/tool/profiles'} className="tool-secondary-action inline-flex">{label.loginAction}</Link></div>
            : <div className="flex flex-wrap items-end gap-4">
              <label className="min-w-0 flex-1 space-y-2 text-sm"><span className="block">{label.profile}</span><select className="tool-field" value={profileId} onChange={(event) => setChosenProfile(event.target.value)}>{profiles.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}</select></label>
              <button className="tool-primary-action max-w-full whitespace-nowrap" disabled={busy} onClick={() => void load()}>{busy ? label.loadingData : label.load}</button>
            </div>}
        {error && <p role="alert" className="tool-alert tool-alert--warning p-3 text-sm">{error}</p>}
      </section>
      {data && plan && <>
        <dl className="workspace-cultivation-metrics grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries({ homeworks: data.stats.homeworks, owned: data.stats.owned, satisfied: data.candidates.filter((row) => row.satisfied).length, incomplete: data.stats.incomplete }).map(([key, value]) => <div key={key} className="tool-inset p-4"><dt className="text-xs text-ink-secondary">{label.stats[key as keyof typeof label.stats]}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{number(value)}</dd></div>)}</dl>
        {data.warnings.length > 0 && <ul className="tool-alert tool-alert--warning space-y-1 p-4 text-sm">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <section className="workspace-cultivation-options tool-panel space-y-5 p-5 sm:p-6">
          <fieldset><legend className="mb-3 text-base font-semibold">{label.preference}</legend><div className="flex flex-wrap gap-2">{Object.entries(label.preferences).map(([key, text]) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${options.preference === key ? 'border-brand-500 bg-brand-500/10 text-ink-primary' : 'border-surface-3 text-ink-secondary'}`}><input type="radio" name="preference" value={key} checked={options.preference === key} onChange={() => setOptions((value) => ({ ...value, preference: key as CultivationOptions['preference'] }))} />{text}</label>)}</div><p className="mt-3 text-sm leading-6 text-ink-muted">{label.preferenceHints[options.preference]}</p></fieldset>
          {options.preference === 'community' && data.community?.status !== 'fresh' && <p role="status" className="text-sm text-warning">{data.community?.status === 'stale' ? label.communityStale : label.communityUnavailable}</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{field('dailySanity', label.daily, 0, 2000)}<label className="block space-y-2 text-sm"><span>{label.start}</span><input type="date" className="tool-field" value={options.startDate} onChange={(event) => setOptions((value) => ({ ...value, startDate: event.target.value }))} /></label>{field('days', label.days, 1, 180)}{field('limit', label.limit, 1, 30)}</div>
          <p className="text-xs leading-5 text-ink-muted">{label.dailyHint}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.allOpen} onChange={(event) => setOptions((value) => ({ ...value, allOpen: event.target.checked }))} />{label.allOpen}</label><p className="text-xs leading-5 text-ink-muted">{label.allOpenHint}</p>
          <details className="tool-inset p-4"><summary className="cursor-pointer text-sm font-medium">{label.potions}</summary><p className="my-3 text-xs leading-5 text-ink-muted">{label.potionHint}</p>{!data.potions.length ? <p className="text-sm text-ink-secondary">{label.noPotions}</p> : <div className="grid gap-4 sm:grid-cols-2">{data.potions.map((potion) => <label key={potion.key} className="space-y-2 text-sm"><span className="block font-medium">{potion.name}</span><span className="block text-xs text-ink-muted">{label.potionAmount(potion.count, potion.sanity)} · {potion.expiresAt ? `${label.expiry} ${new Date(potion.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : label.expiryUnknown}</span><input type="number" min={0} max={potion.count} className="tool-field" disabled={potion.sanity === null || Boolean(potion.expiresAt && Date.parse(potion.expiresAt) <= Date.now())} value={potionNumbers[potion.key] ?? '0'} onChange={(event) => setPotionNumbers((prior) => ({ ...prior, [potion.key]: event.target.value }))} />{potion.sanity === null && <span className="block text-xs text-warning">{label.potionUnknown}</span>}</label>)}</div>}</details>
          <div className="flex flex-wrap items-center gap-3"><button type="button" className="tool-primary-action" onClick={apply}>{label.apply}</button>{changed && <p role="status" className="text-sm text-ink-secondary">{label.settingsChanged}</p>}</div>
        </section>
        <CultivationResults data={data} plan={plan} excluded={appliedOptions.excluded} exclude={exclude} />
        <CultivationSpecialItems key={profileId} data={data} plan={plan} preference={appliedOptions.preference} />
        <p className="text-xs leading-5 text-ink-muted">{label.dataDate} · {new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br />{label.importDate} · {new Date(data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
      </>}
    </ContentRoot>
  </div>
}
