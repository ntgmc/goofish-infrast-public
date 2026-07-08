import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react'
import type {
  Announcement,
  AuthSuccessResponse,
  FreeScheduleEntitlement,
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  OptimizeJobAccepted,
  OptimizeJobStatusResponse,
  OptimizeRequest,
  OptimizeResult,
  ReorderCheckResult,
  UpgradeSuggestion,
  UpgradeTaskPayload,
  UserGameAccount,
  UserWorkspace,
  WorkspaceResultHistoryItem,
  WorkspaceSavedConfig,
  WorkspaceSavedConfigAction,
} from '../lib/types'
import { canEditConfig, canReplaceOperators, canUseUpgradeFeatures, getPermissionMode, mergeOperators } from '../lib/license'
import { deriveClientKey, signClientState, encryptPayload, canonicalJson } from '../lib/crypto'
import { getActivationTokenForLicense } from '../lib/activation-token'
import AnnouncementBanner from '../components/AnnouncementBanner'
import { apiJson } from '../lib/api-client'
import { normalizeConfig, validateConfig, normalizeScheduleMode, normalizeDormitoryRule } from '../lib/config'
import {
  SCHEDULE_PROGRESS_COMPLETION_DURATION_MS,
  type ScheduleProgressState,
} from '../components/ScheduleProgress'
import {
  describeConfigDiff,
  downloadOptimizeResult,
  isMaaJsonDownloadable,
} from '../lib/workspace-history'
import AdminOperatorPanel from './tool/optimize/AdminOperatorPanel'
import ConfigSection from './tool/optimize/ConfigSection'
import { ConfigValidationToast, LicenseSyncPanel } from './tool/optimize/feedback'
import OptimizeShell from './tool/optimize/OptimizeShell'
import OverviewSection from './tool/optimize/OverviewSection'
import PlansSection from './tool/optimize/PlansSection'
import ResultSection from './tool/optimize/ResultSection'
import type { OptimizePhase, OptimizeSection } from './tool/optimize/types'
import { getProfileAccessLabel, isFreePreviewProfile } from './tool/tool-utils'

interface Props {
  profileId: string;
  profile: UserGameAccount;
  license: LicenseFile;
  workspace: UserWorkspace | null;
  setLicense: (v: LicenseFile) => void;
  eliteOverrides: Record<string, number>;
  setEliteOverrides: (v: Record<string, number>) => void;
  configOverride: LicenseConfig | null;
  setConfigOverride: (v: LicenseConfig | null) => void;
  onWorkspacePatch: (patch: WorkspacePatch) => Promise<AuthSuccessResponse | void>;
  onReset: () => void;
  announcement: Announcement | null;
  redeemedNotice: string | null;
  onRedownloadLicense: (() => void) | null;
  onProfileUpgraded: (payload: AuthSuccessResponse) => void;
}

type WorkspacePatch = Partial<UserWorkspace> & { saved_config_action?: WorkspaceSavedConfigAction }

interface LicenseStatusResponse {
  error?: string;
  permission_label?: string;
  operator_update_available?: boolean;
  operator_update_limit?: { window_days: 7; max_updates: 2; used: number; next_available_at?: string };
  operator_update_next_available_at?: string;
  risk_status?: 'ok' | 'frozen';
  license?: LicenseFile | null;
  license_file_content?: string | null;
}

