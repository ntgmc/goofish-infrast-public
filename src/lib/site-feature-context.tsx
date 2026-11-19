import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from './api-client'
import type { FeaturePauseNotices, SiteFeatureSettingsV1, SiteFeatures } from './site-features'
import { computeEffectiveSiteFeatures, computeVisiblePauseNotices, DEFAULT_SITE_FEATURES, SITE_FEATURE_KEYS } from './site-features'
import { copy } from '../copy/index'

export const SITE_FEATURE_QUERY_KEY = ['public', 'features'] as const

type FeatureStatus = 'loading' | 'ready' | 'error'
type SiteFeatureContextValue = { status: FeatureStatus; features: SiteFeatures; pauseNotices?: FeaturePauseNotices; updatedAt: string | null; retry: () => void }
const NO_PAUSE_NOTICES: FeaturePauseNotices = Object.freeze({})
const CLOSED_FEATURES = Object.fromEntries(SITE_FEATURE_KEYS.map((key) => [key, false])) as unknown as SiteFeatures
const SiteFeatureContext = createContext<SiteFeatureContextValue>({ status: 'ready', features: DEFAULT_SITE_FEATURES, pauseNotices: NO_PAUSE_NOTICES, updatedAt: null, retry: () => undefined })

export function SiteFeatureProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: SITE_FEATURE_QUERY_KEY, queryFn: ({ signal }) => apiJson<SiteFeatureSettingsV1>('/api/site/features', { signal, fallbackMessage: copy.features.load_failed_body }) })
  const retry = useCallback(() => { void query.refetch({ cancelRefetch: false }) }, [query.refetch])
  const status: FeatureStatus = query.isFetching ? 'loading' : query.error ? 'error' : 'ready'
  const features = useMemo(() => query.data && !query.error ? computeEffectiveSiteFeatures(query.data) : CLOSED_FEATURES, [query.data, query.error])
  const pauseNotices = useMemo(() => query.data && !query.error ? computeVisiblePauseNotices(query.data) : NO_PAUSE_NOTICES, [query.data, query.error])
  const value = useMemo(() => ({ status, features, pauseNotices, updatedAt: query.error ? null : query.data?.updated_at ?? null, retry }), [status, features, pauseNotices, query.error, query.data, retry])
  return <SiteFeatureContext.Provider value={value}>{children}</SiteFeatureContext.Provider>
}
export function useSiteFeatures(): SiteFeatureContextValue { return useContext(SiteFeatureContext) }
