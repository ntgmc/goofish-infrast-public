import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiJson } from './api-client'
import {
  cloneDefaultPublicContentSettings,
  normalizePublicContentSettings,
  type PublicContentSettingsV1,
} from './public-content'

type PublicContentStatus = 'loading' | 'ready' | 'error'

type PublicContentContextValue = {
  status: PublicContentStatus
  content: PublicContentSettingsV1
  refresh: () => Promise<void>
}

const PublicContentContext = createContext<PublicContentContextValue>({
  status: 'ready',
  content: cloneDefaultPublicContentSettings(),
  refresh: async () => undefined,
})

export function PublicContentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PublicContentStatus>('loading')
  const [content, setContent] = useState<PublicContentSettingsV1>(() => cloneDefaultPublicContentSettings())

  const load = useCallback((signal?: AbortSignal): Promise<void> => {
    setStatus('loading')
    return apiJson<PublicContentSettingsV1>('/api/site/public-content', { signal }).then(
      (data) => {
        setContent(normalizePublicContentSettings(data))
        setStatus('ready')
      },
      (error: unknown) => {
        if ((error as Error).name === 'AbortError') return
        setStatus('error')
      },
    )
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(async () => load(), [load])
  const value = useMemo(() => ({ status, content, refresh }), [content, refresh, status])
  return <PublicContentContext.Provider value={value}>{children}</PublicContentContext.Provider>
}

export function usePublicContent(): PublicContentContextValue {
  return useContext(PublicContentContext)
}