export default function OptimizePage({
  profileId,
  profile,
  license,
  workspace,
  setLicense,
  eliteOverrides,
  setEliteOverrides,
  configOverride,
  setConfigOverride,
  onWorkspacePatch,
  onReset,
  announcement,
  redeemedNotice,
  onRedownloadLicense,
  onProfileUpgraded,
}: Props) {
  const initialHistoryItem = workspace?.result_history?.[0] ?? null
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([])
  const [currentResult, setCurrentResult] = useState<OptimizeResult | null>(null)
  const [finalResult, setFinalResult] = useState<OptimizeResult | null>(null)
  const [historyItem, setHistoryItem] = useState<WorkspaceResultHistoryItem | null>(initialHistoryItem)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ScheduleProgressState | null>(null)
  const [phase, setPhase] = useState<OptimizePhase>(initialHistoryItem ? 'history' : 'idle')
  const [section, setSection] = useState<OptimizeSection>('overview')
  const [operatorUploadStatus, setOperatorUploadStatus] = useState<string | null>(null)
  const [licenseSyncing, setLicenseSyncing] = useState(true)
  const [licenseSyncStatus, setLicenseSyncStatus] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<{ scope: 'generate' | 'apply'; message: string } | null>(null)
  const [reorderCheckLoading, setReorderCheckLoading] = useState(false)
  const [reorderCheckResult, setReorderCheckResult] = useState<ReorderCheckResult | null>(null)
  const [reorderCheckError, setReorderCheckError] = useState<string | null>(null)
  const [freeScheduleEntitlementOverride, setFreeScheduleEntitlementOverride] = useState<FreeScheduleEntitlement | null>(null)
  const [freeScheduleConfirming, setFreeScheduleConfirming] = useState(false)
  const [freeScheduleConfirmError, setFreeScheduleConfirmError] = useState<string | null>(null)
  const [configToast, setConfigToast] = useState<{ id: number; message: string } | null>(null)
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceBusyAction, setWorkspaceBusyAction] = useState<string | null>(null)
  const [upgradeCdk, setUpgradeCdk] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const [lastGeneratedSignature, setLastGeneratedSignature] = useState<string | null>(null)
  const operatorFileRef = useRef<HTMLInputElement>(null)
  const optimizeInFlightRef = useRef(false)
  const optimizeRestoreKeyRef = useRef<string | null>(null)
  const configToastTimerRef = useRef<number | null>(null)
  const configToastIdRef = useRef(0)
  const pendingLicenseSyncRef = useRef<{ license: LicenseFile; message: string } | null>(null)

  const isPreviewProfile = isFreePreviewProfile(profile)
  const permission = getPermissionMode(license)
  const userCanReplaceOperators = false
  const userCanEditConfig = canEditConfig(license)
  const userCanUseIntermediateAutoConfig = isPreviewProfile || permission === 'recommended' || permission === 'growth'
  const userCanApplyConfigOverride = true
  const userCanUseUpgradeFeatures = !isPreviewProfile && canUseUpgradeFeatures(license)
  const activeConfig = useMemo(
    () => normalizeConfig(configOverride ?? license.config),
    [configOverride, license.config]
  )
  const baseConfig = useMemo(() => normalizeConfig(license.config), [license.config])
  const configChanged = useMemo(
    () => canonicalJson(activeConfig) !== canonicalJson(baseConfig),
    [activeConfig, baseConfig]
  )
  const configValidation = useMemo(() => validateConfig(activeConfig), [activeConfig])
  const configValidationMessage = configValidation.ok === false ? configValidation.message : null
  const configPresetLabel = useMemo(() => formatConfigPresetLabel(activeConfig), [activeConfig])
  const savedConfigs = workspace?.saved_configs ?? []
  const resultHistory = workspace?.result_history ?? []
  const latestWorkspaceResult = resultHistory[0] ?? null
  const freeScheduleEntitlement =
    freeScheduleEntitlementOverride
    ?? finalResult?.preview_limit?.free_schedule_entitlement
    ?? reorderCheckResult?.free_schedule_entitlement
    ?? workspace?.free_schedule_entitlement
    ?? null
  const freeScheduleGenerateBlockedReason = useMemo(
    () => getFreeScheduleGenerateBlockedReason(isPreviewProfile, freeScheduleEntitlement),
    [freeScheduleEntitlement, isPreviewProfile],
  )
  const reorderCheckDisabledReason = useMemo(() => {
    if (!isPreviewProfile) return null
    if (!profile.skland_binding) return '请先绑定森空岛后再检测。'
    if (!latestWorkspaceResult) return '请先生成一次个人排班作为检测基线。'
    if (licenseSyncing) return '干员数据同步中，稍后再检测。'
    if (configValidationMessage) return configValidationMessage
    return null
  }, [configValidationMessage, isPreviewProfile, latestWorkspaceResult, licenseSyncing, profile.skland_binding])
  const configDiffRows = useMemo(
    () => describeConfigDiff(activeConfig, latestWorkspaceResult?.config ?? null),
    [activeConfig, latestWorkspaceResult]
  )

  const normalizeAllowedConfigOverride = useCallback((nextConfig: LicenseConfig): LicenseConfig => {
    const next = normalizeConfig(nextConfig)
    if (userCanEditConfig) return next

    const limited = normalizeConfig(baseConfig)
    limited.schedule_mode = normalizeScheduleMode(next.schedule_mode)
    limited.dormitory_rule = normalizeDormitoryRule(next.dormitory_rule)
    if (limited.schedule_mode === 'rotation') {
      limited.Fiammetta = { ...(limited.Fiammetta ?? {}), enable: false }
      limited.drones = { ...(limited.drones ?? { order: 'pre', targets: [] }), enable: false }
    } else if (userCanUseIntermediateAutoConfig && (next.auto_balance_source === 'intermediate_inventory' || next.auto_balance_source === 'limited_config')) {
      limited.intermediate_inventory = next.intermediate_inventory
      limited.auto_balance_source = next.auto_balance_source
      limited.drones = next.drones
    }

    return limited
  }, [baseConfig, userCanEditConfig, userCanUseIntermediateAutoConfig])

  const clearConfigValidationToast = useCallback(() => {
    if (configToastTimerRef.current !== null) {
      window.clearTimeout(configToastTimerRef.current)
      configToastTimerRef.current = null
    }
    setConfigToast(null)
  }, [])

  const showConfigValidationToast = useCallback((message: string) => {
    if (configToastTimerRef.current !== null) {
      window.clearTimeout(configToastTimerRef.current)
    }
    configToastIdRef.current += 1
    setConfigToast({ id: configToastIdRef.current, message })
    configToastTimerRef.current = window.setTimeout(() => {
      setConfigToast(null)
      configToastTimerRef.current = null
    }, 4200)
  }, [])

  useEffect(() => {
    return () => {
      if (configToastTimerRef.current !== null) {
        window.clearTimeout(configToastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const nextHistoryItem = workspace?.result_history?.[0] ?? null
    setSuggestions([])
    setCurrentResult(null)
    setFinalResult(null)
    setHistoryItem(nextHistoryItem)
    setProgress(null)
    setPhase(nextHistoryItem ? 'history' : 'idle')
    setSection('overview')
    setInlineError(null)
    setReorderCheckLoading(false)
    setReorderCheckResult(null)
    setReorderCheckError(null)
    setFreeScheduleEntitlementOverride(null)
    setFreeScheduleConfirming(false)
    setFreeScheduleConfirmError(null)
    setLastGeneratedSignature(null)
    setUpgradeCdk('')
    setUpgradeError(null)
  }, [profileId, workspace?.profile_id])

  const mergedOperators = useMemo(
    () => mergeOperators(license.operators, eliteOverrides),
    [license.operators, eliteOverrides]
  )
  const optimizeSignature = useMemo(
    () => buildOptimizeSignature(mergedOperators, activeConfig),
    [activeConfig, mergedOperators]
  )
  const hasResult = Boolean(finalResult || currentResult || historyItem)
  const resultIsCurrent = hasResult && lastGeneratedSignature === optimizeSignature
  const clearGeneratedResult = useCallback(() => {
    setSuggestions([])
    setCurrentResult(null)
    setFinalResult(null)
    setHistoryItem(null)
    setProgress(null)
    setPhase('idle')
    setInlineError(null)
    setLastGeneratedSignature(null)
  }, [])

  const applySyncedLicense = useCallback((nextLicense: LicenseFile, message: string) => {
    if (optimizeInFlightRef.current) {
      pendingLicenseSyncRef.current = { license: nextLicense, message }
      setLicenseSyncStatus(`${message} 当前计算完成后生效。`)
      return
    }
    setLicense(nextLicense)
    setLicenseSyncStatus(message)
    clearGeneratedResult()
  }, [clearGeneratedResult, setLicense])

  const flushPendingLicenseSync = useCallback(() => {
    const pending = pendingLicenseSyncRef.current
    if (!pending) return
    pendingLicenseSyncRef.current = null
    setLicense(pending.license)
    setLicenseSyncStatus(pending.message)
    clearGeneratedResult()
  }, [clearGeneratedResult, setLicense])

  useEffect(() => {
    let cancelled = false
    setLicenseSyncing(true)

    apiJson<LicenseStatusResponse>(`/api/user/status?profile_id=${encodeURIComponent(profileId)}`, {
      fallbackMessage: '账号授权状态同步失败',
    })
      .then(() => {
        if (!cancelled) {
          setLicenseSyncStatus(null)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLicenseSyncStatus((error as Error).message)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLicenseSyncing(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [license.order_hash, profileId])

  const handleReplaceOperators = useCallback(async () => {
    if (!userCanReplaceOperators) return
    const file = operatorFileRef.current?.files?.[0]
    if (!file) {
      operatorFileRef.current?.click()
      return
    }
    try {
      const nextOperators = parseOperatorsFile(await file.text())
      const confirmed = window.confirm(
`确认替换当前授权内的干员数据？\n\n新文件识别到 ${nextOperators.length} 名干员。继续后会清空当前练度调整。单账号终身卡每 7 天最多更新 2 次，并会校验账号与设备绑定。`
      )
      if (!confirmed) {
        if (operatorFileRef.current) {
          operatorFileRef.current.value = ''
        }
        return
      }
      const data = await apiJson<LicenseStatusResponse>('/api/license-status', {
        method: 'POST',
        json: {
          profile_id: profileId,
          license,
          operators: nextOperators,
          activation_token: getActivationTokenForLicense(license),
        },
        fallbackMessage: '干员数据更新失败',
      })
      if (!data.license) {
        throw new Error('干员数据更新失败')
      }
      setLicense(data.license)
      setEliteOverrides({})
      clearGeneratedResult()
      setOperatorUploadStatus(`已更新授权内的干员数据，共 ${nextOperators.length} 名。`)
      if (operatorFileRef.current) {
        operatorFileRef.current.value = ''
      }
    } catch (error) {
      setOperatorUploadStatus((error as Error).message)
    }
  }, [clearGeneratedResult, license, setEliteOverrides, setLicense, userCanReplaceOperators])

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    if (!userCanApplyConfigOverride) return
    const draft = normalizeConfig(activeConfig)
    mutate(draft)
    draft.layout = `${draft.trading_stations_count}-${draft.manufacturing_stations_count}-3`
    const next = normalizeAllowedConfigOverride(draft)
    setConfigOverride(next)
    const nextValidation = validateConfig(next)
    if (nextValidation.ok) {
      clearConfigValidationToast()
    } else {
      showConfigValidationToast(nextValidation.message)
    }
    setInlineError(null)
    setReorderCheckResult(null)
    setReorderCheckError(null)
  }, [activeConfig, clearConfigValidationToast, normalizeAllowedConfigOverride, setConfigOverride, showConfigValidationToast, userCanApplyConfigOverride])

  const resetConfig = useCallback(() => {
    setConfigOverride(null)
    clearConfigValidationToast()
    setInlineError(null)
    setReorderCheckResult(null)
    setReorderCheckError(null)
  }, [clearConfigValidationToast, setConfigOverride])

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
  }, [onWorkspacePatch])

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
  }, [activeConfig, runSavedConfigAction])

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
    const nextConfig = normalizeAllowedConfigOverride(config.config)
    setConfigOverride(nextConfig)
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
  }, [normalizeAllowedConfigOverride, runSavedConfigAction, setConfigOverride])

  const handleViewHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    setCurrentResult(null)
    setFinalResult(null)
    setSuggestions([])
    setHistoryItem(item)
    setPhase('history')
    setLastGeneratedSignature(null)
    setInlineError(null)
    setSection('result')
  }, [])

  const handleUseHistoryConfig = useCallback((item: WorkspaceResultHistoryItem) => {
    handleViewHistory(item)
    if (!item.config) {
      setWorkspaceError('这条旧结果没有保存配置快照，只能查看或下载。')
      return
    }
    setConfigOverride(normalizeAllowedConfigOverride(item.config))
    setWorkspaceNotice(`已载入历史配置“${item.name}”，可继续调整后重新生成。`)
    setSection('config')
  }, [handleViewHistory, normalizeAllowedConfigOverride, setConfigOverride])

  const handleDownloadHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    if (!isMaaJsonDownloadable(item.result)) {
      setWorkspaceError('游戏内轮换模式不生成 MAA JSON。')
      return
    }
    downloadOptimizeResult(item.result, `maa-schedule-${item.id.slice(0, 8) || 'history'}`)
  }, [])

  const pollOptimizeJob = useCallback(async (
    job: OptimizeJobAccepted | OptimizeJobStatusResponse,
    storageKey: string,
    progressMode: ScheduleProgressState['mode'],
    fallbackMessage: string,
    isCancelled?: () => boolean,
  ): Promise<OptimizeResult> => {
    const throwIfCancelled = () => {
      if (isCancelled?.()) throw new OptimizeJobPollCancelledError()
    }
    const updateProgress = (next: OptimizeJobAccepted | OptimizeJobStatusResponse) => {
      setProgress((current) => ({
        mode: current?.mode ?? progressMode,
        startedAt: current?.startedAt ?? (Date.parse(next.submitted_at) || Date.now()),
        queueStatus: next.status === 'queued' || next.status === 'running' ? next.status : current?.queueStatus,
        queuePosition: next.queue_position,
        priority: next.priority,
        jobId: next.job_id,
      }))
    }

    updateProgress(job)
    let pollAfterMs = job.poll_after_ms || (job.status === 'queued' ? 1200 : 900)
    while (true) {
      throwIfCancelled()
      await waitForOptimizePoll(pollAfterMs)
      throwIfCancelled()
      const status = await apiJson<OptimizeJobStatusResponse>('/api/optimize/job?id=' + encodeURIComponent(job.job_id), {
        fallbackMessage,
      })
      throwIfCancelled()
      writeActiveOptimizeJob(storageKey, status)
      updateProgress(status)

      if (status.status === 'succeeded') {
        if (!status.result) throw new Error('优化任务缺少结果。')
        clearActiveOptimizeJob(storageKey)
        return status.result
      }
      if (status.status === 'failed') {
        clearActiveOptimizeJob(storageKey)
        throw new Error(status.error || '优化任务失败，请重试。')
      }
      pollAfterMs = status.poll_after_ms || (status.status === 'queued' ? 1200 : 900)
    }
  }, [])

  const runOptimizeJob = useCallback(async (
    payload: OptimizeRequest,
    progressMode: ScheduleProgressState['mode'],
    fallbackMessage: string,
  ): Promise<OptimizeResult> => {
    const accepted = await apiJson<OptimizeJobAccepted>('/api/optimize', {
      method: 'POST',
      json: payload,
      fallbackMessage,
    })
    const storageKey = buildOptimizeJobStorageKey(profileId, license.order_hash, optimizeSignature, progressMode)
    writeActiveOptimizeJob(storageKey, accepted)

    try {
      return await pollOptimizeJob(accepted, storageKey, progressMode, fallbackMessage)
    } catch (error) {
      if (!isOptimizeJobPollCancelled(error)) {
        clearActiveOptimizeJob(storageKey)
      }
      throw error
    }
  }, [license.order_hash, optimizeSignature, pollOptimizeJob, profileId])

  useEffect(() => {
    if (optimizeInFlightRef.current) return
    const modes: ScheduleProgressState['mode'][] = ['apply', 'generate']
    const active = modes
      .map((mode) => {
        const storageKey = buildOptimizeJobStorageKey(profileId, license.order_hash, optimizeSignature, mode)
        return { mode, storageKey, job: readActiveOptimizeJob(storageKey) }
      })
      .find(({ job }) => isActiveOptimizeJob(job))
    if (!active || !isActiveOptimizeJob(active.job)) return
    if (optimizeRestoreKeyRef.current === active.storageKey) return
    const activeJob = active.job

    optimizeRestoreKeyRef.current = active.storageKey
    optimizeInFlightRef.current = true
    setLoading(true)
    setInlineError(null)
    setProgress({
      mode: active.mode,
      startedAt: Date.parse(activeJob.submitted_at) || Date.now(),
      queueStatus: activeJob.status,
      queuePosition: activeJob.queue_position,
      priority: activeJob.priority,
      jobId: activeJob.job_id,
    })

    let cancelled = false
    void (async () => {
      let completed = false
      try {
        const result = await pollOptimizeJob(
          activeJob,
          active.storageKey,
          active.mode,
          active.mode === 'apply' ? '优化失败' : '优化请求失败',
          () => cancelled,
        )
        if (cancelled) return
        completed = true
        setProgress({
          mode: active.mode,
          startedAt: Date.parse(activeJob.submitted_at) || Date.now(),
          completedAt: Date.now(),
        })
        await waitForProgressCompletion()
        if (active.mode === 'apply') {
          setFinalResult(result)
          setPhase('final')
        } else {
          const current = result.current_result ?? result
          setCurrentResult(current)
          setFinalResult(null)
          setHistoryItem(null)
          setSuggestions((result.upgrade_suggestions ?? []) as UpgradeSuggestion[])
          if (current.preview_limit?.free_schedule_entitlement) {
            setFreeScheduleEntitlementOverride(current.preview_limit.free_schedule_entitlement)
          }
          setPhase('suggestions')
        }
        setSection('result')
        setLastGeneratedSignature(optimizeSignature)
      } catch (error) {
        if (!cancelled && !isOptimizeJobPollCancelled(error)) {
          clearActiveOptimizeJob(active.storageKey)
          setInlineError({
            scope: active.mode === 'apply' ? 'apply' : 'generate',
            message: formatOptimizeError(error instanceof Error ? error.message : String(error)),
          })
        }
      } finally {
        if (!cancelled) {
          optimizeInFlightRef.current = false
          setLoading(false)
          flushPendingLicenseSync()
          if (!completed) {
            setProgress(null)
          }
        }
      }
    })()

    return () => {
      cancelled = true
      optimizeInFlightRef.current = false
    }
  }, [flushPendingLicenseSync, license.order_hash, optimizeSignature, pollOptimizeJob, profileId])

  const runOptimize = useCallback(async (ignoreElite: boolean, includeCurrent = false) => {
    const payload: OptimizeRequest = {
      profile_id: profileId,
      license,
      operators: mergedOperators,
      config: activeConfig,
      ignore_elite: ignoreElite,
      activation_token: getActivationTokenForLicense(license),
      ...(includeCurrent && { include_current: true }),
    }
    return await runOptimizeJob(payload, 'generate', '优化请求失败')
  }, [activeConfig, license, mergedOperators, profileId, runOptimizeJob])

  const runUpgradeSuggestions = useCallback(async (taskPayload: UpgradeTaskPayload) => {
    const payload: OptimizeRequest = {
      profile_id: profileId,
      license,
      operators: mergedOperators,
      config: activeConfig,
      ignore_elite: true,
      activation_token: getActivationTokenForLicense(license),
      suggestions_only: true,
      upgrade_task_payload: taskPayload,
    }
    return await runOptimizeJob(payload, 'generate', '练度建议请求失败。')
  }, [activeConfig, license, mergedOperators, profileId, runOptimizeJob])
  const handleReorderCheck = useCallback(async () => {
    if (!isPreviewProfile || reorderCheckLoading || loading) return
    if (reorderCheckDisabledReason) {
      setReorderCheckError(reorderCheckDisabledReason)
      return
    }
    if (!latestWorkspaceResult) return
    setReorderCheckLoading(true)
    setReorderCheckResult(null)
    setReorderCheckError(null)
    try {
      const data = await apiJson<ReorderCheckResult>('/api/optimize/reorder-check', {
        method: 'POST',
        json: {
          profile_id: profileId,
          config: activeConfig,
          baseline_history_id: latestWorkspaceResult.id,
        },
        fallbackMessage: '重排检测失败',
      })
      setReorderCheckResult(data)
      if (data.free_schedule_entitlement) {
        setFreeScheduleEntitlementOverride(data.free_schedule_entitlement)
      }
    } catch (error) {
      setReorderCheckError((error as Error).message)
    } finally {
      setReorderCheckLoading(false)
    }
  }, [activeConfig, isPreviewProfile, latestWorkspaceResult, loading, profileId, reorderCheckDisabledReason, reorderCheckLoading])

  const handleConfirmFreeSchedule = useCallback(async () => {
    if (!isPreviewProfile || freeScheduleConfirming || !latestWorkspaceResult) return
    setFreeScheduleConfirming(true)
    setFreeScheduleConfirmError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>('/api/user/workspace/free-schedule/confirm', {
        method: 'POST',
        json: {
          profile_id: profileId,
          result_history_id: latestWorkspaceResult.id,
        },
        fallbackMessage: '确认免费排班失败',
      })
      setFreeScheduleEntitlementOverride(data.workspace?.free_schedule_entitlement ?? null)
    } catch (error) {
      setFreeScheduleConfirmError((error as Error).message)
    } finally {
      setFreeScheduleConfirming(false)
    }
  }, [freeScheduleConfirming, isPreviewProfile, latestWorkspaceResult, profileId])

  const handleGenerate = useCallback(async () => {
    if (licenseSyncing || loading || optimizeInFlightRef.current) return
    if (hasResult && lastGeneratedSignature === optimizeSignature) return
    if (freeScheduleGenerateBlockedReason) {
      setInlineError({ scope: 'generate', message: freeScheduleGenerateBlockedReason })
      return
    }
    if (configValidationMessage) {
      showConfigValidationToast(configValidationMessage)
      return
    }
    optimizeInFlightRef.current = true
    setInlineError(null)
    setReorderCheckResult(null)
    setReorderCheckError(null)
    setHistoryItem(null)
    setPhase('idle')
    setLoading(true)
    const startedAt = Date.now()
    setProgress({ mode: 'generate', startedAt })
    let completed = false
    try {
      const potential = userCanUseUpgradeFeatures ? await runOptimize(true, true) : null
      const current = potential?.current_result ?? (await runOptimize(false))
      if (current.preview_limit?.free_schedule_entitlement) {
        setFreeScheduleEntitlementOverride(current.preview_limit.free_schedule_entitlement)
      }
      setCurrentResult(current)
      const suggestionResult = potential?.upgrade_task_payload
        ? await runUpgradeSuggestions(potential.upgrade_task_payload)
        : potential
      const serverSuggestions = suggestionResult?.upgrade_suggestions
      const upgradeList: UpgradeSuggestion[] = serverSuggestions && serverSuggestions.length > 0
            ? serverSuggestions.map((s, idx) => {
              if (s.type === 'single') {
                return {
                  type: 'single' as const,
                  id: s.id || s.name || '',
                  name: s.name,
                  current_elite: s.current,
                  target_elite: s.target,
                  gain: Math.round(s.gain),
                  desc: `${s.name}: 精${s.current} → 精${s.target}`,
                  training_cost: s.training_cost,
                  rooms: s.rooms,
                  specialType: s.specialType,
                  roi: s.roi,
                  impact: s.impact,
                  partial_outcomes: s.partial_outcomes,
                  partial_outcomes_truncated: s.partial_outcomes_truncated,
                  partial_outcomes_unavailable_reason: s.partial_outcomes_unavailable_reason,
                }
              }
              return {
                type: 'bundle' as const,
                id: `bundle-${idx}`,
                gain: Math.round(s.gain),
                desc: s.ops?.map(o => `${o.name}: 精${o.current}→精${o.target}`).join(', ') || '',
                ops: s.ops?.map(o => ({
                  id: o.id || o.name,
                  name: o.name,
                  current: o.current,
                  target: o.target,
                  current_elite: o.current,
                  target_elite: o.target,
                })),
                training_cost: s.training_cost,
                rooms: s.rooms,
                specialType: s.specialType,
                roi: s.roi,
                impact: s.impact,
                partial_outcomes: s.partial_outcomes,
                partial_outcomes_truncated: s.partial_outcomes_truncated,
                partial_outcomes_unavailable_reason: s.partial_outcomes_unavailable_reason,
              }
            })
        : []
      completed = true
      setProgress({ mode: 'generate', startedAt, completedAt: Date.now() })
      await waitForProgressCompletion()
      setSuggestions(upgradeList.sort((a, b) => b.gain - a.gain).slice(0, 20))
      setPhase('suggestions')
      setSection('result')
      setLastGeneratedSignature(optimizeSignature)
    } catch (e) {
      setInlineError({ scope: 'generate', message: formatOptimizeError((e as Error).message) })
    } finally {
      optimizeInFlightRef.current = false
      setLoading(false)
      flushPendingLicenseSync()
      if (!completed) {
        setProgress(null)
      }
    }
  }, [configValidationMessage, flushPendingLicenseSync, freeScheduleGenerateBlockedReason, hasResult, lastGeneratedSignature, licenseSyncing, loading, optimizeSignature, runOptimize, runUpgradeSuggestions, showConfigValidationToast, userCanUseUpgradeFeatures])

  const handleApplySuggestions = useCallback(async (selectedIds: string[]) => {
    if (loading || optimizeInFlightRef.current) return
    if (!resultIsCurrent) {
      setInlineError({ scope: 'apply', message: '基建配置已修改，请先重新计算排班后再应用练度建议。' })
      return
    }
    optimizeInFlightRef.current = true
    setInlineError(null)
    const startedAt = Date.now()
    setProgress({ mode: 'apply', startedAt })
    let completed = false
    const selectedSet = new Set(selectedIds)
    const newOverrides = { ...eliteOverrides }
    for (const s of suggestions) {
      if (s.type === 'single' && s.id && selectedSet.has(s.id) && s.target_elite !== undefined) {
        newOverrides[s.id] = s.target_elite
      }
      if (s.type === 'bundle' && s.id && s.ops && selectedSet.has(s.id)) {
        for (const op of s.ops) {
          if (op.id && op.target_elite !== undefined) {
            newOverrides[op.id] = op.target_elite
          }
        }
      }
    }
    setEliteOverrides(newOverrides)
    setLoading(true)
    try {
      const applyPayload: OptimizeRequest = {
        profile_id: profileId,
        license,
        operators: mergeOperators(license.operators, newOverrides),
        config: activeConfig,
        ignore_elite: false,
        activation_token: getActivationTokenForLicense(license),
        history_source: 'applied_suggestions',
      }
      const data = await runOptimizeJob(applyPayload, 'apply', '优化失败')
      completed = true
      setProgress({ mode: 'apply', startedAt, completedAt: Date.now() })
      await waitForProgressCompletion()
      setFinalResult(data)
      setPhase('final')
      setSection('result')
      setLastGeneratedSignature(buildOptimizeSignature(mergeOperators(license.operators, newOverrides), activeConfig))
    } catch (e) {
      setInlineError({ scope: 'apply', message: formatOptimizeError((e as Error).message) })
    } finally {
      optimizeInFlightRef.current = false
      setLoading(false)
      if (!completed) {
        setProgress(null)
      }
    }
  }, [activeConfig, eliteOverrides, loading, resultIsCurrent, runOptimizeJob, suggestions, license, profileId, setEliteOverrides])

  const handleDownloadMAA = useCallback(() => {
    const data = finalResult || currentResult || historyItem?.result
    if (!data) return
    downloadOptimizeResult(data, 'maa_schedule_optimized')
  }, [finalResult, currentResult, historyItem])

  const handleUpgradePreviewProfile = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!isPreviewProfile || upgradeLoading) return
    setUpgradeLoading(true)
    setUpgradeError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>('/api/user/profiles/redeem', {
        method: 'POST',
        json: { profile_id: profileId, cdk: upgradeCdk },
        fallbackMessage: '解锁失败',
      })
      setUpgradeCdk('')
      onProfileUpgraded(data)
    } catch (error) {
      setUpgradeError((error as Error).message)
    } finally {
      setUpgradeLoading(false)
    }
  }, [isPreviewProfile, onProfileUpgraded, profileId, upgradeCdk, upgradeLoading])

  const handleSaveWorkfile = useCallback(async () => {
    const savedConfigOverride = configChanged ? activeConfig : undefined
    const derivedKey = await deriveClientKey(license.sig)
    const clientSig = await signClientState(derivedKey, eliteOverrides, savedConfigOverride)
    const clientState: {
      operator_elite_overrides: Record<string, number>;
      config_override?: LicenseConfig;
      updated_at: string;
      client_sig: string;
    } = {
      operator_elite_overrides: eliteOverrides,
      updated_at: new Date().toISOString(),
      client_sig: clientSig,
    }
    if (savedConfigOverride) {
      clientState.config_override = savedConfigOverride
    }
    const workfile = {
      license,
      client_state: clientState,
    }
    const jsonStr = canonicalJson(workfile)
    const encrypted = await encryptPayload(jsonStr)
    const content = 'MAA-W1:' + encrypted
    const blob = new Blob([content], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `maa-workfile-${formatLocalDate(new Date())}.maa`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeConfig, configChanged, eliteOverrides, license])

  return (
    <OptimizeShell
      section={section}
      permissionLabel={getProfileAccessLabel(profile)}
      badges={{
        plans: `${savedConfigs.length}/${resultHistory.length}`,
        result: hasResult ? '有结果' : undefined,
      }}
      onSectionChange={setSection}
      onReset={onReset}
    >
      {configToast && <ConfigValidationToast key={configToast.id} message={configToast.message} />}
      <div className="space-y-4">
        {(licenseSyncing || licenseSyncStatus || announcement || redeemedNotice) && (
          <div className="space-y-3">
            {licenseSyncing && <LicenseSyncPanel />}

            {licenseSyncStatus && (
              <div className="rounded-lg border border-brand-600/30 bg-brand-600/10 px-4 py-3 text-sm leading-6 text-brand-300">
                {licenseSyncStatus}
              </div>
            )}

            <AnnouncementBanner announcement={announcement} />

            {redeemedNotice && (
              <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
                {redeemedNotice}
              </div>
            )}
          </div>
        )}

        {section === 'overview' && (
          <OverviewSection
            activeConfig={activeConfig}
            configChanged={configChanged}
            showConfigDetails={userCanEditConfig}
            operatorCount={license.operators.length}
            configPresetLabel={configPresetLabel}
            validation={configValidation}
            loading={loading}
            syncing={licenseSyncing}
            progress={progress?.mode === 'generate' ? progress : null}
            hasResult={hasResult}
            resultIsCurrent={resultIsCurrent}
            error={inlineError?.scope === 'generate' ? inlineError.message : null}
            savedConfigCount={savedConfigs.length}
            resultHistoryCount={resultHistory.length}
            latestResult={latestWorkspaceResult}
            freeSchedule={{
              visible: isPreviewProfile,
              entitlement: freeScheduleEntitlement,
              generateBlockedReason: freeScheduleGenerateBlockedReason,
              confirming: freeScheduleConfirming,
              confirmError: freeScheduleConfirmError,
              onConfirm: handleConfirmFreeSchedule,
            }}
            reorderCheck={{
              visible: isPreviewProfile,
              disabledReason: reorderCheckDisabledReason,
              loading: reorderCheckLoading,
              error: reorderCheckError,
              result: reorderCheckResult,
              onCheck: handleReorderCheck,
              onGenerate: handleGenerate,
            }}
            onGenerate={handleGenerate}
            onReset={onReset}
            onOpenPlans={() => setSection('plans')}
            onOpenConfig={() => setSection('config')}
            onOpenResult={() => setSection('result')}
            onViewHistory={handleViewHistory}
            onUseHistoryConfig={handleUseHistoryConfig}
            onDownloadHistory={handleDownloadHistory}
          />
        )}

        {section === 'plans' && (
          <PlansSection
            activeConfig={activeConfig}
            savedConfigs={savedConfigs}
            resultHistory={resultHistory}
            latestResult={latestWorkspaceResult}
            selectedHistoryId={historyItem?.id ?? null}
            diffRows={configDiffRows}
            busyAction={workspaceBusyAction}
            notice={workspaceNotice}
            error={workspaceError}
            onSaveCurrent={handleSaveCurrentConfig}
            onUseSavedConfig={handleUseSavedConfig}
            onRenameSavedConfig={handleRenameSavedConfig}
            onDeleteSavedConfig={handleDeleteSavedConfig}
            onViewHistory={handleViewHistory}
            onUseHistoryConfig={handleUseHistoryConfig}
            onDownloadHistory={handleDownloadHistory}
          />
        )}

        {section === 'config' && (
          <div className="space-y-4">
            <ConfigSection
              activeConfig={activeConfig}
              permission={permission}
              userCanEditConfig={userCanEditConfig}
              userCanUseIntermediateAutoConfig={userCanUseIntermediateAutoConfig}
              configChanged={configChanged}
              configPresetLabel={configPresetLabel}
              configValidation={configValidation}
              latestResult={latestWorkspaceResult}
              diffRows={configDiffRows}
              updateConfig={updateConfig}
              resetConfig={resetConfig}
            />
            {userCanReplaceOperators && (
            <AdminOperatorPanel
              operatorCount={license.operators.length}
              status={operatorUploadStatus}
              fileRef={operatorFileRef}
              onReplace={handleReplaceOperators}
            />
          )}
          </div>
        )}

        {section === 'result' && (
          <ResultSection
            phase={phase}
            historyItem={historyItem}
            currentResult={currentResult}
            finalResult={finalResult}
            operators={mergedOperators}
            suggestions={suggestions}
            loading={loading}
            progress={progress}
            inlineError={inlineError}
            previewProfile={isPreviewProfile}
            upgradeCdk={upgradeCdk}
            upgradeLoading={upgradeLoading}
            upgradeError={upgradeError}
            onUpgradeCdkChange={setUpgradeCdk}
            onUpgradePreviewProfile={handleUpgradePreviewProfile}
            onDownloadMAA={isPreviewProfile ? undefined : handleDownloadMAA}
            onApplySuggestions={handleApplySuggestions}
            onReset={onReset}
          />
        )}
      </div>
    </OptimizeShell>
  )
}

