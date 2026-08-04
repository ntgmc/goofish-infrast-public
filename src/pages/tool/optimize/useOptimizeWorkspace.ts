import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AuthSuccessResponse, LicenseConfig, OptimizeResult, UpgradeSuggestion, UserWorkspace, WorkspaceResultHistoryItem, WorkspaceResultHistorySummary, WorkspaceSavedConfig, WorkspaceSavedConfigAction } from '../../../lib/types'
import { normalizeUpgradeSuggestions } from './workflow-utils'
import type { WorkspacePatch } from '../useToolSession'
import type { OptimizePhase, OptimizeSection } from './types'
import { copy } from '../../../copy/index'
import { apiJson } from '../../../lib/api-client'
import { fetchResultHistoryDetail } from './optimization-api'


type Setter<T> = Dispatch<SetStateAction<T>>

type UseOptimizeWorkspaceOptions = {
  profileId: string
  activeConfig: LicenseConfig
  normalizeAllowedConfigOverride: (config: LicenseConfig) => LicenseConfig
  onWorkspacePatch: (patch: WorkspacePatch) => Promise<AuthSuccessResponse | void>
  onWorkspaceUpdated: (profileId: string, workspace: UserWorkspace) => void
  setConfigOverride: (config: LicenseConfig | null) => void
  setCurrentResult: Setter<OptimizeResult | null>
  setFinalResult: Setter<OptimizeResult | null>
  setHistoryItem: Setter<WorkspaceResultHistoryItem | null>
  setSuggestions: Setter<UpgradeSuggestion[]>
  setPhase: Setter<OptimizePhase>
  setLastGeneratedSignature: Setter<string | null>
  setInlineError: Setter<{ scope: 'generate' | 'apply'; message: string } | null>
  setWorkspaceNotice: Setter<string | null>
  setWorkspaceError: Setter<string | null>
  setWorkspaceBusyAction: Setter<string | null>
  setSection: (section: OptimizeSection) => void
  onDownloadMaaResult: (resultId: string) => Promise<void>
}

