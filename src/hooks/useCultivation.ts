import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTaskDraft } from '../lib/task-drafts'
import { copy } from '../copy/index'
import { apiJson } from '../lib/api-client'
import { useSklandSnapshot } from '../hooks/useSklandSnapshot'
import { defaultCultivationQuery, type CultivationData, type CultivationOptions, type CultivationQuery } from '../lib/cultivation-contract'
import { recommendCultivationTargets } from '../lib/cultivation-planner'
import { useToolSession } from '../pages/tool/useToolSession'

const label = copy.tools.cultivation

export function useCultivation(session: ReturnType<typeof useToolSession>) {
  const profiles = session.profiles.filter((row) => row.status === 'active' && !row.archived_at && row.skland_binding)
  const [chosenProfile, setChosenProfile] = useTaskDraft(`cultivation:${session.user?.id ?? 'guest'}:profile`, '')
  const profileId = profiles.some((row) => row.id === chosenProfile) ? chosenProfile : profiles.find((row) => row.id === session.activeProfile?.id)?.id ?? profiles[0]?.id ?? ''
  const snapshot = useSklandSnapshot(session.user?.id, profiles.find((row) => row.id === profileId))
  const calculatedVersion = useRef('')
  const [data, setData] = useState<CultivationData | null>(null)
  const [phase, setPhase] = useState<'syncing' | 'calculating' | null>(null)
  const busy = phase !== null
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryFromUrl = () => Object.fromEntries(Object.entries(defaultCultivationQuery).map(([key, fallback]) => {
    const value = searchParams.get(`cultivation_${key}`)
    return [key, value === null ? fallback : typeof fallback === 'boolean' ? value === 'true' : typeof fallback === 'number' ? Number(value) : value]
  })) as CultivationQuery
  const draftKey = `cultivation:${session.user?.id ?? 'guest'}:${profileId}`
  const [options, setOptions] = useTaskDraft<CultivationOptions>(`${draftKey}:options`, () => ({ recommendation: queryFromUrl(), preference: 'coverage', limit: 5, excluded: [] }))
  const [appliedOptions, setAppliedOptions] = useTaskDraft(`${draftKey}:applied`, options)
  const [limit, setLimit] = useTaskDraft(`${draftKey}:limit`, '5')
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const recommendations = useMemo(() => data && !snapshot.expired ? recommendCultivationTargets(data, appliedOptions) : null, [data, appliedOptions, snapshot.expired])

  useEffect(() => {
    generation.current++
    calculatedVersion.current = ''
    request.current?.abort()
    setData(null)
    setError(null)
    setPhase(null)
    return () => { generation.current++; request.current?.abort() }
  }, [profileId])

  useEffect(() => {
    if (snapshot.available === false) {
      generation.current++
      request.current?.abort()
      setData(null)
      setPhase(null)
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
    setPhase(refresh ? 'syncing' : 'calculating')
    setError(null)
    try {
      if (refresh) await snapshot.refresh()
      if (controller.signal.aborted) return
      setPhase('calculating')
      const result = await apiJson<CultivationData>('/api/cultivation-plan', { method: 'POST', json: { profile_id: profileId, recommendation }, signal: controller.signal, timeoutMs: 90000, fallbackMessage: label.failed })
      if (generation.current === run) {
        setData(result)
        setOptions((value) => ({ ...value, recommendation: preserveSettings ? value.recommendation : recommendation }))
        setAppliedOptions((value) => ({ ...value, recommendation }))
      }
    } catch (caught) {
      if (generation.current === run && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : label.failed)
    } finally { if (generation.current === run) setPhase(null) }
  }

  useEffect(() => {
    const version = snapshot.data?.version
    if (!version || busy || data?.snapshotVersion === version || calculatedVersion.current === `${profileId}:${version}`) return
    let cancelled = false
    // Wait for mount cleanup before marking this snapshot as requested.
    queueMicrotask(() => {
      if (cancelled) return
      calculatedVersion.current = `${profileId}:${version}`
      void load(appliedOptions.recommendation ?? defaultCultivationQuery, true, false)
    })
    return () => { cancelled = true }
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

  return { profiles, profileId, setChosenProfile, data, busy: busy || snapshot.busy, phase: phase ?? (snapshot.busy ? 'syncing' : null), error: error || snapshot.error || null, options, setOptions, appliedOptions,
    limit, setLimit, recommendations, load, exclude, changed, apply }
}
