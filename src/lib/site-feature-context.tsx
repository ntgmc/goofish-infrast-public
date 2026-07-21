import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiJson } from './api-client'
import type { SiteFeatureSettingsV1, SiteFeatures } from './site-features'
import { DEFAULT_SITE_FEATURES, SITE_FEATURE_KEYS } from './site-features'
import { copy } from '../copy/index'

type FeatureStatus = 'loading' | 'ready' | 'error'

type SiteFeatureContextValue = {
  status: FeatureStatus
  features: SiteFeatures
  updatedAt: string | null
  retry: () => void
}

const CLOSED_FEATURES = Object.fromEntries(SITE_FEATURE_KEYS.map((key) => [key, false])) as unknown as SiteFeatures
const SiteFeatureContext = createContext<SiteFeatureContextValue>({
  status: 'ready',
  features: DEFAULT_SITE_FEATURES,
  updatedAt: null,
  retry: () => undefined,
})

export function SiteFeatureProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FeatureStatus>('loading')
  const [features, setFeatures] = useState<SiteFeatures>(CLOSED_FEATURES)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setStatus('loading')
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void apiJson<SiteFeatureSettingsV1>('/api/site/features', {
      signal: controller.signal,
      fallbackMessage: copy.features.load_failed_body,
    }).then((data) => {
      setFeatures(data.features)
      setUpdatedAt(data.updated_at)
      setStatus('ready')
    }).catch((error) => {
      if ((error as Error).name === 'AbortError') return
      setFeatures(CLOSED_FEATURES)
      setUpdatedAt(null)
      setStatus('error')
    })
    return () => controller.abort()
  }, [requestVersion])

  const value = useMemo(() => ({ status, features, updatedAt, retry }), [features, retry, status, updatedAt])
  return <SiteFeatureContext.Provider value={value}>{children}</SiteFeatureContext.Provider>
}

export function useSiteFeatures(): SiteFeatureContextValue {
  return useContext(SiteFeatureContext)
}