function buildOptimizeSignature(operators: LicenseOperator[], config: LicenseConfig): string {
  return canonicalJson({ operators, config })
}

function formatConfigPresetLabel(config: LicenseConfig): string {
  const layout = String(config.layout || `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`)
  const compactLayout = layout.replace(/-/g, '')
  const presetLayout = compactLayout === '243' || compactLayout === '333' ? compactLayout : layout
  const trading = config.product_requirements?.trading_stations ?? {}
  const suffix = (trading.Orundum ?? 0) > 0 ? '搓玉' : '均衡'
  return `${presetLayout} ${suffix}`
}

function waitForProgressCompletion(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SCHEDULE_PROGRESS_COMPLETION_DURATION_MS))
}

function waitForOptimizePoll(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(500, ms)))
}

function buildOptimizeJobStorageKey(
  profileId: string,
  orderHash: string,
  signature: string,
  mode: ScheduleProgressState['mode'],
): string {
  return ['maa-optimize-job', profileId || orderHash || 'anonymous', mode, signature].join(':')
}

function writeActiveOptimizeJob(key: string, job: OptimizeJobAccepted | OptimizeJobStatusResponse): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(job))
  } catch {
    // Session storage is best-effort only.
  }
}

function readActiveOptimizeJob(key: string): OptimizeJobAccepted | OptimizeJobStatusResponse | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<OptimizeJobAccepted | OptimizeJobStatusResponse>
    if (
      typeof value.job_id === 'string'
      && (value.status === 'queued' || value.status === 'running' || value.status === 'succeeded' || value.status === 'failed')
      && (value.priority === 'paid' || value.priority === 'standard')
      && typeof value.submitted_at === 'string'
    ) {
      return value as OptimizeJobAccepted | OptimizeJobStatusResponse
    }
  } catch {
    // Session storage is best-effort only.
  }
  return null
}

