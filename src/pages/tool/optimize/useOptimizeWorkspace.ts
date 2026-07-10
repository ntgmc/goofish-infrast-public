import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AuthSuccessResponse, LicenseConfig, OptimizeResult, UpgradeSuggestion, WorkspaceResultHistoryItem, WorkspaceSavedConfig, WorkspaceSavedConfigAction } from '../../../lib/types'
import { downloadOptimizeResult, isMaaJsonDownloadable } from '../../../lib/workspace-history'
import type { WorkspacePatch } from '../useToolSession'
import type { OptimizePhase, OptimizeSection } from './types'

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
  setSection: Setter<OptimizeSection>
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
      setWorkspaceError('请填写方案名称。')
      return
    }
    await runSavedConfigAction('save-current', {
      type: 'save',
      name: trimmed,
      config: activeConfig,
    }, `已保存方案“${trimmed}”。`)
  }, [activeConfig, runSavedConfigAction, setWorkspaceError])

  const handleRenameSavedConfig = useCallback(async (config: WorkspaceSavedConfig) => {
    const nextName = window.prompt('新的方案名称', config.name)
    if (nextName === null) return
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === config.name) return
    await runSavedConfigAction(`rename:${config.id}`, {
      type: 'rename',
      id: config.id,
      name: trimmed,
    }, `已重命名为“${trimmed}”。`)
  }, [runSavedConfigAction])

  const handleDeleteSavedConfig = useCallback(async (config: WorkspaceSavedConfig) => {
    if (!window.confirm(`删除方案“${config.name}”？`)) return
    await runSavedConfigAction(`delete:${config.id}`, {
      type: 'delete',
      id: config.id,
    }, `已删除方案“${config.name}”。`)
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
    setWorkspaceNotice(`已载入方案“${config.name}”，可以继续调整或重新生成。`)
    setSection('config')
    void runSavedConfigAction(`touch:${config.id}`, {
      type: 'touch',
      id: config.id,
    }, `已载入方案“${config.name}”。`)
  }, [normalizeAllowedConfigOverride, runSavedConfigAction, setConfigOverride, setCurrentResult, setFinalResult, setHistoryItem, setInlineError, setLastGeneratedSignature, setPhase, setSection, setSuggestions, setWorkspaceNotice])

  const handleViewHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    setCurrentResult(null)
    setFinalResult(null)
    setSuggestions([])
    setHistoryItem(item)
    setPhase('history')
    setLastGeneratedSignature(null)
    setInlineError(null)
    setSection('result')
  }, [setCurrentResult, setFinalResult, setHistoryItem, setInlineError, setLastGeneratedSignature, setPhase, setSection, setSuggestions])

  const handleUseHistoryConfig = useCallback((item: WorkspaceResultHistoryItem) => {
    handleViewHistory(item)
    if (!item.config) {
      setWorkspaceError('这条旧结果没有保存配置快照，只能查看或下载。')
      return
    }
    setConfigOverride(normalizeAllowedConfigOverride(item.config))
    setWorkspaceNotice(`已载入历史配置“${item.name}”，可继续调整后重新生成。`)
    setSection('config')
  }, [handleViewHistory, normalizeAllowedConfigOverride, setConfigOverride, setSection, setWorkspaceError, setWorkspaceNotice])

  const handleDownloadHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    if (!isMaaJsonDownloadable(item.result)) {
      setWorkspaceError('游戏内轮换模式不生成 MAA JSON。')
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
