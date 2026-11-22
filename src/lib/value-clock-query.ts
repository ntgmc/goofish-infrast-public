/// <reference types="vite/client" />
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from './api-client'
import { valueClockSnapshotSchema } from './value-clock'

export function useValueClockQuery(localPreview = false) {
  const preview = import.meta.env.DEV && localPreview
  const startedAt = useRef(performance.now())
  return useQuery({
    queryKey: ['public', 'value-clock', preview ? 'preview' : 'production', null, null],
    queryFn: async ({ signal }) => {
      if (import.meta.env.DEV && preview) {
        const { createValueClockPreview } = await import('./value-clock-preview')
        const receivedAt = performance.now()
        return { snapshot: createValueClockPreview(receivedAt - startedAt.current), receivedAt }
      }
      const data = valueClockSnapshotSchema.parse(await apiJson<unknown>('/api/site/value-clock?view=production', { signal }))
      return { snapshot: data, receivedAt: performance.now() }
    },
    staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
  })
}
