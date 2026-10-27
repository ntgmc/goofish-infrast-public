import { useQuery, type QueryClient } from '@tanstack/react-query'
import { fetchResultHistoryDetail } from './optimization-api'

export const resultHistoryKey = (userId: string | null | undefined, profileId: string | null | undefined) => ['user', userId ?? null, profileId ?? null, 'result-history']

export function fetchCachedResultHistoryDetail(client: QueryClient, userId: string, profileId: string, resultId: string) {
  return client.fetchQuery({ queryKey: [...resultHistoryKey(userId, profileId), 'detail', resultId],
    queryFn: ({ signal }) => fetchResultHistoryDetail(profileId, resultId, signal) })
}

export function useResultHistoryDetailQuery(userId: string | null | undefined, profileId: string | undefined, resultId: string | undefined) {
  return useQuery({ queryKey: [...resultHistoryKey(userId, profileId), 'detail', resultId], enabled: Boolean(userId && profileId && resultId),
    queryFn: ({ signal }) => fetchResultHistoryDetail(profileId!, resultId!, signal) })
}
