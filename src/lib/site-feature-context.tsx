import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from './api-client'
import type { SiteFeatureSettingsV1, SiteFeatures } from './site-features'
import { computeEffectiveSiteFeatures, DEFAULT_SITE_FEATURES, SITE_FEATURE_KEYS } from './site-features'
import { copy } from '../copy/index'

type FeatureStatus = 'loading' | 'ready' | 'error'
type SiteFeatureContextValue = { status: FeatureStatus; features: SiteFeatures; updatedAt: string | null; retry: () => void }
const CLOSED_FEATURES = Object.fromEntries(SITE_FEATURE_KEYS.map((key) => [key, false])) as unknown as SiteFeatures
const SiteFeatureContext = createContext<SiteFeatureContextValue>({ status: 'ready', features: DEFAULT_SITE_FEATURES, updatedAt: null, retry: () => undefined })

export function SiteFeatureProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ['public', 'features'], queryFn: ({ signal }) => apiJson<SiteFeatureSettingsV1>('/api/site/features', { signal, fallbackMessage: copy.features.load_failed_body }) })
  const retry = useCallback(() => { void query.refetch({ cancelRefetch: false }) }, [query.refetch])
  const status: FeatureStatus = query.isFetching ? 'loading' : query.error ? 'error' : 'ready'
  const features = useMemo(() => query.data && !query.error ? computeEffectiveSiteFeatures(query.data) : CLOSED_FEATURES, [query.data, query.error])
  const value = useMemo(() => ({ status, features, updatedAt: query.error ? null : query.data?.updated_at ?? null, retry }), [status, features, query.error, query.data, retry])
  return <SiteFeatureContext.Provider value={value}>{children}</SiteFeatureContext.Provider>
}
export function useSiteFeatures(): SiteFeatureContextValue { return useContext(SiteFeatureContext) }
