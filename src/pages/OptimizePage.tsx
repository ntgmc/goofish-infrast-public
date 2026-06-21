import { useState, useCallback, useMemo, useRef } from 'react'
import type { LicenseConfig, LicenseFile, LicenseOperator, OptimizeRequest, OptimizeResult, UpgradeSuggestion, UpgradeTaskPayload } from '../lib/types'
import { canEditConfig, getPermissionMode, mergeOperators } from '../lib/license'
import { deriveClientKey, signClientState, encryptPayload, canonicalJson } from '../lib/crypto'
import ConfigEditor, { normalizeConfig, validateConfig, PERMISSION_LABELS, SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../components/ConfigEditor'
import UpgradeSuggestions from '../components/UpgradeSuggestions'
import ResultPanel from '../components/ResultPanel'
import BuildMetaStrip from '../components/BuildMetaStrip'
import ScheduleProgress, {
  SCHEDULE_PROGRESS_COMPLETION_DURATION_MS,
  type ScheduleProgressState,
} from '../components/ScheduleProgress'

interface Props {
  license: LicenseFile;
  setLicense: (v: LicenseFile) => void;
  eliteOverrides: Record<string, number>;
  setEliteOverrides: (v: Record<string, number>) => void;
  configOverride: LicenseConfig | null;
  setConfigOverride: (v: LicenseConfig | null) => void;
  onReset: () => void;
}

export default function OptimizePage({
  license,
  setLicense,
  eliteOverrides,
  setEliteOverrides,
  configOverride,
  setConfigOverride,
  onReset,
}: Props) {
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([])
  const [currentResult, setCurrentResult] = useState<OptimizeResult | null>(null)
  const [finalResult, setFinalResult] = useState<OptimizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ScheduleProgressState | null>(null)
  const [phase, setPhase] = useState<'idle' | 'suggestions' | 'final'>('idle')
  const [operatorUploadStatus, setOperatorUploadStatus] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<{ scope: 'generate' | 'apply'; message: string } | null>(null)
  const [lastGeneratedSignature, setLastGeneratedSignature] = useState<string | null>(null)
  const operatorFileRef = useRef<HTMLInputElement>(null)
  const optimizeInFlightRef = useRef(false)

  const permission = getPermissionMode(license)
  const userCanReplaceOperators = permission === 'admin'
  const userCanEditConfig = canEditConfig(license)
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

  const mergedOperators = useMemo(
    () => mergeOperators(license.operators, eliteOverrides),
    [license.operators, eliteOverrides]
  )
  const optimizeSignature = useMemo(
    () => buildOptimizeSignature(mergedOperators, activeConfig),
    [activeConfig, mergedOperators]
  )
  const hasResult = Boolean(finalResult || currentResult)
  const resultIsCurrent = hasResult && lastGeneratedSignature === optimizeSignature
  const currentResultIsRotation = normalizeScheduleMode(currentResult?.schedule_mode ?? activeConfig.schedule_mode) === 'rotation'
  const finalResultIsRotation = normalizeScheduleMode(finalResult?.schedule_mode ?? activeConfig.schedule_mode) === 'rotation'
  const serverBuildMeta = finalResult?.build_meta ?? currentResult?.build_meta

  const clearGeneratedResult = useCallback(() => {
    setSuggestions([])
    setCurrentResult(null)
    setFinalResult(null)
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
      setLicense({ ...license, operators: nextOperators })
      setEliteOverrides({})
      clearGeneratedResult()
      setOperatorUploadStatus(`已重新载入 ${nextOperators.length} 名干员。`)
      if (operatorFileRef.current) {
        operatorFileRef.current.value = ''
      }
    } catch (error) {
      setOperatorUploadStatus((error as Error).message)
    }
  }, [clearGeneratedResult, license, setEliteOverrides, setLicense, userCanReplaceOperators])

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    if (!userCanEditConfig) return
    const next = normalizeConfig(activeConfig)
    mutate(next)
    next.layout = `${next.trading_stations_count}-${next.manufacturing_stations_count}-3`
    setConfigOverride(next)
    clearGeneratedResult()
  }, [activeConfig, clearGeneratedResult, setConfigOverride, userCanEditConfig])

  const resetConfig = useCallback(() => {
    setConfigOverride(null)
    clearGeneratedResult()
  }, [clearGeneratedResult, setConfigOverride])

  const runOptimize = useCallback(async (ignoreElite: boolean, includeCurrent = false) => {
    const payload: OptimizeRequest = {
      license,
      operators: mergedOperators,
      config: activeConfig,
      ignore_elite: ignoreElite,
      ...(includeCurrent && { include_current: true }),
    }
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new Error(await readResponseError(resp, `优化请求失败: ${resp.status}`))
    return resp.json() as Promise<OptimizeResult>
  }, [activeConfig, license, mergedOperators])

  const runUpgradeSuggestions = useCallback(async (taskPayload: UpgradeTaskPayload) => {
    const payload: OptimizeRequest = {
      license,
      operators: mergedOperators,
      config: activeConfig,
      ignore_elite: true,
      suggestions_only: true,
      upgrade_task_payload: taskPayload,
    }
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new Error(await readResponseError(resp, `upgrade suggestions request failed: ${resp.status}`))
    return resp.json() as Promise<OptimizeResult>
  }, [activeConfig, license, mergedOperators])

  const handleGenerate = useCallback(async () => {
    if (loading || optimizeInFlightRef.current) return
    if (hasResult && lastGeneratedSignature === optimizeSignature) return
    if (configValidationMessage) {
      setInlineError({ scope: 'generate', message: configValidationMessage })
      return
    }
    optimizeInFlightRef.current = true
    setInlineError(null)
    setLoading(true)
    const startedAt = Date.now()
    setProgress({ mode: 'generate', startedAt })
    let completed = false
    try {
      const potential = await runOptimize(true, true)
      const current = potential.current_result ?? (await runOptimize(false))
      setCurrentResult(current)
      const suggestionResult = potential.upgrade_task_payload
        ? await runUpgradeSuggestions(potential.upgrade_task_payload)
        : potential
      const serverSuggestions = suggestionResult.upgrade_suggestions
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
      setInlineError({ scope: 'generate', message: '优化失败: ' + (e as Error).message })
    } finally {
      optimizeInFlightRef.current = false
      setLoading(false)
      if (!completed) {
        setProgress(null)
      }
    }
  }, [configValidationMessage, hasResult, lastGeneratedSignature, loading, optimizeSignature, runOptimize, runUpgradeSuggestions])

  const handleApplySuggestions = useCallback(async (selectedIds: string[]) => {
    if (loading || optimizeInFlightRef.current) return
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
      const result = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license,
          operators: mergeOperators(license.operators, newOverrides),
          config: activeConfig,
          ignore_elite: false,
        }),
      })
      if (!result.ok) throw new Error(await readResponseError(result, '优化失败'))
      const data = await result.json() as OptimizeResult
      completed = true
      setProgress({ mode: 'apply', startedAt, completedAt: Date.now() })
      await waitForProgressCompletion()
      setFinalResult(data)
      setPhase('final')
      setLastGeneratedSignature(buildOptimizeSignature(mergeOperators(license.operators, newOverrides), activeConfig))
    } catch (e) {
      setInlineError({ scope: 'apply', message: '优化失败: ' + (e as Error).message })
    } finally {
      optimizeInFlightRef.current = false
      setLoading(false)
      if (!completed) {
        setProgress(null)
      }
    }
  }, [activeConfig, eliteOverrides, loading, suggestions, license, setEliteOverrides])

  const handleDownloadMAA = useCallback(() => {
    const data = finalResult || currentResult
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'maa_schedule_optimized.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [finalResult, currentResult])

  const handleSaveWorkfile = useCallback(async () => {
    const savedConfigOverride = userCanEditConfig && configChanged ? activeConfig : undefined
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
    a.download = 'maa-workfile.maa'
    a.click()
    URL.revokeObjectURL(url)
  }, [activeConfig, configChanged, eliteOverrides, license, userCanEditConfig])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <header className="flex flex-col gap-5 mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink-primary">
              智能排班生成器
            </h1>
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-brand-300">
              {PERMISSION_LABELS[permission]}
            </span>
          </div>
          <p className="text-ink-secondary text-sm">
            配置: {activeConfig.desc} · ID: {license.order_hash.slice(0, 8)}...
          </p>
          <BuildMetaStrip meta={serverBuildMeta} placement="corner" />
        </div>
        <button
          onClick={onReset}
          className="self-start text-ink-secondary hover:text-ink-primary text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors duration-150 sm:self-auto"
        >
          重新选择文件
        </button>
      </header>

      <CommandBand
        config={activeConfig}
        configChanged={configChanged}
        operatorCount={license.operators.length}
        fileId={license.order_hash.slice(0, 8)}
        validation={configValidation}
        loading={loading}
        progress={progress?.mode === 'generate' ? progress : null}
        hasResult={hasResult}
        resultIsCurrent={resultIsCurrent}
        error={inlineError?.scope === 'generate' ? inlineError.message : null}
        onGenerate={handleGenerate}
        onReset={onReset}
      />

      <details
        className="mt-6 rounded-xl bg-surface-1"
        open={!configValidation.ok}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/60 sm:px-6">
          <span className="flex flex-wrap items-center gap-2">
            调整基建配置
            {configChanged && (
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                已修改
              </span>
            )}
          </span>
          <span className="text-xs font-medium text-ink-muted">
            {SCHEDULE_MODE_LABELS[normalizeScheduleMode(activeConfig.schedule_mode)]} · {activeConfig.layout} · {activeConfig.desc}
          </span>
        </summary>
        <div className="border-t border-surface-3/60 p-4 sm:p-5">
          <ConfigEditor
            config={activeConfig}
            permission={permission}
            canEdit={userCanEditConfig}
            changed={configChanged}
            validation={configValidation}
            onUpdate={updateConfig}
            onReset={resetConfig}
            embedded
          />
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

      {phase === 'suggestions' && suggestions.length > 0 && (
        <div className="mt-8 space-y-8">
          {currentResult && (
            <ResultPanel
              result={currentResult}
              onDownload={handleDownloadMAA}
              onSaveWorkfile={handleSaveWorkfile}
            />
          )}
          <UpgradeSuggestions
            suggestions={suggestions}
            onApply={handleApplySuggestions}
            loading={loading}
            progress={progress?.mode === 'apply' ? progress : null}
            error={inlineError?.scope === 'apply' ? inlineError.message : null}
            onReset={onReset}
          />
        </div>
      )}

      {phase === 'suggestions' && suggestions.length === 0 && (
        <div className="mt-8">
          <div className="bg-success/10 border border-success/30 rounded-xl p-5 mb-8">
            <p className="font-semibold text-success">当前练度已是最佳配置</p>
            <p className="text-success/80 text-sm mt-1">
              {currentResultIsRotation
                ? '无需应用升级建议，请按排班详情在游戏内手动设置。'
                : '无需应用升级建议，可直接下载优化结果。'}
            </p>
          </div>
          <ResultPanel result={currentResult!} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}

      {phase === 'final' && finalResult && (
        <div className="mt-8">
          <div className="bg-success/10 border border-success/30 rounded-xl p-5 mb-8">
            <p className="font-semibold text-success">排班方案已生成</p>
            <p className="text-success/80 text-sm mt-1">
              {finalResultIsRotation
                ? '已应用练度修改，请按排班详情在游戏内手动设置。'
                : '已应用练度修改。'}
            </p>
          </div>
          <ResultPanel result={finalResult} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}
    </div>
  )
}

function CommandBand({
  config,
  configChanged,
  operatorCount,
  fileId,
  validation,
  loading,
  progress,
  hasResult,
  resultIsCurrent,
  error,
  onGenerate,
  onReset,
}: {
  config: LicenseConfig;
  configChanged: boolean;
  operatorCount: number;
  fileId: string;
  validation: { ok: true } | { ok: false; message: string };
  loading: boolean;
  progress: ScheduleProgressState | null;
  hasResult: boolean;
  resultIsCurrent: boolean;
  error: string | null;
  onGenerate: () => void;
  onReset: () => void;
}) {
  const validationMessage = validation.ok === false ? validation.message : null

  return (
    <section className="rounded-xl bg-surface-1 p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-400">文件已载入</p>
          <h2 className="mt-1 text-xl font-semibold text-ink-primary">
            排班方案
          </h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-secondary">
            <span className="rounded-full bg-surface-2 px-2.5 py-1">ID {fileId}</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1">{operatorCount} 名干员</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1">
              {SCHEDULE_MODE_LABELS[normalizeScheduleMode(config.schedule_mode)]}
            </span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1">{config.layout}</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1">{config.desc}</span>
            {configChanged && (
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning">配置已调整</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading || !validation.ok || resultIsCurrent}
            className="rounded-xl bg-surface-2 px-5 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-muted"
          >
            {loading ? (
              <span className="inline-flex items-center gap-3">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                正在计算...
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
      {validationMessage && (
        <InlineErrorPanel message={validationMessage} onRetry={onGenerate} onReset={onReset} />
      )}
      {error && !validationMessage && (
        <InlineErrorPanel message={error} onRetry={onGenerate} onReset={onReset} />
      )}
    </section>
  )
}

function buildOptimizeSignature(operators: LicenseOperator[], config: LicenseConfig): string {
  return canonicalJson({ operators, config })
}

function waitForProgressCompletion(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SCHEDULE_PROGRESS_COMPLETION_DURATION_MS))
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
          Admin 干员数据
          <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-300">
            {operatorCount} 名干员
          </span>
        </span>
        <span className="text-xs font-medium text-ink-muted">替换 operators.json</span>
      </summary>
      <div className="border-t border-surface-3/60 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">替换干员数据</h2>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            上传 operators.json 或 .txt 后会清空当前练度调整，下一次生成时使用新的干员数据。
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

async function readResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { error?: string }
    return data.error || fallback
  } catch {
    return fallback
  }
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
