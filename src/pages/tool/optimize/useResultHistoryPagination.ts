import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { UserWorkspace, WorkspaceResultHistoryPage, WorkspaceResultHistorySummary } from '../../../lib/types'
import { fetchResultHistoryPage } from './optimization-api'
import { resultHistoryKey } from './result-history-query'
import { copy } from '../../../copy/index'

type ResultScope = 'active' | 'archived'

export function useResultHistoryPagination(profileId: string, workspace: UserWorkspace | null, userId: string | null) {
  const snapshot = workspace?.profile_id === profileId ? workspace : null
  const revision = [snapshot?.updated_at, snapshot?.result_history, snapshot?.archived_results, snapshot?.result_history_next_cursor, snapshot?.archived_results_next_cursor]
  const options = (scope: ResultScope) => ({
    queryKey: [...resultHistoryKey(userId, profileId), 'pages', scope, revision],
    enabled: Boolean(userId && profileId && snapshot), staleTime: Infinity,
    initialPageParam: null as string | null,
    initialData: { pages: [{ items: scope === 'active' ? snapshot?.result_history ?? [] : snapshot?.archived_results ?? [],
      next_cursor: scope === 'active' ? snapshot?.result_history_next_cursor ?? null : snapshot?.archived_results_next_cursor ?? null }], pageParams: [null] },
    queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam: string | null }) => fetchResultHistoryPage(profileId, scope, pageParam, signal),
    getNextPageParam: (page: WorkspaceResultHistoryPage) => page.next_cursor ?? undefined,
  })
  const active = useInfiniteQuery(options('active'))
  const archived = useInfiniteQuery(options('archived'))
  const resultHistory = useMemo(() => merge(active.data.pages), [active.data])
  const archivedResults = useMemo(() => merge(archived.data.pages), [archived.data])
  const error = active.error ?? archived.error
  const load = async (scope: ResultScope) => {
    const query = scope === 'active' ? active : archived
    if (userId && snapshot && query.hasNextPage && !active.isFetching && !archived.isFetching) await query.fetchNextPage({ cancelRefetch: false })
  }
  return { resultHistory, archivedResults, resultHistoryHasMore: active.hasNextPage, archivedResultsHasMore: archived.hasNextPage,
    loadingScope: active.isFetching ? 'active' as const : archived.isFetching ? 'archived' as const : null,
    error: error ? error instanceof Error ? error.message : copy.optimize.pages_tool_optimize_result_history_load_failed : null,
    loadMoreResultHistory: () => load('active'), loadMoreArchivedResults: () => load('archived') }
}

function merge(pages: WorkspaceResultHistoryPage[]): WorkspaceResultHistorySummary[] {
  const items = new Map<string, WorkspaceResultHistorySummary>()
  for (const page of pages) for (const item of page.items) if (!items.has(item.id)) items.set(item.id, item)
  return [...items.values()]
}
