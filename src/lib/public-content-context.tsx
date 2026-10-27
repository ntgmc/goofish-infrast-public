import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from './api-client'
import { cloneDefaultPublicContentSettings, resolvePublicContentSettings, type PublicContentSettingsV1 } from './public-content'

type PublicContentStatus = 'loading' | 'ready' | 'error'
type PublicContentContextValue = { status: PublicContentStatus; isFallback: boolean; content: PublicContentSettingsV1; refresh: () => Promise<void> }
const PublicContentContext = createContext<PublicContentContextValue>({ status: 'ready', isFallback: true, content: cloneDefaultPublicContentSettings(), refresh: async () => undefined })

export function PublicContentProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['public', 'content'], queryFn: async ({ signal }) => {
    const resolved = resolvePublicContentSettings(await apiJson<PublicContentSettingsV1>('/api/site/public-content', { signal }))
    if (resolved.isFallback) throw new Error('Invalid public content')
    return resolved.content
  } })
  const refresh = useCallback(async () => {
    await client.cancelQueries({ queryKey: ['public', 'content'], exact: true })
    await query.refetch({ cancelRefetch: false })
  }, [client, query.refetch])
  const fallback = useMemo(cloneDefaultPublicContentSettings, [])
  const status: PublicContentStatus = query.isFetching ? 'loading' : query.error ? 'error' : 'ready'
  const value = useMemo(() => ({ status, isFallback: !query.data, content: query.data ?? fallback, refresh }), [status, query.data, fallback, refresh])
  return <PublicContentContext.Provider value={value}>{children}</PublicContentContext.Provider>
}
export function usePublicContent(): PublicContentContextValue { return useContext(PublicContentContext) }
