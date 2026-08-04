// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserWorkspace, WorkspaceResultHistorySummary } from '../../../lib/types'
import { useResultHistoryPagination } from './useResultHistoryPagination'

const mocks = vi.hoisted(() => ({ fetchResultHistoryPage: vi.fn() }))

vi.mock('./optimization-api', () => ({
  fetchResultHistoryPage: mocks.fetchResultHistoryPage,
}))

describe('useResultHistoryPagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends a cursor page without duplicate IDs and resets with a new workspace snapshot', async () => {
    const first = summary('result-1')
    const second = summary('result-2')
    mocks.fetchResultHistoryPage.mockResolvedValue({
      items: [first, second],
      next_cursor: null,
    })
    const initial = workspace([first], 'cursor-1')
    const { result, rerender } = renderHook(
      ({ current }) => useResultHistoryPagination('profile-1', current),
      { initialProps: { current: initial } },
    )

    await act(async () => {
      await result.current.loadMoreResultHistory()
    })

    expect(mocks.fetchResultHistoryPage).toHaveBeenCalledWith('profile-1', 'active', 'cursor-1')
    expect(result.current.resultHistory.map((item) => item.id)).toEqual(['result-1', 'result-2'])
    expect(result.current.resultHistoryHasMore).toBe(false)

    const replacement = workspace([summary('replacement')], null)
    rerender({ current: replacement })
    await waitFor(() => {
      expect(result.current.resultHistory.map((item) => item.id)).toEqual(['replacement'])
    })
  })
})

function workspace(
  resultHistory: WorkspaceResultHistorySummary[],
  cursor: string | null,
): UserWorkspace {
  return {
    profile_id: 'profile-1',
    operators: null,
    config: null,
    elite_overrides: {},
    latest_result: resultHistory[0] ?? null,
    saved_configs: [],
    result_history: resultHistory,
    archived_results: [],
    result_history_next_cursor: cursor,
    archived_results_next_cursor: null,
    free_schedule_entitlement: null,
    updated_at: '2026-08-04T00:00:00.000Z',
  }
}

function summary(id: string): WorkspaceResultHistorySummary {
  return {
    id,
    name: id,
    created_at: '2026-08-04T00:00:00.000Z',
    operator_count: 1,
    source: 'generated',
    archived: false,
    schedule_mode: 'maa',
    maa_exportable: true,
    has_config: false,
  }
}