export function useOptimizeWorkspace({
  profileId,
  activeConfig,
  normalizeAllowedConfigOverride,
  onWorkspacePatch,
  onWorkspaceUpdated,
  setConfigOverride,
  setCurrentResult,
  setFinalResult,
  setHistoryItem,
  setSuggestions,
  setPhase,
  setLastGeneratedSignature,
  setInlineError,
  setWorkspaceNotice,
  setWorkspaceError,
  setWorkspaceBusyAction,
  setSection,
  onDownloadMaaResult,
}: UseOptimizeWorkspaceOptions) {
  const runSavedConfigAction = useCallback(async (
    busyKey: string,
    action: WorkspaceSavedConfigAction,
    successMessage: string,
  ) => {
    setWorkspaceBusyAction(busyKey)
    setWorkspaceError(null)
    try {
      await onWorkspacePatch({ saved_config_action: action })
      setWorkspaceNotice(successMessage)
    } catch (error) {
      setWorkspaceError((error as Error).message)
    } finally {
      setWorkspaceBusyAction(null)
    }
  }, [onWorkspacePatch, setWorkspaceBusyAction, setWorkspaceError, setWorkspaceNotice])

  const handleSaveCurrentConfig = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setWorkspaceError(copy.workspace.pages_tool_optimize_useOptimizeWorkspace_001)
      return
    }
    await runSavedConfigAction('save-current', {
      type: 'save',
      name: trimmed,
      config: activeConfig,
    }, `${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_002}${trimmed}”。`)
  }, [activeConfig, runSavedConfigAction, setWorkspaceError])

  const handleRenameSavedConfig = useCallback(async (config: WorkspaceSavedConfig) => {
    const nextName = window.prompt(copy.workspace.pages_tool_optimize_useOptimizeWorkspace_003, config.name)
    if (nextName === null) return
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === config.name) return
    await runSavedConfigAction(`rename:${config.id}`, {
      type: 'rename',
      id: config.id,
      name: trimmed,
    }, `${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_004}${trimmed}”。`)
  }, [runSavedConfigAction])

  const handleDeleteSavedConfig = useCallback(async (config: WorkspaceSavedConfig) => {
    if (!window.confirm(`${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_005}${config.name}”？`)) return
    await runSavedConfigAction(`delete:${config.id}`, {
      type: 'delete',
      id: config.id,
    }, `${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_006}${config.name}”。`)
  }, [runSavedConfigAction])

  const handleUseSavedConfig = useCallback((config: WorkspaceSavedConfig) => {
    setConfigOverride(normalizeAllowedConfigOverride(config.config))
    setCurrentResult(null)
    setFinalResult(null)
    setHistoryItem(null)
    setSuggestions([])
    setPhase('idle')
    setLastGeneratedSignature(null)
    setInlineError(null)
    setWorkspaceNotice(`${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_007}${config.name}${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_008}`)
    setSection('config')
    void runSavedConfigAction(`touch:${config.id}`, {
      type: 'touch',
      id: config.id,
    }, `${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_009}${config.name}”。`)
  }, [normalizeAllowedConfigOverride, runSavedConfigAction, setConfigOverride, setCurrentResult, setFinalResult, setHistoryItem, setInlineError, setLastGeneratedSignature, setPhase, setSection, setSuggestions, setWorkspaceNotice])

  const loadHistoryDetail = useCallback(async (item: WorkspaceResultHistorySummary) => {
    setWorkspaceBusyAction(`detail:${item.id}`)
    setWorkspaceError(null)
    try {
      return await fetchResultHistoryDetail(profileId, item.id)
    } catch (error) {
      setWorkspaceError((error as Error).message)
      return null
    } finally {
      setWorkspaceBusyAction(null)
    }
  }, [profileId, setWorkspaceBusyAction, setWorkspaceError])

  const handleViewHistory = useCallback(async (summary: WorkspaceResultHistorySummary) => {
    const item = await loadHistoryDetail(summary)
    if (!item) return
    setCurrentResult(null)
    setFinalResult(null)
    setSuggestions(normalizeUpgradeSuggestions(item.result.upgrade_suggestions))
    setHistoryItem(item)
    setPhase('history')
    setLastGeneratedSignature(null)
    setInlineError(null)
    setSection('result')
  }, [loadHistoryDetail, setCurrentResult, setFinalResult, setHistoryItem, setInlineError, setLastGeneratedSignature, setPhase, setSection, setSuggestions])

  const handleUseHistoryConfig = useCallback(async (summary: WorkspaceResultHistorySummary) => {
    const item = await loadHistoryDetail(summary)
    if (!item) return
    if (!item.config) {
      setWorkspaceError(copy.workspace.pages_tool_optimize_useOptimizeWorkspace_010)
      return
    }
    setConfigOverride(normalizeAllowedConfigOverride(item.config))
    setCurrentResult(null)
    setFinalResult(null)
    setHistoryItem(item)
    setSuggestions(normalizeUpgradeSuggestions(item.result.upgrade_suggestions))
    setPhase('history')
    setLastGeneratedSignature(null)
    setInlineError(null)
    setWorkspaceNotice(`${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_011}${item.name}${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_012}`)
    setSection('config')
  }, [loadHistoryDetail, normalizeAllowedConfigOverride, setConfigOverride, setCurrentResult, setFinalResult, setHistoryItem, setInlineError, setLastGeneratedSignature, setPhase, setSection, setSuggestions, setWorkspaceError, setWorkspaceNotice])

  const handleDownloadHistory = useCallback((item: WorkspaceResultHistorySummary) => {
    if (!item.maa_exportable) {
      setWorkspaceError(copy.workspace.pages_tool_optimize_useOptimizeWorkspace_013)
      return
    }
    void onDownloadMaaResult(item.id)
  }, [onDownloadMaaResult, setWorkspaceError])

  const mutateHistoryResult = useCallback(async (
    item: WorkspaceResultHistorySummary,
    action: 'archive' | 'unarchive' | 'delete',
  ) => {
    if (action === 'delete' && !window.confirm(copy.inventory.delete_result_confirm)) return
    setWorkspaceBusyAction(`${action}:${item.id}`)
    setWorkspaceError(null)
    try {
      const data = await apiJson<{ workspace: UserWorkspace }>('/api/user/result-archive', {
        method: 'POST',
        json: { profile_id: profileId, result_id: item.id, action, idempotency_key: crypto.randomUUID() },
        fallbackMessage: action === 'archive' ? copy.inventory.archive_full : action === 'unarchive' ? copy.inventory.history_full_for_unarchive : copy.inventory.delete_result,
      })
      onWorkspaceUpdated(profileId, data.workspace)
      setWorkspaceNotice(action === 'archive' ? copy.inventory.archive_done : action === 'unarchive' ? copy.inventory.unarchive_done : copy.inventory.delete_result_done)
    } catch (error) {
      setWorkspaceError((error as Error).message)
    } finally {
      setWorkspaceBusyAction(null)
    }
  }, [onWorkspaceUpdated, profileId, setWorkspaceBusyAction, setWorkspaceError, setWorkspaceNotice])

  return {
    handleSaveCurrentConfig,
    handleRenameSavedConfig,
    handleDeleteSavedConfig,
    handleUseSavedConfig,
    handleViewHistory,
    handleUseHistoryConfig,
    handleDownloadHistory,
    handleArchiveHistory: (item: WorkspaceResultHistorySummary) => mutateHistoryResult(item, 'archive'),
    handleUnarchiveHistory: (item: WorkspaceResultHistorySummary) => mutateHistoryResult(item, 'unarchive'),
    handleDeleteHistory: (item: WorkspaceResultHistorySummary) => mutateHistoryResult(item, 'delete'),
  }
}
