import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  Announcement,
  AuthSuccessResponse,
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  OptimizeRequest,
  OptimizeResult,
  UpgradeSuggestion,
  UpgradeTaskPayload,
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
import { normalizeConfig, validateConfig, PERMISSION_LABELS, SCHEDULE_MODE_LABELS, normalizeScheduleMode, normalizeDormitoryRule } from '../lib/config'
import DeferredFeatureMenu from '../components/DeferredFeatureMenu'
import ScheduleProgress, {
  SCHEDULE_PROGRESS_COMPLETION_DURATION_MS,
  type ScheduleProgressState,
} from '../components/ScheduleProgress'
import {
  describeConfigDiff,
  downloadOptimizeResult,
  formatPlanName,
  formatResultSummary,
  formatWorkspaceDate,
  isMaaJsonDownloadable,
  type ConfigDiffItem,
} from '../lib/workspace-history'

const ConfigEditor = lazy(() => import('../components/ConfigEditor'))
const ResultPanel = lazy(() => import('../components/ResultPanel'))
const UpgradeSuggestions = lazy(() => import('../components/UpgradeSuggestions'))

interface Props {
  profileId: string;
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
}

type WorkspacePatch = Partial<UserWorkspace> & { saved_config_action?: WorkspaceSavedConfigAction }
type OptimizePhase = 'idle' | 'history' | 'suggestions' | 'final'

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
}: Props) {
  const initialHistoryItem = workspace?.result_history?.[0] ?? null
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([])
  const [currentResult, setCurrentResult] = useState<OptimizeResult | null>(null)
  const [finalResult, setFinalResult] = useState<OptimizeResult | null>(null)
  const [historyItem, setHistoryItem] = useState<WorkspaceResultHistoryItem | null>(initialHistoryItem)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ScheduleProgressState | null>(null)
  const [phase, setPhase] = useState<OptimizePhase>(initialHistoryItem ? 'history' : 'idle')
  const [operatorUploadStatus, setOperatorUploadStatus] = useState<string | null>(null)
  const [licenseSyncing, setLicenseSyncing] = useState(true)
  const [licenseSyncStatus, setLicenseSyncStatus] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<{ scope: 'generate' | 'apply'; message: string } | null>(null)
  const [configToast, setConfigToast] = useState<{ id: number; message: string } | null>(null)
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceBusyAction, setWorkspaceBusyAction] = useState<string | null>(null)
  const [lastGeneratedSignature, setLastGeneratedSignature] = useState<string | null>(null)
  const operatorFileRef = useRef<HTMLInputElement>(null)
  const optimizeInFlightRef = useRef(false)
  const configToastTimerRef = useRef<number | null>(null)
  const configToastIdRef = useRef(0)
  const pendingLicenseSyncRef = useRef<{ license: LicenseFile; message: string } | null>(null)

  const permission = getPermissionMode(license)
  const userCanReplaceOperators = false
  const userCanEditConfig = canEditConfig(license)
  const userCanUseIntermediateAutoConfig = permission === 'recommended' || permission === 'growth'
  const userCanApplyConfigOverride = true
  const userCanUseUpgradeFeatures = canUseUpgradeFeatures(license)
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
    setInlineError(null)
    setLastGeneratedSignature(null)
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
  }, [activeConfig, clearConfigValidationToast, normalizeAllowedConfigOverride, setConfigOverride, showConfigValidationToast, userCanApplyConfigOverride])

  const resetConfig = useCallback(() => {
    setConfigOverride(null)
    clearConfigValidationToast()
    setInlineError(null)
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
  }, [])

  const handleUseHistoryConfig = useCallback((item: WorkspaceResultHistoryItem) => {
    handleViewHistory(item)
    if (!item.config) {
      setWorkspaceError('这条旧结果没有保存配置快照，只能查看或下载。')
      return
    }
    setConfigOverride(normalizeAllowedConfigOverride(item.config))
    setWorkspaceNotice(`已载入历史配置“${item.name}”，可继续调整后重新生成。`)
  }, [handleViewHistory, normalizeAllowedConfigOverride, setConfigOverride])

  const handleDownloadHistory = useCallback((item: WorkspaceResultHistoryItem) => {
    if (!isMaaJsonDownloadable(item.result)) {
      setWorkspaceError('游戏内轮换模式不生成 MAA JSON。')
      return
    }
    downloadOptimizeResult(item.result, `maa-schedule-${item.id.slice(0, 8) || 'history'}`)
  }, [])

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
    return await apiJson<OptimizeResult>('/api/optimize', {
      method: 'POST',
      json: payload,
      fallbackMessage: '优化请求失败',
    })
  }, [activeConfig, license, mergedOperators, profileId])

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
    return await apiJson<OptimizeResult>('/api/optimize', {
      method: 'POST',
      json: payload,
      fallbackMessage: 'upgrade suggestions request failed',
    })
  }, [activeConfig, license, mergedOperators, profileId])

  const handleGenerate = useCallback(async () => {
    if (licenseSyncing || loading || optimizeInFlightRef.current) return
    if (hasResult && lastGeneratedSignature === optimizeSignature) return
    if (configValidationMessage) {
      showConfigValidationToast(configValidationMessage)
      return
    }
    optimizeInFlightRef.current = true
    setInlineError(null)
    setHistoryItem(null)
    setPhase('idle')
    setLoading(true)
    const startedAt = Date.now()
    setProgress({ mode: 'generate', startedAt })
    let completed = false
    try {
      const potential = userCanUseUpgradeFeatures ? await runOptimize(true, true) : null
      const current = potential?.current_result ?? (await runOptimize(false))
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
                  current_elite: o.current,
                  target_elite: o.target,
                })),
                training_cost: s.training_cost,
              }
            })
        : []
      completed = true
      setProgress({ mode: 'generate', startedAt, completedAt: Date.now() })
      await waitForProgressCompletion()
      setSuggestions(upgradeList.sort((a, b) => b.gain - a.gain).slice(0, 20))
      setPhase('suggestions')
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
  }, [configValidationMessage, flushPendingLicenseSync, hasResult, lastGeneratedSignature, licenseSyncing, loading, optimizeSignature, runOptimize, runUpgradeSuggestions, showConfigValidationToast, userCanUseUpgradeFeatures])

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
      const data = await apiJson<OptimizeResult>('/api/optimize', {
        method: 'POST',
        json: {
          profile_id: profileId,
          license,
          operators: mergeOperators(license.operators, newOverrides),
          config: activeConfig,
          ignore_elite: false,
          activation_token: getActivationTokenForLicense(license),
          history_source: 'applied_suggestions',
        },
        fallbackMessage: '优化失败',
      })
      completed = true
      setProgress({ mode: 'apply', startedAt, completedAt: Date.now() })
      await waitForProgressCompletion()
      setFinalResult(data)
      setPhase('final')
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
  }, [activeConfig, eliteOverrides, loading, resultIsCurrent, suggestions, license, profileId, setEliteOverrides])

  const handleDownloadMAA = useCallback(() => {
    const data = finalResult || currentResult || historyItem?.result
    if (!data) return
    downloadOptimizeResult(data, 'maa_schedule_optimized')
  }, [finalResult, currentResult, historyItem])

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
    <div className="min-h-screen w-full bg-surface-0">
      {configToast && <ConfigValidationToast key={configToast.id} message={configToast.message} />}
      <header className="border-b border-surface-3 bg-surface-1">
        <div className="flex w-full flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-ink-primary">
                排班结果工作台
              </h1>
              <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-brand-300">
                {PERMISSION_LABELS[permission]}
              </span>
            </div>
          <p className="text-sm leading-6 text-ink-secondary">
            生成、检查并下载当前账号的基建排班方案。
          </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-shrink-0">
            <DeferredFeatureMenu />
            <button
              onClick={onReset}
              className="rounded-lg px-4 py-2 text-sm text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary"
            >
              返回数据空间
            </button>
          </div>
        </div>
      </header>

      <main className="w-full space-y-4 px-4 py-4 sm:px-6 lg:px-8">
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

          <GenerateControlBar
            config={activeConfig}
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
            onGenerate={handleGenerate}
            onReset={onReset}
          />

          <WorkspacePlansPanel
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

        <div className="min-w-0 space-y-4">
          <details
            className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1"
            open={!configValidation.ok}
          >
            <summary className="flex cursor-pointer list-none flex-col gap-3 px-5 py-4 transition-colors duration-150 hover:bg-surface-2/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink-primary">基建配置</h2>
                  {configChanged && (
                    <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                      已修改
                    </span>
                  )}
                  {!configValidation.ok && (
                    <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-error/10 px-2.5 py-1 text-xs font-medium text-error">
                      需处理
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-secondary">
                  {SCHEDULE_MODE_LABELS[normalizeScheduleMode(activeConfig.schedule_mode)]} · {userCanEditConfig ? `${activeConfig.layout} · ${activeConfig.desc}` : configPresetLabel}
                </p>
              </div>
              <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-brand-300">
                展开调整
              </span>
            </summary>
            <div className="border-t border-surface-3/60 p-4 sm:p-5">
              <Suspense fallback={<ResultFallback />}>
                <ConfigEditor
                  config={activeConfig}
                  permission={permission}
                  canEdit={userCanEditConfig}
                  canEditIntermediateInventory={userCanUseIntermediateAutoConfig}
                  changed={configChanged}
                  validation={configValidation}
                  onUpdate={updateConfig}
                  onReset={resetConfig}
                  embedded
                />
              </Suspense>
            </div>
          </details>

          {userCanReplaceOperators && (
            <AdminOperatorPanel
              operatorCount={license.operators.length}
              status={operatorUploadStatus}
              fileRef={operatorFileRef}
              onReplace={handleReplaceOperators}
            />
          )}

          <section className="min-w-0">
            {phase === 'idle' && (
              <div className="rounded-xl border border-dashed border-surface-3 bg-surface-1/70 px-5 py-10 text-center">
                <p className="text-base font-semibold text-ink-primary">生成后将在这里显示排班结果</p>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  确认上方状态并点击生成，结果会按数据、详情、导入和建议分区展示。
                </p>
              </div>
            )}

            {phase === 'history' && historyItem && (
              <Suspense fallback={<ResultFallback />}>
                <ResultPanel
                  result={historyItem.result}
                  onDownload={isMaaJsonDownloadable(historyItem.result) ? handleDownloadMAA : undefined}
                />
              </Suspense>
            )}

            {phase === 'suggestions' && currentResult && (
              <Suspense fallback={<ResultFallback />}>
                <ResultPanel
                  result={currentResult}
                  onDownload={handleDownloadMAA}
                  suggestionsSlot={suggestions.length > 0 ? (
                    <Suspense fallback={<ResultFallback />}>
                      <UpgradeSuggestions
                        suggestions={suggestions}
                        onApply={handleApplySuggestions}
                        loading={loading}
                        progress={progress?.mode === 'apply' ? progress : null}
                        error={inlineError?.scope === 'apply' ? inlineError.message : null}
                        onReset={onReset}
                        embedded
                      />
                    </Suspense>
                  ) : null}
                />
              </Suspense>
            )}

            {phase === 'final' && finalResult && (
              <Suspense fallback={<ResultFallback />}>
                <ResultPanel
                  result={finalResult}
                  onDownload={handleDownloadMAA}
                />
              </Suspense>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

function WorkspacePlansPanel({
  activeConfig,
  savedConfigs,
  resultHistory,
  latestResult,
  selectedHistoryId,
  diffRows,
  busyAction,
  notice,
  error,
  onSaveCurrent,
  onUseSavedConfig,
  onRenameSavedConfig,
  onDeleteSavedConfig,
  onViewHistory,
  onUseHistoryConfig,
  onDownloadHistory,
}: {
  activeConfig: LicenseConfig;
  savedConfigs: WorkspaceSavedConfig[];
  resultHistory: WorkspaceResultHistoryItem[];
  latestResult: WorkspaceResultHistoryItem | null;
  selectedHistoryId: string | null;
  diffRows: ConfigDiffItem[];
  busyAction: string | null;
  notice: string | null;
  error: string | null;
  onSaveCurrent: (name: string) => Promise<void>;
  onUseSavedConfig: (config: WorkspaceSavedConfig) => void;
  onRenameSavedConfig: (config: WorkspaceSavedConfig) => Promise<void>;
  onDeleteSavedConfig: (config: WorkspaceSavedConfig) => Promise<void>;
  onViewHistory: (item: WorkspaceResultHistoryItem) => void;
  onUseHistoryConfig: (item: WorkspaceResultHistoryItem) => void;
  onDownloadHistory: (item: WorkspaceResultHistoryItem) => void;
}) {
  const [draftName, setDraftName] = useState(formatPlanName(activeConfig))

  useEffect(() => {
    setDraftName(formatPlanName(activeConfig))
  }, [activeConfig.desc, activeConfig.layout])

  const saving = busyAction === 'save-current'

  const submitSave = (event: React.FormEvent) => {
    event.preventDefault()
    void onSaveCurrent(draftName)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="border-b border-surface-3/60 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-400">我的方案</p>
            <h2 className="mt-1 text-lg font-semibold text-ink-primary">方案库与历史结果</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              保存常用配置，回看最近生成结果；离开页面后也能重新下载上次 MAA JSON。
            </p>
          </div>
          <form onSubmit={submitSave} className="flex w-full min-w-0 flex-col gap-2 sm:flex-row lg:w-auto">
            <label className="min-w-0 flex-1 lg:w-56">
              <span className="sr-only">方案名称</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                maxLength={40}
                className="min-h-11 w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                placeholder="例如：243 刷钱"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-wait disabled:bg-surface-3 disabled:text-ink-muted"
            >
              {saving ? '保存中...' : '保存当前配置'}
            </button>
          </form>
        </div>
        {(notice || error) && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${error ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success'}`}>
            {error ?? notice}
          </div>
        )}
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="border-b border-surface-3/60 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-ink-primary">上次结果</h3>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {latestResult ? `${latestResult.name} · ${formatWorkspaceDate(latestResult.created_at)}` : '还没有生成过排班结果。'}
              </p>
            </div>
            {latestResult && (
              <span className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-semibold text-brand-300">
                {latestResult.source === 'applied_suggestions' ? '建议后' : latestResult.source === 'legacy' ? '旧结果' : '生成'}
              </span>
            )}
          </div>
          {latestResult ? (
            <>
              <p className="mt-3 text-sm text-ink-secondary">{formatResultSummary(latestResult.result)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SmallActionButton onClick={() => onViewHistory(latestResult)}>查看</SmallActionButton>
                <SmallActionButton onClick={() => onDownloadHistory(latestResult)} disabled={!isMaaJsonDownloadable(latestResult.result)}>下载 JSON</SmallActionButton>
                <SmallActionButton onClick={() => onUseHistoryConfig(latestResult)} disabled={!latestResult.config}>继续调配置</SmallActionButton>
              </div>
            </>
          ) : (
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-muted">生成一次排班后，这里会保留可回看的上次结果。</p>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <h3 className="text-base font-semibold text-ink-primary">当前方案 vs 上次方案</h3>
          {latestResult ? (
            diffRows.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {diffRows.map((row) => (
                  <div key={row.label} className="grid gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="font-medium text-ink-primary">{row.label}</span>
                    <span className="min-w-0 text-ink-muted">上次：{row.before}</span>
                    <span className="min-w-0 text-brand-300">当前：{row.after}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-success/10 px-3 py-3 text-sm text-success">当前配置与上次生成配置一致。</p>
            )
          ) : (
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-muted">暂无上次方案可对比。</p>
          )}
        </div>
      </div>

      <div className="grid border-t border-surface-3/60 lg:grid-cols-2">
        <div className="border-b border-surface-3/60 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">已保存配置</h3>
            <span className="text-xs text-ink-muted">{savedConfigs.length}/20</span>
          </div>
          <div className="mt-4 space-y-3">
            {savedConfigs.length === 0 && <p className="rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-muted">还没有保存配置。</p>}
            {savedConfigs.map((item) => (
              <div key={item.id} className="rounded-lg border border-surface-3 bg-surface-0 px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatPlanName(item.config)} · 更新 {formatWorkspaceDate(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <SmallActionButton onClick={() => onUseSavedConfig(item)} disabled={busyAction === `touch:${item.id}`}>载入</SmallActionButton>
                    <SmallActionButton onClick={() => void onRenameSavedConfig(item)} disabled={busyAction === `rename:${item.id}`}>改名</SmallActionButton>
                    <SmallActionButton onClick={() => void onDeleteSavedConfig(item)} disabled={busyAction === `delete:${item.id}`} tone="danger">删除</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-semibold text-ink-primary">历史结果</h3>
            <span className="text-xs text-ink-muted">{resultHistory.length}/10</span>
          </div>
          <div className="mt-4 space-y-3">
            {resultHistory.length === 0 && <p className="rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-muted">暂无历史结果。</p>}
            {resultHistory.map((item) => (
              <div key={item.id} className={`rounded-lg border px-3 py-3 ${selectedHistoryId === item.id ? 'border-brand-500/60 bg-brand-600/10' : 'border-surface-3 bg-surface-0'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatWorkspaceDate(item.created_at)} · {formatResultSummary(item.result)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <SmallActionButton onClick={() => onViewHistory(item)}>查看</SmallActionButton>
                    <SmallActionButton onClick={() => onDownloadHistory(item)} disabled={!isMaaJsonDownloadable(item.result)}>下载</SmallActionButton>
                    <SmallActionButton onClick={() => onUseHistoryConfig(item)} disabled={!item.config}>继续调</SmallActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SmallActionButton({
  children,
  onClick,
  disabled = false,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted ${
        tone === 'danger'
          ? 'bg-error/10 text-error hover:bg-error/15'
          : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
      }`}
    >
      {children}
    </button>
  )
}

function LicenseSyncPanel() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-brand-600/25 bg-surface-1 p-4"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-primary">正在同步授权状态</p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              请稍候，正在检查 CDK 状态和权限变更，同步完成后即可生成排班。
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-ink-muted sm:flex-shrink-0">通常只需几秒</span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="schedule-progress-fill h-full w-1/2 rounded-full bg-brand-500" />
      </div>
    </div>
  )
}

function GenerateControlBar({
  config,
  configChanged,
  showConfigDetails,
  operatorCount,
  configPresetLabel,
  validation,
  loading,
  syncing,
  progress,
  hasResult,
  resultIsCurrent,
  error,
  onGenerate,
  onReset,
}: {
  config: LicenseConfig;
  configChanged: boolean;
  showConfigDetails: boolean;
  operatorCount: number;
  configPresetLabel: string;
  validation: { ok: true } | { ok: false; message: string };
  loading: boolean;
  syncing: boolean;
  progress: ScheduleProgressState | null;
  hasResult: boolean;
  resultIsCurrent: boolean;
  error: string | null;
  onGenerate: () => void;
  onReset: () => void;
}) {
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const readyLabel = resultIsCurrent ? '方案已是最新' : hasResult ? '已有结果' : '待生成'
  const configLabel = showConfigDetails
    ? `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${config.layout} · ${config.desc}`
    : `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${configPresetLabel}`

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-400">生成控制</span>
            <span className={`inline-flex w-max shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
              resultIsCurrent
                ? 'bg-brand-600/15 text-brand-300'
                : hasResult
                  ? 'bg-warning/10 text-warning'
                  : 'bg-surface-2 text-ink-secondary'
            }`}>
              {readyLabel}
            </span>
            {configChanged && (
              <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                配置已调整
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)] xl:grid-cols-[minmax(120px,0.24fr)_minmax(0,1fr)_minmax(120px,0.24fr)]">
            <DashboardMiniStat label="干员数据" value={`${operatorCount} 名`} />
            <DashboardMiniStat label="当前配置" value={configLabel} />
            <DashboardMiniStat label="配置状态" value={configChanged ? '已调整' : '未改动'} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:w-64">
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading || syncing || !validation.ok || resultIsCurrent}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
          >
            {loading || syncing ? (
              <span className="inline-flex w-max shrink-0 items-center gap-3 whitespace-nowrap">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {syncing ? '正在同步授权...' : '正在计算...'}
              </span>
            ) : resultIsCurrent ? '方案已是最新' : hasResult ? '重新计算排班' : '生成排班方案'}
          </button>
          {resultIsCurrent && (
            <p className="text-xs leading-5 text-ink-muted">修改配置或干员数据后才需要重新计算。</p>
          )}
          {!validation.ok && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">{validation.message}</p>
          )}
        </div>
      </div>
      {loading && progress && (
        <div className="border-t border-surface-3/60 px-4 py-4 sm:px-5">
          <ScheduleProgress progress={progress} />
        </div>
      )}
      {error && (
        <div className="border-t border-surface-3/60 px-4 py-4 sm:px-5">
          <InlineErrorPanel message={error} onRetry={onGenerate} onReset={onReset} />
        </div>
      )}
    </section>
  )
}

function WorkbenchPanel({
  config,
  configChanged,
  showConfigDetails,
  operatorCount,
  configPresetLabel,
  validation,
  loading,
  syncing,
  progress,
  hasResult,
  resultIsCurrent,
  error,
  onGenerate,
  onReset,
}: {
  config: LicenseConfig;
  configChanged: boolean;
  showConfigDetails: boolean;
  operatorCount: number;
  configPresetLabel: string;
  validation: { ok: true } | { ok: false; message: string };
  loading: boolean;
  syncing: boolean;
  progress: ScheduleProgressState | null;
  hasResult: boolean;
  resultIsCurrent: boolean;
  error: string | null;
  onGenerate: () => void;
  onReset: () => void;
}) {
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const readyLabel = resultIsCurrent ? '方案已是最新' : hasResult ? '已有结果' : '待生成'
  const configLabel = showConfigDetails
    ? `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${config.layout} · ${config.desc}`
    : `${SCHEDULE_MODE_LABELS[scheduleMode]} · ${configPresetLabel}`

  return (
    <section className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
      <div className="grid gap-0">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-400">操作区</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-primary">生成排班</h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                数据已载入，确认右侧配置后即可生成。
              </p>
            </div>
            <span className={`inline-flex w-max shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
              resultIsCurrent
                ? 'bg-brand-600/15 text-brand-300'
                : hasResult
                ? 'bg-warning/10 text-warning'
                : 'bg-surface-2 text-ink-secondary'
            }`}>
              {readyLabel}
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            <DashboardMiniStat label="干员数据" value={`${operatorCount} 名`} />
            <DashboardMiniStat label="当前配置" value={configLabel} />
            <DashboardMiniStat label="配置状态" value={configChanged ? '已调整' : '未改动'} />
          </div>
        </div>

        <div className="border-t border-surface-3 bg-surface-2/40 p-5">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={onGenerate}
              disabled={loading || syncing || !validation.ok || resultIsCurrent}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
            >
              {loading || syncing ? (
                <span className="inline-flex w-max shrink-0 items-center gap-3 whitespace-nowrap">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {syncing ? '正在同步授权...' : '正在计算...'}
                </span>
              ) : resultIsCurrent ? '方案已是最新' : hasResult ? '重新计算排班' : '生成排班方案'}
            </button>
            {resultIsCurrent && (
              <p className="text-xs leading-5 text-ink-muted">修改基建配置或干员数据后才需要重新计算。</p>
            )}
            {!validation.ok && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">{validation.message}</p>
            )}
          </div>
          {loading && progress && <ScheduleProgress progress={progress} className="mt-5" />}
          {error && <InlineErrorPanel message={error} onRetry={onGenerate} onReset={onReset} />}
        </div>
      </div>
    </section>
  )
}

function ResultDashboardCards({
  operatorCount,
  resultReady,
  configChanged,
}: {
  operatorCount: number;
  resultReady: boolean;
  configChanged: boolean;
}) {
  return (
    <section className="mb-6">
      <div className="rounded-xl border border-brand-600/25 bg-brand-600/10 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary">账号数据空间</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              数据已载入，可直接生成或重新计算基建排班。
            </p>
          </div>
          <span className="rounded-full bg-surface-0 px-3 py-1 text-xs font-semibold text-brand-300">
            {resultReady ? '已有结果' : '待生成'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <DashboardMiniStat label="干员数据" value={`${operatorCount} 名`} />
          <DashboardMiniStat label="配置状态" value={configChanged ? '已调整' : '未改动'} />
          <DashboardMiniStat label="排班状态" value={resultReady ? '可查看' : '待生成'} />
        </div>
      </div>
    </section>
  )
}

function DashboardMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink-primary" title={value}>{value}</p>
    </div>
  )
}

function CommandBand({
  config,
  configChanged,
  showConfigDetails,
  operatorCount,
  validation,
  loading,
  syncing,
  progress,
  hasResult,
  resultIsCurrent,
  error,
  onGenerate,
  onReset,
}: {
  config: LicenseConfig;
  configChanged: boolean;
  showConfigDetails: boolean;
  operatorCount: number;
  validation: { ok: true } | { ok: false; message: string };
  loading: boolean;
  syncing: boolean;
  progress: ScheduleProgressState | null;
  hasResult: boolean;
  resultIsCurrent: boolean;
  error: string | null;
  onGenerate: () => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded-xl bg-surface-1 p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-400">文件已载入</p>
          <h2 className="mt-1 text-xl font-semibold text-ink-primary">
            排班方案
          </h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-secondary">
              <span className="rounded-full bg-surface-2 px-2.5 py-1">{operatorCount} 名干员</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1">
              {SCHEDULE_MODE_LABELS[normalizeScheduleMode(config.schedule_mode)]}
            </span>
            {showConfigDetails ? (
              <>
                <span className="rounded-full bg-surface-2 px-2.5 py-1">{config.layout}</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1">{config.desc}</span>
              </>
            ) : (
              <span className="rounded-full bg-surface-2 px-2.5 py-1">{formatConfigPresetLabel(config)}</span>
            )}
            {configChanged && (
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning">配置已调整</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading || syncing || !validation.ok || resultIsCurrent}
            className="rounded-xl bg-surface-2 px-5 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-muted"
          >
            {loading || syncing ? (
              <span className="inline-flex items-center gap-3">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {syncing ? '正在同步授权...' : '正在计算...'}
              </span>
            ) : (
              resultIsCurrent ? '方案已是最新' : hasResult ? '重新计算排班' : '生成排班方案'
            )}
          </button>
        </div>
      </div>
      {resultIsCurrent && (
        <p className="mt-3 text-xs text-ink-muted">
          修改基建配置或干员数据后才需要重新计算。
        </p>
      )}
      {loading && progress && (
        <ScheduleProgress progress={progress} className="mt-5" />
      )}
      {error && (
        <InlineErrorPanel message={error} onRetry={onGenerate} onReset={onReset} />
      )}
    </section>
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

function ResultFallback() {
  return <div className="rounded-xl border border-surface-3 bg-surface-1 p-5 text-sm text-ink-secondary">正在载入...</div>
}

function ConfigValidationToast({ message }: { message: string }) {
  return (
    <div
      className="config-validation-toast pointer-events-none fixed left-4 right-4 top-4 z-50 mx-auto max-w-xl sm:left-auto sm:right-6 sm:top-6 sm:mx-0"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-lg border border-error/30 bg-surface-1/95 px-4 py-3 shadow-[0_4px_8px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <p className="text-sm font-semibold text-error">处理失败</p>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{message}</p>
      </div>
    </div>
  )
}

function InlineErrorPanel({
  message,
  onRetry,
  onReset,
}: {
  message: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-error/40 bg-error/10 p-4">
      <p className="text-sm font-semibold text-error">处理失败</p>
      <p className="mt-1 text-sm leading-6 text-ink-secondary">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-error px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-error/90"
        >
          重试
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
        >
          重新选择文件
        </button>
      </div>
    </div>
  )
}

function AdminOperatorPanel({
  operatorCount,
  status,
  fileRef,
  onReplace,
}: {
  operatorCount: number;
  status: string | null;
  fileRef: React.RefObject<HTMLInputElement>;
  onReplace: () => void;
}) {
  return (
    <details className="mt-6 rounded-xl bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/60 sm:px-6">
        <span className="flex flex-wrap items-center gap-2">
          干员数据
          <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-300">
            {operatorCount} 名干员
          </span>
        </span>
        <span className="text-xs font-medium text-ink-muted">更新 operators.json</span>
      </summary>
      <div className="border-t border-surface-3/60 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">更新干员数据</h2>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            上传 operators.json 或 .txt 后会清空当前练度调整，并写入后端账号工作区。
          </p>
          {status && (
            <p className="mt-3 text-sm text-brand-300">{status}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onReplace}
          className="rounded-xl bg-surface-2 px-5 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3 lg:flex-shrink-0"
        >
          选择干员数据文件
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={onReplace}
          className="hidden"
        />
      </div>
      </div>
    </details>
  )
}

function formatOptimizeError(message: string): string {
  return message.includes('冻结') || message.includes('被冻结') || message.includes('已拦截')
    ? message
    : `优化失败: ${message}`
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