function isActiveOptimizeJob(
  job: OptimizeJobAccepted | OptimizeJobStatusResponse | null,
): job is OptimizeJobAccepted | (OptimizeJobStatusResponse & { status: 'queued' | 'running' }) {
  return job?.status === 'queued' || job?.status === 'running'
}

function clearActiveOptimizeJob(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Session storage is best-effort only.
  }
}

class OptimizeJobPollCancelledError extends Error {
  constructor() {
    super('optimize job polling cancelled')
    this.name = 'OptimizeJobPollCancelledError'
  }
}

function isOptimizeJobPollCancelled(error: unknown): boolean {
  return error instanceof OptimizeJobPollCancelledError
}

function formatOptimizeError(message: string): string {
  return message.includes('冻结') || message.includes('被冻结') || message.includes('已拦截')
    ? message
    : `优化失败: ${message}`
}

function getFreeScheduleGenerateBlockedReason(
  isPreviewProfile: boolean,
  entitlement: FreeScheduleEntitlement | null,
): string | null {
  if (!isPreviewProfile || !entitlement) return null
  if (hasUnusedStrongReorderBonus(entitlement)) return null
  if (!entitlement.first_generated_at) return null
  if (entitlement.confirmed_at || entitlement.locked_at) {
    return '免费完整排班权益已锁定。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。'
  }
  const firstGeneratedAt = Date.parse(entitlement.first_generated_at)
  if (!Number.isFinite(firstGeneratedAt)) return null
  const windowMs = entitlement.revision_window_hours * 60 * 60 * 1000
  if (Date.now() - firstGeneratedAt >= windowMs) {
    return '免费完整排班确认期已结束。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。'
  }
  if (entitlement.revision_count >= entitlement.revision_limit) {
    return '免费完整排班修正次数已用完。可继续查看已生成方案，或使用每月 2 次重排检测；需要重新生成完整方案请升级单账号终身版 CDK。'
  }
  return null
}

