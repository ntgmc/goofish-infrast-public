import { QueryObserver, useQuery, type QueryClient } from '@tanstack/react-query'
import { fetchResultHistoryDetail } from './optimization-api'

export const resultHistoryKey = (userId: string | null | undefined, profileId: string | null | undefined) => ['user', userId ?? null, profileId ?? null, 'result-history']

export async function fetchCachedResultHistoryDetail(client: QueryClient, userId: string, profileId: string, resultId: string) {
  const options = { queryKey: [...resultHistoryKey(userId, profileId), 'detail', resultId],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchResultHistoryDetail(profileId, resultId, signal) }
  // Keep this caller subscribed so a departing page cannot cancel its shared read.
  const observer = new QueryObserver(client, { ...options, enabled: false })
  const unsubscribe = observer.subscribe(() => undefined)
  try {
    return await client.fetchQuery(options)
  } finally {
    unsubscribe()
  }
}

export function useResultHistoryDetailQuery(userId: string | null | undefined, profileId: string | undefined, resultId: string | undefined) {
  return useQuery({ queryKey: [...resultHistoryKey(userId, profileId), 'detail', resultId], enabled: Boolean(userId && profileId && resultId),
    queryFn: ({ signal }) => fetchResultHistoryDetail(profileId!, resultId!, signal) })
}
