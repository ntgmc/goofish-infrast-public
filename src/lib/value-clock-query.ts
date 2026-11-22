import { useQuery } from '@tanstack/react-query'
import { apiJson } from './api-client'
import { valueClockSnapshotSchema } from './value-clock'

export function useValueClockQuery() {
  return useQuery({
    queryKey: ['public', 'value-clock', 'production', null, null],
    queryFn: async ({ signal }) => {
      const data = valueClockSnapshotSchema.parse(await apiJson<unknown>('/api/site/value-clock?view=production', { signal }))
      return { snapshot: data, receivedAt: performance.now() }
    },
    staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
  })
}
