import { useCallback, useEffect, useState } from 'react'
import type { UserWorkspace, WorkspaceResultHistorySummary } from '../../../lib/types'
import { fetchResultHistoryPage } from './optimization-api'
import { copy } from '../../../copy/index'

type ResultScope = 'active' | 'archived'

export function useResultHistoryPagination(
  profileId: string,
  workspace: UserWorkspace | null,
) {
  const [resultHistory, setResultHistory] = useState<WorkspaceResultHistorySummary[]>(
    workspace?.result_history ?? [],
  )
  const [archivedResults, setArchivedResults] = useState<WorkspaceResultHistorySummary[]>(
    workspace?.archived_results ?? [],
  )
  const [resultHistoryCursor, setResultHistoryCursor] = useState<string | null>(
    workspace?.result_history_next_cursor ?? null,
  )
  const [archivedResultsCursor, setArchivedResultsCursor] = useState<string | null>(
    workspace?.archived_results_next_cursor ?? null,
  )
  const [loadingScope, setLoadingScope] = useState<ResultScope | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResultHistory(workspace?.result_history ?? [])
    setArchivedResults(workspace?.archived_results ?? [])
    setResultHistoryCursor(workspace?.result_history_next_cursor ?? null)
    setArchivedResultsCursor(workspace?.archived_results_next_cursor ?? null)
    setLoadingScope(null)
    setError(null)
  }, [profileId, workspace])

  const loadMore = useCallback(async (scope: ResultScope) => {
    const cursor = scope === 'active' ? resultHistoryCursor : archivedResultsCursor
    if (!cursor || loadingScope) return
    setLoadingScope(scope)
    setError(null)
    try {
      const page = await fetchResultHistoryPage(profileId, scope, cursor)
      const appendUnique = (
        current: WorkspaceResultHistorySummary[],
      ): WorkspaceResultHistorySummary[] => {
        const known = new Set(current.map((item) => item.id))
        return [...current, ...page.items.filter((item) => !known.has(item.id))]
      }
      if (scope === 'active') {
        setResultHistory(appendUnique)
        setResultHistoryCursor(page.next_cursor)
      } else {
        setArchivedResults(appendUnique)
        setArchivedResultsCursor(page.next_cursor)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.optimize.pages_tool_optimize_result_history_load_failed)
    } finally {
      setLoadingScope(null)
    }
  }, [archivedResultsCursor, loadingScope, profileId, resultHistoryCursor])

  return {
    resultHistory,
    archivedResults,
    resultHistoryHasMore: Boolean(resultHistoryCursor),
    archivedResultsHasMore: Boolean(archivedResultsCursor),
    loadingScope,
    error,
    loadMoreResultHistory: () => loadMore('active'),
    loadMoreArchivedResults: () => loadMore('archived'),
  }
}
