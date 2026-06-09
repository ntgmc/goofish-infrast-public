import { useState, useCallback, useMemo, useRef } from 'react'
import type { LicenseConfig, LicenseFile, LicenseOperator, OptimizeResult, UpgradeSuggestion } from '../lib/types'
import { canEditConfig, getPermissionMode, mergeOperators } from '../lib/license'
import { deriveClientKey, signClientState, encryptPayload, canonicalJson } from '../lib/crypto'
import ConfigEditor, { normalizeConfig, validateConfig, PERMISSION_LABELS } from '../components/ConfigEditor'
import UpgradeSuggestions from '../components/UpgradeSuggestions'
import ResultPanel from '../components/ResultPanel'

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
  const [phase, setPhase] = useState<'idle' | 'suggestions' | 'final'>('idle')
  const [operatorUploadStatus, setOperatorUploadStatus] = useState<string | null>(null)
  const operatorFileRef = useRef<HTMLInputElement>(null)

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

  const mergedOperators = useMemo(
    () => mergeOperators(license.operators, eliteOverrides),
    [license.operators, eliteOverrides]
  )

  const clearGeneratedResult = useCallback(() => {
    setSuggestions([])
    setCurrentResult(null)
    setFinalResult(null)
    setPhase('idle')
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

  const runOptimize = useCallback(async (ignoreElite: boolean) => {
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operators: mergedOperators, config: activeConfig, ignore_elite: ignoreElite }),
    })
    if (!resp.ok) throw new Error(`优化请求失败: ${resp.status}`)
    return resp.json() as Promise<OptimizeResult>
  }, [activeConfig, mergedOperators])

  const handleGenerate = useCallback(async () => {
    if (!configValidation.ok) {
      alert(configValidation.message)
      return
    }
    setLoading(true)
    try {
      const current = await runOptimize(false)
      setCurrentResult(current)
      const potential = await runOptimize(true)
      const serverSuggestions = (potential as unknown as Record<string, unknown>).upgrade_suggestions as Record<string, unknown>[] | undefined
      if (serverSuggestions && serverSuggestions.length > 0) {
        const upgradeList: UpgradeSuggestion[] = serverSuggestions.map((s, idx) => {
          if (s.type === 'single') {
            return {
              type: 'single' as const,
              id: (s.id as string) || (s.name as string) || '',
              name: s.name as string,
              current_elite: s.current as number,
              target_elite: s.target as number,
              gain: Math.round(s.gain as number),
              desc: `${s.name}: 精${s.current} → 精${s.target}`,
            }
          }
          return {
            type: 'bundle' as const,
            id: `bundle-${idx}`,
            gain: Math.round(s.gain as number),
            desc: (s.ops as {name:string;current:number;target:number}[])?.map(o => `${o.name}: 精${o.current}→精${o.target}`).join(', ') || '',
            ops: (s.ops as {id?:string;name:string;current:number;target:number}[])?.map(o => ({
              id: o.id || o.name,
              name: o.name,
              current_elite: o.current,
              target_elite: o.target,
            })),
          }
        })
        setSuggestions(upgradeList.sort((a, b) => b.gain - a.gain).slice(0, 20))
      } else {
        setSuggestions([])
      }
      setPhase('suggestions')
    } catch (e) {
      alert('优化失败: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [configValidation, runOptimize])

  const handleApplySuggestions = useCallback(async (selectedIds: string[]) => {
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
          operators: mergeOperators(license.operators, newOverrides),
          config: activeConfig,
          ignore_elite: false,
        }),
      })
      if (!result.ok) throw new Error('优化失败')
      const data = await result.json() as OptimizeResult
      setFinalResult(data)
      setPhase('final')
    } catch (e) {
      alert('优化失败: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeConfig, eliteOverrides, suggestions, license.operators, setEliteOverrides])

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
        </div>
        <button
          onClick={onReset}
          className="self-start text-ink-secondary hover:text-ink-primary text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors duration-150 sm:self-auto"
        >
          重新选择文件
        </button>
      </header>

      {userCanReplaceOperators && (
        <AdminOperatorPanel
          operatorCount={license.operators.length}
          status={operatorUploadStatus}
          fileRef={operatorFileRef}
          onReplace={handleReplaceOperators}
        />
      )}

      <ConfigEditor
        config={activeConfig}
        permission={permission}
        canEdit={userCanEditConfig}
        changed={configChanged}
        validation={configValidation}
        onUpdate={updateConfig}
        onReset={resetConfig}
      />

      {phase === 'idle' && !currentResult && (
        <div className="mt-8 bg-surface-1 rounded-xl p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-400 mb-2">
                文件已载入
              </p>
              <h2 className="text-xl font-semibold text-ink-primary mb-2">
                生成基建排班方案
              </h2>
              <p className="text-ink-secondary text-sm max-w-xl">
                基于当前干员配置和基建布局计算排班方案，完成后可直接下载排班 JSON。
              </p>
              {!configValidation.ok && (
                <p className="mt-3 text-sm text-warning">
                  {configValidation.message}
                </p>
              )}
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !configValidation.ok}
              className="bg-brand-600 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted text-white font-semibold py-3 px-6 rounded-xl transition-colors duration-150 lg:flex-shrink-0"
            >
              {loading ? (
                <span className="inline-flex items-center gap-3">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  正在分析基建潜力...
                </span>
              ) : (
                '生成排班方案'
              )}
            </button>
          </div>
        </div>
      )}

      {phase === 'suggestions' && suggestions.length > 0 && (
        <div className="mt-8 space-y-8">
          {currentResult && (
            <CurrentPlanActions
              onDownload={handleDownloadMAA}
              onSaveWorkfile={handleSaveWorkfile}
            />
          )}
          <UpgradeSuggestions
            suggestions={suggestions}
            onApply={handleApplySuggestions}
            loading={loading}
          />
        </div>
      )}

      {phase === 'suggestions' && suggestions.length === 0 && (
        <div className="mt-8">
          <div className="bg-success/10 border border-success/30 rounded-xl p-5 mb-8">
            <p className="font-semibold text-success">当前练度已是最佳配置</p>
            <p className="text-success/80 text-sm mt-1">无需应用升级建议，可直接下载优化结果。</p>
          </div>
          <ResultPanel result={currentResult!} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}

      {phase === 'final' && finalResult && (
        <div className="mt-8">
          <div className="bg-success/10 border border-success/30 rounded-xl p-5 mb-8">
            <p className="font-semibold text-success">排班方案已生成</p>
            <p className="text-success/80 text-sm mt-1">已应用练度修改。</p>
          </div>
          <ResultPanel result={finalResult} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}
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
    <section className="mb-8 rounded-xl bg-surface-1 p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">Admin 干员数据</h2>
            <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-300">
              {operatorCount} 名干员
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            Admin 授权允许重新上传 operators.json 或 .txt，上传后会清空当前练度调整并重新计算排班。
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
          重新上传干员数据
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={onReplace}
          className="hidden"
        />
      </div>
    </section>
  )
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

function CurrentPlanActions({
  onDownload,
  onSaveWorkfile,
}: {
  onDownload: () => void;
  onSaveWorkfile: () => void;
}) {
  return (
    <div className="bg-surface-1 rounded-xl p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink-primary">
            当前排班已生成
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            可先下载当前方案，或保存工作文件继续保留练度与基建配置。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
          <button
            type="button"
            onClick={onDownload}
            className="bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-5 rounded-xl transition-colors duration-150"
          >
            下载当前排班
          </button>
          <button
            type="button"
            onClick={onSaveWorkfile}
            className="bg-surface-2 hover:bg-surface-3 text-ink-primary font-semibold py-3 px-5 rounded-xl transition-colors duration-150"
          >
            保存工作文件
          </button>
        </div>
      </div>
    </div>
  )
}
