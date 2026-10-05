// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseConfig, UserWorkspace, WorkspaceResultHistorySummary } from '../../../lib/types'
import { useOptimizeWorkspace } from './useOptimizeWorkspace'
import { CONFIG_PRESETS } from '../../../lib/config'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.apiJson }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useOptimizeWorkspace history mutations', () => {
  beforeEach(() => {
    mocks.apiJson.mockReset()
  })

  it.each(['archive', 'unarchive', 'delete'] as const)('applies returned workspace and refreshes capacity after %s', async (action) => {
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
    const refreshInventory = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { result } = renderHook(() => useOptimizeWorkspace({
      profileId: 'profile-1',
      activeConfig: {} as LicenseConfig,
      normalizeAllowedConfigOverride: (config) => config,
      onWorkspacePatch,
      onWorkspaceUpdated,
      refreshInventory,
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
      if (action === 'archive') await result.current.handleArchiveHistory(historyItem())
      if (action === 'unarchive') await result.current.handleUnarchiveHistory(historyItem())
      if (action === 'delete') await result.current.handleDeleteHistory(historyItem())
    })

    expect(mocks.apiJson).toHaveBeenCalledTimes(1)
    expect(onWorkspaceUpdated).toHaveBeenCalledWith('profile-1', workspace)
    expect(refreshInventory).toHaveBeenCalledOnce()
    expect(onWorkspacePatch).not.toHaveBeenCalled()
  })
  it('prevents saved and pending history configurations from replacing the configuration during generation', async () => {
    let readOnly = false
    const config = CONFIG_PRESETS['333']
    const detail = { ...historyItem(), config, result: { upgrade_suggestions: [] } }
    let finishHistory!: (response: { item: typeof detail }) => void
    mocks.apiJson.mockReturnValue(new Promise((resolve) => { finishHistory = resolve }))
    const setConfigOverride = vi.fn()
    const setCurrentResult = vi.fn()
    const onWorkspacePatch = vi.fn()
    const { result } = renderHook(() => useOptimizeWorkspace({
      profileId: 'profile-1', activeConfig: CONFIG_PRESETS['243'],
      isConfigReadOnly: () => readOnly, normalizeAllowedConfigOverride: (config) => config,
      onWorkspacePatch, onWorkspaceUpdated: vi.fn(), refreshInventory: vi.fn(),
      setConfigOverride, setCurrentResult, setFinalResult: vi.fn(), setHistoryItem: vi.fn(),
      setSuggestions: vi.fn(), setPhase: vi.fn(), setLastGeneratedSignature: vi.fn(), setInlineError: vi.fn(),
      setWorkspaceNotice: vi.fn(), setWorkspaceError: vi.fn(), setWorkspaceBusyAction: vi.fn(), setSection: vi.fn(),
      onDownloadMaaResult: vi.fn(),
    }))
    let pending!: Promise<void>
    act(() => { pending = result.current.handleUseHistoryConfig(historyItem()) })
    readOnly = true
    await act(async () => {
      finishHistory({ item: detail })
      await pending
    })
    const saved = { id: 'saved', name: 'Saved', config, created_at: '', updated_at: '', last_used_at: null }
    await act(async () => {
      result.current.handleUseSavedConfig(saved)
      await result.current.handleUseHistoryConfig(historyItem())
    })
    expect(setConfigOverride).not.toHaveBeenCalled()
    expect(setCurrentResult).not.toHaveBeenCalled()
    expect(onWorkspacePatch).not.toHaveBeenCalled()
    expect(mocks.apiJson).toHaveBeenCalledOnce()

    readOnly = false
    mocks.apiJson.mockResolvedValue({ item: detail })
    await act(async () => {
      result.current.handleUseSavedConfig(saved)
      await result.current.handleUseHistoryConfig(historyItem())
    })
    expect(setConfigOverride).toHaveBeenCalledTimes(2)
    expect(setConfigOverride).toHaveBeenLastCalledWith(config)
    expect(onWorkspacePatch).toHaveBeenCalledOnce()
  })

  it('trims and validates an archive name and updates the selected result', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  我的封存  ')
    const setHistoryItem = vi.fn()
    const onWorkspaceUpdated = vi.fn()
    const workspace = { archived_results: [{ ...historyItem(), name: '我的封存' }] }
    mocks.apiJson.mockResolvedValue({ workspace })
    const { result } = renderHook(() => useOptimizeWorkspace({
      profileId: 'profile-1',
      activeConfig: {} as LicenseConfig,
      normalizeAllowedConfigOverride: (config) => config,
      onWorkspacePatch: vi.fn(),
      onWorkspaceUpdated,
      refreshInventory: vi.fn(),
      setConfigOverride: vi.fn(), setCurrentResult: vi.fn(), setFinalResult: vi.fn(), setHistoryItem,
      setSuggestions: vi.fn(), setPhase: vi.fn(), setLastGeneratedSignature: vi.fn(), setInlineError: vi.fn(),
      setWorkspaceNotice: vi.fn(), setWorkspaceError: vi.fn(), setWorkspaceBusyAction: vi.fn(), setSection: vi.fn(),
      onDownloadMaaResult: vi.fn(),
    }))
    await act(async () => { await result.current.handleRenameArchivedHistory(historyItem()) })
    expect(mocks.apiJson).toHaveBeenCalledWith('/api/user/result-archive', expect.objectContaining({
      json: expect.objectContaining({ action: 'rename', name: '我的封存', result_id: 'result-1' }),
    }))
    expect(onWorkspaceUpdated).toHaveBeenCalledWith('profile-1', workspace)
    const updateDetail = setHistoryItem.mock.calls[0]![0]
    expect(updateDetail({ id: 'result-1', name: '旧名' })).toEqual({ id: 'result-1', name: '我的封存' })
    expect(updateDetail(null)).toBeNull()
    mocks.apiJson.mockClear()
    for (const name of [null, ' ', 'x'.repeat(41), historyItem().name]) {
      prompt.mockReturnValue(name)
      await act(async () => { await result.current.handleRenameArchivedHistory(historyItem()) })
    }
    expect(mocks.apiJson).not.toHaveBeenCalled()
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
