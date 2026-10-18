import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { apiJson } from '../lib/api-client'
import { useSklandSnapshot } from '../hooks/useSklandSnapshot'
import { defaultCultivationQuery, type CultivationData, type CultivationOptions, type CultivationQuery } from '../lib/cultivation-contract'
import { recommendCultivationTargets } from '../lib/cultivation-planner'
import { useToolSession } from './tool/useToolSession'
import { v2Path } from './v2/navigation'
import CultivationResults, { number } from './cultivation/CultivationResults'
import CultivationSpecialItems from './cultivation/CultivationSpecialItems'
import CultivationFilters from './cultivation/CultivationFilters'

const label = copy.tools.cultivation

type PageProps = { embedded?: boolean; session?: ReturnType<typeof useToolSession> }

export default function CultivationPlanPage({ embedded = false, session }: PageProps = {}) {
  return session ? <CultivationContent session={session} embedded={embedded} /> : <StandaloneCultivation />
}

function StandaloneCultivation() {
  const session = useToolSession()
  return <CultivationContent session={session} />
}

export function useCultivation(session: ReturnType<typeof useToolSession>) {
  const profiles = session.profiles.filter((row) => row.status === 'active' && !row.archived_at && row.skland_binding)
  const [chosenProfile, setChosenProfile] = useState('')
  const profileId = profiles.some((row) => row.id === chosenProfile) ? chosenProfile : profiles.find((row) => row.id === session.activeProfile?.id)?.id ?? profiles[0]?.id ?? ''
  const snapshot = useSklandSnapshot(session.user?.id, profiles.find((row) => row.id === profileId))
  const calculatedVersion = useRef('')
  const [data, setData] = useState<CultivationData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryFromUrl = () => Object.fromEntries(Object.entries(defaultCultivationQuery).map(([key, fallback]) => {
    const value = searchParams.get(`cultivation_${key}`)
    return [key, value === null ? fallback : typeof fallback === 'boolean' ? value === 'true' : typeof fallback === 'number' ? Number(value) : value]
  })) as CultivationQuery
  const [options, setOptions] = useState<CultivationOptions>({ recommendation: queryFromUrl(), preference: 'coverage', limit: 5, excluded: [] })
  const [appliedOptions, setAppliedOptions] = useState(options)
  const [limit, setLimit] = useState('5')
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const recommendations = useMemo(() => data && !snapshot.expired ? recommendCultivationTargets(data, appliedOptions) : null, [data, appliedOptions, snapshot.expired])

  useEffect(() => {
    generation.current++
    calculatedVersion.current = ''
    request.current?.abort()
    setData(null)
    setError(null)
    setBusy(false)
    setOptions((value) => ({ ...value, excluded: [] }))
    setAppliedOptions((value) => ({ ...value, excluded: [] }))
    return () => { generation.current++; request.current?.abort() }
  }, [profileId])

  useEffect(() => {
    if (snapshot.available === false) {
      generation.current++
      request.current?.abort()
      setData(null)
      setBusy(false)
    }
  }, [snapshot.available])

  useEffect(() => {
    const next = queryFromUrl()
    setOptions((value) => JSON.stringify(value.recommendation) === JSON.stringify(next) ? value : { ...value, recommendation: next })
    // URL navigation restores the recommendation filters without reading the player's inventory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function load(recommendation = options.recommendation ?? defaultCultivationQuery, preserveSettings = false, refresh = true) {
    if (!profileId || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const run = ++generation.current
    setBusy(true)
    setError(null)
    try {
      if (refresh) await snapshot.refresh()
      if (controller.signal.aborted) return
      const result = await apiJson<CultivationData>('/api/cultivation-plan', { method: 'POST', json: { profile_id: profileId, recommendation }, signal: controller.signal, timeoutMs: 90000, fallbackMessage: label.failed })
      if (generation.current === run) {
        setData(result)
        setOptions((value) => ({ ...value, recommendation: preserveSettings ? value.recommendation : recommendation }))
        setAppliedOptions((value) => ({ ...value, recommendation }))
      }
    } catch (caught) {
      if (generation.current === run && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : label.failed)
    } finally { if (generation.current === run) setBusy(false) }
  }

  useEffect(() => {
    const version = snapshot.data?.version
    if (!version || busy || data?.snapshotVersion === version || calculatedVersion.current === `${profileId}:${version}`) return
    calculatedVersion.current = `${profileId}:${version}`
    void load(appliedOptions.recommendation ?? defaultCultivationQuery, true, false)
  }, [snapshot.data?.version, busy, profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const exclude = useCallback((id: string, remove: boolean) => {
    const update = (value: CultivationOptions) => ({ ...value, excluded: remove ? [...new Set([...value.excluded, id])] : value.excluded.filter((entry) => entry !== id) })
    setOptions(update)
    setAppliedOptions(update)
  }, [])

  const changed = JSON.stringify(options) !== JSON.stringify(appliedOptions) || limit !== String(appliedOptions.limit)

  function apply() {
    if (!limit.trim() || !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 30) {
      setError(label.invalidSettings)
      return
    }
    const next = { ...options, limit: Number(limit) }
    setError(null)
    setOptions(next)
    setAppliedOptions(next)
    setLimit(String(next.limit))
    const params = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(next.recommendation ?? defaultCultivationQuery)) {
      if (value === defaultCultivationQuery[key as keyof CultivationQuery]) params.delete(`cultivation_${key}`)
      else params.set(`cultivation_${key}`, String(value))
    }
    setSearchParams(params, { replace: true })
    if (data && JSON.stringify(next.recommendation) !== JSON.stringify(data.recommendation?.query ?? defaultCultivationQuery)) void load(next.recommendation, true, false)
  }

  return { profiles, profileId, setChosenProfile, data, busy: busy || snapshot.busy, error: error || snapshot.error || null, options, setOptions, appliedOptions,
    limit, setLimit, recommendations, load, exclude, changed, apply }
}

function CultivationContent({ session, embedded = false }: { session: ReturnType<typeof useToolSession>; embedded?: boolean }) {
  const ContentRoot = embedded ? 'div' : 'main'
  const { profiles, profileId, setChosenProfile, data, busy, error, options, setOptions, appliedOptions,
    limit, setLimit, recommendations, load, exclude, changed, apply } = useCultivation(session)
  const appliedQuery = appliedOptions.recommendation ?? defaultCultivationQuery

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
              <button className="tool-primary-action max-w-full whitespace-nowrap" disabled={busy} onClick={() => void load()}>{busy ? label.loadingData : copy.skland.refresh}</button>
            </div>}
        {error && <p role="alert" className="tool-alert tool-alert--warning p-3 text-sm">{error}</p>}
      </section>
      {data && recommendations && <>
        <dl className="workspace-cultivation-metrics grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries({ homeworks: data.stats.homeworks, owned: data.stats.owned, satisfied: data.candidates.filter((row) => row.satisfied).length, incomplete: data.stats.incomplete }).map(([key, value]) => <div key={key} className="tool-inset p-4"><dt className="text-xs text-ink-secondary">{label.stats[key as keyof typeof label.stats]}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{number(value)}</dd></div>)}</dl>
        {data.warnings.length > 0 && <ul className="tool-alert tool-alert--warning space-y-1 p-4 text-sm">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <details className="workspace-cultivation-options tool-panel px-4 py-2 sm:px-5">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">{label.parameters}<small className="ml-3 font-normal text-ink-muted">{appliedQuery.rarity ? label.rarityName(appliedQuery.rarity) : label.rarityGroups[appliedQuery.rarityGroup]} · {label.preferences[appliedOptions.preference]}</small></summary>
          <div className="space-y-4 pt-4 pb-2"><CultivationFilters query={options.recommendation ?? defaultCultivationQuery} data={data} onChange={(recommendation) => setOptions((value) => ({ ...value, recommendation }))} />
          <fieldset><legend className="mb-3 text-base font-semibold">{label.preference}</legend><div className="flex flex-wrap gap-2">{Object.entries(label.preferences).map(([key, text]) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${options.preference === key ? 'border-brand-500 bg-brand-500/10 text-ink-primary' : 'border-surface-3 text-ink-secondary'}`}><input type="radio" name="preference" value={key} checked={options.preference === key} onChange={() => setOptions((value) => ({ ...value, preference: key as CultivationOptions['preference'] }))} />{text}</label>)}</div><p className="mt-3 text-sm leading-6 text-ink-muted">{label.preferenceHints[options.preference]}</p></fieldset>
          {options.preference === 'community' && data.community?.status !== 'fresh' && <p role="status" className="text-sm text-warning">{data.community?.status === 'stale' ? label.communityStale : label.communityUnavailable}</p>}
          <label className="block space-y-2 text-sm"><span>{label.limit}</span><input type="number" min={1} max={30} className="tool-field" value={limit} onChange={(event) => setLimit(event.target.value)} /></label>
          <div className="flex flex-wrap items-center gap-3"><button type="button" className="tool-primary-action" disabled={busy} onClick={apply}>{label.apply}</button>{changed && <p role="status" className="text-sm text-ink-secondary">{label.settingsChanged}</p>}</div>
          </div>
        </details>
        <CultivationResults data={data} recommendations={recommendations} excluded={appliedOptions.excluded} exclude={exclude} projectScope={session.user ? { userId: session.user.id, profileId } : undefined} />
        <CultivationSpecialItems key={profileId} data={data} preference={appliedOptions.preference} />
        <p className="text-xs leading-5 text-ink-muted">{label.dataDate} · {new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br />{label.importDate} · {new Date(data.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
      </>}
    </ContentRoot>
  </div>
}
