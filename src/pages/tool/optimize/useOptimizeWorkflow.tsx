import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react'
import type { Announcement, AuthSuccessResponse, FreeScheduleEntitlement, LicenseConfig, LicenseFile, OptimizeResult, ReorderCheckResult, UpgradeSuggestion, UpgradeTaskPayload, UserGameAccount, UserWorkspace, WorkspaceResultHistoryItem } from '../../../lib/types'
import type { CreateOptimizationJobRequest } from '../../../lib/optimization-contracts'
import { canEditConfig, canUseUpgradeFeatures, getPermissionMode, mergeOperators } from '../../../lib/license'
import { canonicalJson } from '../../../lib/crypto'
import { getActivationTokenForLicense } from '../../../lib/activation-token'

import { apiJson } from '../../../lib/api-client'

import { normalizeConfig, validateConfig, normalizeScheduleMode, normalizeDormitoryRule } from '../../../lib/config'
import { type ScheduleProgressState } from '../../../components/ScheduleProgress'
import { describeConfigDiff, downloadOptimizeResult } from '../../../lib/workspace-history'
import { mergeOptimizeJobProgress, buildOptimizeJobStorageKey, writeActiveOptimizeJob, readActiveOptimizeJob, isActiveOptimizeJob, clearActiveOptimizeJob, clearLegacyOptimizeJobStorage, isOptimizeJobPollCancelled } from './job-progress'
import { useOptimizationJob } from './useOptimizationJob'
import type { OptimizePhase, OptimizeSection } from './types'
import { requestReorderCheck } from './optimization-api'
import { isFreePreviewProfile } from '../tool-utils'
import type { WorkspacePatch } from '../useToolSession'
import { useLicenseSync } from './useLicenseSync'
import { useOptimizeWorkspace } from './useOptimizeWorkspace'
import { buildOptimizeSignature, formatConfigPresetLabel, waitForProgressCompletion, formatOptimizeError, getFreeScheduleGenerateBlockedReason, parseOperatorsFile } from './workflow-utils'

