import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AuthSuccessResponse, LicenseConfig, OptimizeResult, UpgradeSuggestion, WorkspaceResultHistoryItem, WorkspaceSavedConfig, WorkspaceSavedConfigAction } from '../../../lib/types'
import { downloadOptimizeResult, isMaaJsonDownloadable } from '../../../lib/workspace-history'
import { normalizeUpgradeSuggestions } from './workflow-utils'
import type { WorkspacePatch } from '../useToolSession'
import type { OptimizePhase, OptimizeSection } from './types'
import { copy } from '../../../copy/index'


type Setter<T> = Dispatch<SetStateAction<T>>

type UseOptimizeWorkspaceOptions = {
  activeConfig: LicenseConfig
  normalizeAllowedConfigOverride: (config: LicenseConfig) => LicenseConfig
  onWorkspacePatch: (patch: WorkspacePatch) => Promise<AuthSuccessResponse | void>
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
}

export function useOptimizeWorkspace({
  activeConfig,
  normalizeAllowedConfigOverride,
  onWorkspacePatch,
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

  const handleViewHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    setCurrentResult(null)
    setFinalResult(null)
    setSuggestions(normalizeUpgradeSuggestions(item.result.upgrade_suggestions))
    setHistoryItem(item)
    setPhase('history')
    setLastGeneratedSignature(null)
    setInlineError(null)
    setSection('result')
  }, [setCurrentResult, setFinalResult, setHistoryItem, setInlineError, setLastGeneratedSignature, setPhase, setSection, setSuggestions])

  const handleUseHistoryConfig = useCallback((item: WorkspaceResultHistoryItem) => {
    handleViewHistory(item)
    if (!item.config) {
      setWorkspaceError(copy.workspace.pages_tool_optimize_useOptimizeWorkspace_010)
      return
    }
    setConfigOverride(normalizeAllowedConfigOverride(item.config))
    setWorkspaceNotice(`${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_011}${item.name}${copy.workspace.pages_tool_optimize_useOptimizeWorkspace_012}`)
    setSection('config')
  }, [handleViewHistory, normalizeAllowedConfigOverride, setConfigOverride, setSection, setWorkspaceError, setWorkspaceNotice])

  const handleDownloadHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    if (!isMaaJsonDownloadable(item.result)) {
      setWorkspaceError(copy.workspace.pages_tool_optimize_useOptimizeWorkspace_013)
      return
    }
    downloadOptimizeResult(item.result, `maa-schedule-${item.id.slice(0, 8) || 'history'}`)
  }, [setWorkspaceError])

  return {
    handleSaveCurrentConfig,
    handleRenameSavedConfig,
    handleDeleteSavedConfig,
    handleUseSavedConfig,
    handleViewHistory,
    handleUseHistoryConfig,
    handleDownloadHistory,
  }
}
