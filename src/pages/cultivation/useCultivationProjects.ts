import { useEffect, useMemo, useRef, useState } from 'react'
import { copy } from '../../copy'
import { apiJson } from '../../lib/api-client'
import { useSklandSnapshot } from '../../hooks/useSklandSnapshot'
import type { CultivationData } from '../../lib/cultivation-contract'
import { allocateProjectMaterials, buildProjectRoute, projectDaysEarlier, readProjectIncome, validProjectDate, type CultivationProject } from '../../lib/cultivation-projects'
import { readCultivationProjects, saveCultivationProjects, subscribeCultivationProjects } from '../../lib/cultivation-project-import'
import type { UserGameAccount, WorkspaceResultHistoryItem } from '../../lib/types'
import { fetchResultHistoryDetail } from '../tool/optimize/optimization-api'
import type { V2Session } from '../v2/OptionsDrawer'

const text = copy.cultivationProjects

export function useCultivationProjects(session: V2Session, profile: UserGameAccount) {
  const userId = session.user!.id
  const scope = { userId, profileId: profile.id }
  const [projects, setProjectState] = useState<CultivationProject[]>(() => {
    try { return readCultivationProjects(scope) } catch { return [] }
  })
  const projectRef = useRef(projects)
  const [storageError, setStorageError] = useState(false)
  useEffect(() => subscribeCultivationProjects({ userId, profileId: profile.id }, () => {
    try {
      const next = readCultivationProjects({ userId, profileId: profile.id })
      projectRef.current = next
      setProjectState(next)
      setStorageError(false)
    } catch { setStorageError(true) }
  }), [userId, profile.id])
  function setProjects(update: CultivationProject[] | ((rows: CultivationProject[]) => CultivationProject[])) {
    const next = typeof update === 'function' ? update(projectRef.current) : update
    projectRef.current = next
    setProjectState(next)
    try { saveCultivationProjects(scope, next); setStorageError(false) }
    catch { setStorageError(true) }
  }
  const snapshot = useSklandSnapshot(userId, profile)
  const calculatedVersion = useRef('')
  const [data, setData] = useState<CultivationData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dailySanity, setDailySanity] = useState('240')
  const [startDate, setStartDate] = useState(() => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10))
  const [allOpen, setAllOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (snapshot.available === false) { request.current?.abort(); setData(null); setBusy(false) }
  }, [snapshot.available])
  const history = session.workspace?.profile_id === profile.id ? session.workspace.result_history.filter((row) => row.source !== 'manual') : []
  const [normalId, setNormalId] = useState(history[0]?.id ?? '')
  const [temporaryId, setTemporaryId] = useState('')
  const [production, setProduction] = useState<{ key: string; normal: WorkspaceResultHistoryItem | null; temporary: WorkspaceResultHistoryItem | null; error?: string } | null>(null)
  const [productionRetry, setProductionRetry] = useState(0)
  const productionKey = `${normalId}:${temporaryId}:${productionRetry}`
  useEffect(() => {
    const controller = new AbortController()
    const detail = (id: string) => id ? fetchResultHistoryDetail(profile.id, id, controller.signal) : Promise.resolve(null)
    void Promise.all([detail(normalId), detail(temporaryId)]).then(([normal, temporary]) => {
      if (!controller.signal.aborted) setProduction({ key: productionKey, normal, temporary })
    }).catch((caught) => {
      if (!controller.signal.aborted) setProduction({ key: productionKey, normal: null, temporary: null, error: caught instanceof Error ? caught.message : text.incomeFailed })
    })
    return () => controller.abort()
  }, [profile.id, normalId, temporaryId, productionKey])
  const currentProduction = production?.key === productionKey ? production : null
  const normalIncome = readProjectIncome(currentProduction?.normal?.result.daily_production)
  const temporaryIncome = readProjectIncome(currentProduction?.temporary?.result.daily_production)
  const productionInvalid = !currentProduction || Boolean(currentProduction.error) || Boolean(normalId && !normalIncome || temporaryId && !temporaryIncome)
  const validSettings = dailySanity.trim() !== '' && Number.isInteger(Number(dailySanity)) && Number(dailySanity) >= 0 && Number(dailySanity) <= 2000 && validProjectDate(startDate)
  const settings = { dailySanity: Number(dailySanity), startDate, days: 180, allOpen }
  const plans = useMemo(() => {
    if (!data || snapshot.expired || !validSettings || productionInvalid) return null
    const baseline = buildProjectRoute(data, projects, settings, normalIncome)
    const alternative = temporaryIncome ? buildProjectRoute(data, projects, settings, normalIncome, temporaryIncome) : null
    const gain = alternative ? projectDaysEarlier(baseline.rows[0]?.estimatedDate ?? null, alternative.rows[0]?.estimatedDate ?? null) : null
    const useTemporary = Boolean(alternative?.rows[0]?.estimatedDate && (!baseline.rows[0]?.estimatedDate || gain !== null && gain > 0))
    const route = useTemporary ? alternative! : baseline
    const pauseGains = Object.fromEntries(projects.filter((row) => !row.paused).slice(1).map((project) => {
      const paused = projects.map((row) => row.operatorId === project.operatorId ? { ...row, paused: true } : row)
      const without = buildProjectRoute(data, paused, settings, normalIncome)
      const changed = temporaryIncome ? buildProjectRoute(data, paused, settings, normalIncome, temporaryIncome) : null
      const earlier = changed?.rows[0]?.estimatedDate && (!without.rows[0]?.estimatedDate || changed.rows[0].estimatedDate < without.rows[0].estimatedDate) ? changed : without
      return [project.operatorId, projectDaysEarlier(route.rows[0]?.estimatedDate ?? null, earlier.rows[0]?.estimatedDate ?? null)]
    }))
    return { baseline, alternative, gain, route, pauseGains, useTemporary }
    // Settings and income objects are small values; use their contents to avoid repeating simulations on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, projects, validSettings, productionInvalid, dailySanity, startDate, allOpen, production, snapshot.expired])
  const materials = useMemo(() => data && !snapshot.expired ? allocateProjectMaterials(data, projects) : [], [data, projects, snapshot.expired])
  const pendingRefresh = materials.some((row) => !row.candidate)

  async function load(nextProjects = projectRef.current, refresh = true) {
    if (busy) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(null)
    try {
      if (refresh) await snapshot.refresh()
      if (controller.signal.aborted) return
      const result = await apiJson<CultivationData>('/api/cultivation-plan', { method: 'POST', json: { profile_id: profile.id, projects: nextProjects },
        signal: controller.signal, timeoutMs: 90000, fallbackMessage: text.failed })
      if (!controller.signal.aborted) setData(result)
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : text.failed)
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    const version = snapshot.data?.version ?? data?.snapshotVersion ?? data?.importedAt
    const matching = projects.every((project) => data?.candidates.some((row) => row.operatorId === project.operatorId
      && row.target.elite === project.elite && row.target.level === project.level && row.target.skill === project.skill && row.target.skillLevel === project.skillLevel))
    const key = `${version}:${JSON.stringify(projects.map(({ operatorId, elite, level, skill, skillLevel }) => ({ operatorId, elite, level, skill, skillLevel })))}`
    if (snapshot.available === false || snapshot.expired || !version || busy || matching && (data?.snapshotVersion ?? data?.importedAt) === version || calculatedVersion.current === key) return
    calculatedVersion.current = key
    void load(projectRef.current, false)
  }, [snapshot.data?.version, snapshot.available, snapshot.expired, busy, projects, data]) // eslint-disable-line react-hooks/exhaustive-deps

  return { projects, setProjects, data, busy: busy || snapshot.busy, error: error || snapshot.error || null, load, storageError, dailySanity, setDailySanity, startDate, setStartDate, allOpen, setAllOpen,
    history, normalId, setNormalId, temporaryId, setTemporaryId, production: currentProduction, productionInvalid, normalIncome, temporaryIncome,
    retryProduction: () => setProductionRetry((value) => value + 1), validSettings, materials, plans, pendingRefresh }
}