export interface Props {
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

export function useOptimizeWorkflow(props: Props) {
  const {
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
  onProfileUpgraded,
} = props
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

  const {
    syncing: licenseSyncing,
    status: licenseSyncStatus,
    flushPendingSync: flushPendingLicenseSync,
  } = useLicenseSync(profileId, license.order_hash)

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

  const progressRef = useRef<ScheduleProgressState | null>(null)

  const optimizeInFlightRef = useRef(false)

  const optimizeRestoreKeyRef = useRef<string | null>(null)

  const configToastTimerRef = useRef<number | null>(null)

  const configToastIdRef = useRef(0)

  const isPreviewProfile = isFreePreviewProfile(profile)

  const permission = getPermissionMode(license)

  const userCanReplaceOperators = false

  const userCanEditConfig = canEditConfig(license)

  const userCanUseIntermediateAutoConfig = isPreviewProfile || permission === 'recommended' || permission === 'growth'

  const userCanApplyConfigOverride = true

  const userCanUseUpgradeFeatures = !isPreviewProfile && canUseUpgradeFeatures(license)

  useEffect(() => {
      progressRef.current = progress
    }, [progress])

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
      if (limited.schedule_mode !== 'rotation' && userCanUseIntermediateAutoConfig && (next.auto_balance_source === 'intermediate_inventory' || next.auto_balance_source === 'limited_config')) {
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

  const {
    handleSaveCurrentConfig,
    handleRenameSavedConfig,
    handleDeleteSavedConfig,
    handleUseSavedConfig,
    handleViewHistory,
    handleUseHistoryConfig,
    handleDownloadHistory,
  } = useOptimizeWorkspace({
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
  })

  const {
      pollOptimizationJob: pollOptimizeJob,
      runOptimizationJob: runOptimizeJob,
    } = useOptimizationJob({
      profileId,
      orderHash: license.order_hash,
      signature: optimizeSignature,
      progressRef,
      setProgress,
    })

  useEffect(() => {
      if (optimizeInFlightRef.current) return
      const modes: ScheduleProgressState['mode'][] = ['apply', 'generate']
      const active = modes
        .map((mode) => {
          const storageKey = buildOptimizeJobStorageKey(profileId, license.order_hash, optimizeSignature, mode)
          clearLegacyOptimizeJobStorage(profileId, license.order_hash, optimizeSignature, mode)
          return { mode, storageKey, entry: readActiveOptimizeJob(storageKey) }
        })
        .find(({ entry }) => isActiveOptimizeJob(entry?.job ?? null))
      if (!active || !active.entry || !isActiveOptimizeJob(active.entry.job)) return
      if (optimizeRestoreKeyRef.current === active.storageKey) return
      const activeJob = active.entry.job
      const restoredProgress = mergeOptimizeJobProgress(active.entry.progress ?? null, activeJob, active.mode, Date.now())
  
      optimizeRestoreKeyRef.current = active.storageKey
      optimizeInFlightRef.current = true
      setLoading(true)
      setInlineError(null)
      progressRef.current = restoredProgress
      setProgress(restoredProgress)
      writeActiveOptimizeJob(active.storageKey, activeJob, restoredProgress)
  
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
          setProgress((current) => ({
            ...current,
            mode: active.mode,
            startedAt: current?.startedAt ?? (Date.parse(activeJob.submitted_at) || Date.now()),
            completedAt: Date.now(),
            estimatedRemainingMs: 0,
            estimatePhase: 'completed',
            estimateAdjustment: undefined,
            lastUpdatedAt: Date.now(),
          }))
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
      const payload: CreateOptimizationJobRequest = {
        kind: 'schedule',
        identity: { type: 'profile', profileId },
        operators: mergedOperators,
        config: activeConfig,
        ignoreElite,
        ...(includeCurrent && { includeCurrent: true }),
      }
      return await runOptimizeJob(payload, 'generate', '优化请求失败')
    }, [activeConfig, license, mergedOperators, profileId, runOptimizeJob])

  const runUpgradeSuggestions = useCallback(async (taskPayload: UpgradeTaskPayload) => {
      const payload: CreateOptimizationJobRequest = {
        kind: 'upgrade_suggestions',
        identity: { type: 'profile', profileId },
        operators: mergedOperators,
        config: activeConfig,
        upgradeTaskPayload: taskPayload,
      }
      return await runOptimizeJob(payload, 'generate', '练度建议请求失败。', true)
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
        const data = await requestReorderCheck({
          profileId,
          config: activeConfig,
          baselineHistoryId: latestWorkspaceResult.id,
        }, '重排检测失败')
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
      setProgress({ mode: 'generate', startedAt, lastUpdatedAt: Date.now() })
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
                    orundum_roi: s.orundum_roi,
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
                  orundum_roi: s.orundum_roi,
                  impact: s.impact,
                  partial_outcomes: s.partial_outcomes,
                  partial_outcomes_truncated: s.partial_outcomes_truncated,
                  partial_outcomes_unavailable_reason: s.partial_outcomes_unavailable_reason,
                }
              })
          : []
        completed = true
        setProgress((current) => ({
          ...current,
          mode: 'generate',
          startedAt: current?.startedAt ?? startedAt,
          completedAt: Date.now(),
          lastUpdatedAt: Date.now(),
        }))
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
      setProgress({ mode: 'apply', startedAt, lastUpdatedAt: Date.now() })
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
        const applyPayload: CreateOptimizationJobRequest = {
          kind: 'schedule',
          identity: { type: 'profile', profileId },
          operators: mergeOperators(license.operators, newOverrides),
          config: activeConfig,
          ignoreElite: false,
          historySource: 'applied_suggestions',
        }
        const data = await runOptimizeJob(applyPayload, 'apply', '优化失败')
        completed = true
        setProgress((current) => ({
          ...current,
          mode: 'apply',
          startedAt: current?.startedAt ?? startedAt,
          completedAt: Date.now(),
          estimatedRemainingMs: 0,
          estimatePhase: 'completed',
          estimateAdjustment: undefined,
          lastUpdatedAt: Date.now(),
        }))
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

  return { license, progress, profile, onReset, announcement, redeemedNotice, permission, suggestions, currentResult, finalResult, historyItem, loading, phase, section, setSection, operatorUploadStatus, licenseSyncing, licenseSyncStatus, inlineError, reorderCheckLoading, reorderCheckResult, reorderCheckError, freeScheduleEntitlement, freeScheduleConfirming, freeScheduleConfirmError, configToast, workspaceNotice, workspaceError, workspaceBusyAction, upgradeCdk, setUpgradeCdk, upgradeLoading, upgradeError, operatorFileRef, isPreviewProfile, userCanReplaceOperators, userCanEditConfig, userCanUseIntermediateAutoConfig, activeConfig, configChanged, configValidation, configPresetLabel, savedConfigs, resultHistory, latestWorkspaceResult, freeScheduleGenerateBlockedReason, reorderCheckDisabledReason, configDiffRows, mergedOperators, hasResult, resultIsCurrent, handleReplaceOperators, updateConfig, resetConfig, handleSaveCurrentConfig, handleRenameSavedConfig, handleDeleteSavedConfig, handleUseSavedConfig, handleViewHistory, handleUseHistoryConfig, handleDownloadHistory, handleReorderCheck, handleConfirmFreeSchedule, handleGenerate, handleApplySuggestions, handleDownloadMAA, handleUpgradePreviewProfile }
}
