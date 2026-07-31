import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiJson } from './api-client'
import {
  cloneDefaultPublicContentSettings,
  resolvePublicContentSettings,
  type PublicContentSettingsV1,
} from './public-content'

type PublicContentStatus = 'loading' | 'ready' | 'error'

type PublicContentContextValue = {
  status: PublicContentStatus
  isFallback: boolean
  content: PublicContentSettingsV1
  refresh: () => Promise<void>
}

const PublicContentContext = createContext<PublicContentContextValue>({
  status: 'ready',
  isFallback: true,
  content: cloneDefaultPublicContentSettings(),
  refresh: async () => undefined,
})

export function PublicContentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PublicContentStatus>('loading')
  const [isFallback, setIsFallback] = useState(true)
  const [content, setContent] = useState<PublicContentSettingsV1>(() => cloneDefaultPublicContentSettings())
  const requestVersionRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const hasRemoteContentRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setStatus('loading')
    try {
      const data = await apiJson<PublicContentSettingsV1>('/api/site/public-content', { signal: controller.signal })
      if (requestVersionRef.current !== requestVersion) return
      const resolved = resolvePublicContentSettings(data)
      if (resolved.isFallback) {
        if (!hasRemoteContentRef.current) {
          setContent(resolved.content)
          setIsFallback(true)
        }
        setStatus('error')
        return
      }
      hasRemoteContentRef.current = true
      setContent(resolved.content)
      setIsFallback(false)
      setStatus('ready')
    } catch (error) {
      if ((error as Error).name === 'AbortError' || requestVersionRef.current !== requestVersion) return
      setStatus('error')
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      requestVersionRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
    }
  }, [load])

  const refresh = useCallback(async () => load(), [load])
  const value = useMemo(() => ({ status, isFallback, content, refresh }), [content, isFallback, refresh, status])
  return <PublicContentContext.Provider value={value}>{children}</PublicContentContext.Provider>
}

export function usePublicContent(): PublicContentContextValue {
  return useContext(PublicContentContext)
}