function hasUnusedStrongReorderBonus(entitlement: FreeScheduleEntitlement): boolean {
  const bonus = entitlement.strong_reorder_bonus
  return Boolean(bonus && bonus.month === getShanghaiMonthKey() && !bonus.used_at)
}

function getShanghaiMonthKey(date = new Date()): string {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseOperatorsFile(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('干员数据不能为空。')
  }
  const requiredKeys = ['id', 'name', 'own', 'elite', 'rarity'] as const
  for (const [index, raw] of data.entries()) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`第 ${index + 1} 个干员不是对象。`)
    }
    const op = raw as Record<string, unknown>
    const missing = requiredKeys.filter((key) => !(key in op))
    if (missing.length > 0) {
      throw new Error(`干员 ${String(op.name ?? index + 1)} 缺少字段: ${missing.join(', ')}。`)
    }
    if (typeof op.id !== 'string' || typeof op.name !== 'string' || typeof op.own !== 'boolean') {
      throw new Error(`干员 ${String(op.name ?? index + 1)} 的 id/name/own 格式不正确。`)
    }
    if (!Number.isFinite(op.elite) || !Number.isFinite(op.rarity)) {
      throw new Error(`干员 ${String(op.name)} 的 elite/rarity 必须是数字。`)
    }
  }
  return data as LicenseOperator[]
}
