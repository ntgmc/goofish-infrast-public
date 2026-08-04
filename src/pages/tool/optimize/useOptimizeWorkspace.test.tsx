// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseConfig, UserWorkspace, WorkspaceResultHistorySummary } from '../../../lib/types'
import { useOptimizeWorkspace } from './useOptimizeWorkspace'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.apiJson }))

describe('useOptimizeWorkspace history mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies the workspace returned by the archive endpoint without an empty workspace patch', async () => {
    const workspace = {
      profile_id: 'profile-1',
      operators: [],
      config: null,
      elite_overrides: {},
      latest_result: null,
      saved_configs: [],
      result_history: [],
      archived_results: [historyItem()],
      result_history_next_cursor: null,
      archived_results_next_cursor: null,
      free_schedule_entitlement: null,
      updated_at: '2026-08-01T00:00:00.000Z',
    } satisfies UserWorkspace
    mocks.apiJson.mockResolvedValue({ workspace })
    const onWorkspacePatch = vi.fn()
    const onWorkspaceUpdated = vi.fn()
    const { result } = renderHook(() => useOptimizeWorkspace({
      profileId: 'profile-1',
      activeConfig: {} as LicenseConfig,
      normalizeAllowedConfigOverride: (config) => config,
      onWorkspacePatch,
      onWorkspaceUpdated,
      setConfigOverride: vi.fn(),
      setCurrentResult: vi.fn(),
      setFinalResult: vi.fn(),
      setHistoryItem: vi.fn(),
      setSuggestions: vi.fn(),
      setPhase: vi.fn(),
      setLastGeneratedSignature: vi.fn(),
      setInlineError: vi.fn(),
      setWorkspaceNotice: vi.fn(),
      setWorkspaceError: vi.fn(),
      setWorkspaceBusyAction: vi.fn(),
      setSection: vi.fn(),
      onDownloadMaaResult: vi.fn(async () => undefined),
    }))

    await act(async () => {
      await result.current.handleArchiveHistory(historyItem())
    })

    expect(mocks.apiJson).toHaveBeenCalledTimes(1)
    expect(onWorkspaceUpdated).toHaveBeenCalledWith('profile-1', workspace)
    expect(onWorkspacePatch).not.toHaveBeenCalled()
  })
})

function historyItem(): WorkspaceResultHistorySummary {
  return {
    id: 'result-1',
    name: '历史方案',
    created_at: '2026-08-01T00:00:00.000Z',
    operator_count: 1,
    source: 'generated',
    archived: false,
    schedule_mode: 'maa',
    maa_exportable: true,
    has_config: false,
  }
}
