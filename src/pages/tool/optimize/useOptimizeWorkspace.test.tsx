// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseConfig, UserWorkspace, WorkspaceResultHistoryItem } from '../../../lib/types'
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
      last_result: null,
      saved_configs: [],
      result_history: [],
      archived_results: [historyItem()],
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
      guardGeneratedResultExport: vi.fn(async (run) => { await run() }),
    }))

    await act(async () => {
      await result.current.handleArchiveHistory(historyItem())
    })

    expect(mocks.apiJson).toHaveBeenCalledTimes(1)
    expect(onWorkspaceUpdated).toHaveBeenCalledWith('profile-1', workspace)
    expect(onWorkspacePatch).not.toHaveBeenCalled()
  })
})

function historyItem(): WorkspaceResultHistoryItem {
  return {
    id: 'result-1',
    name: '历史方案',
    created_at: '2026-08-01T00:00:00.000Z',
    config: null,
    result: {} as never,
    operator_count: 1,
    source: 'generated',
  }
}
