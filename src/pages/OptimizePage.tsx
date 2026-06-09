import { useState, useCallback, useMemo } from 'react'
import type { LicenseConfig, LicenseFile, OptimizeResult, PermissionMode, UpgradeSuggestion } from '../lib/types'
import { canEditConfig, getPermissionMode, mergeOperators } from '../lib/license'
import { deriveClientKey, signClientState, encryptPayload, canonicalJson } from '../lib/crypto'
import UpgradeSuggestions from '../components/UpgradeSuggestions'
import ResultPanel from '../components/ResultPanel'

interface Props {
  license: LicenseFile;
  eliteOverrides: Record<string, number>;
  setEliteOverrides: (v: Record<string, number>) => void;
  configOverride: LicenseConfig | null;
  setConfigOverride: (v: LicenseConfig | null) => void;
  onReset: () => void;
}

type ProductGroup = 'trading_stations' | 'manufacturing_stations'

const TRADING_PRODUCTS = ['LMD', 'Orundum']
const MANUFACTURING_PRODUCTS = ['Pure Gold', 'Battle Record', 'Originium Shard']
const PRODUCT_LABELS: Record<string, string> = {
  LMD: '龙门币',
  Orundum: '合成玉',
  'Pure Gold': '赤金',
  'Battle Record': '作战记录',
  'Originium Shard': '源石碎片',
}
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  basic: 'Basic',
  premium: 'Premium',
  admin: 'Admin',
}

function cloneConfig(config: LicenseConfig): LicenseConfig {
  return JSON.parse(JSON.stringify(config)) as LicenseConfig
}

function sumCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

function normalizeConfig(config: LicenseConfig): LicenseConfig {
  const next = cloneConfig(config)
  next.product_requirements = {
    trading_stations: { ...(next.product_requirements?.trading_stations ?? {}) },
    manufacturing_stations: { ...(next.product_requirements?.manufacturing_stations ?? {}) },
  }
  next.trading_stations_count = Number.isFinite(next.trading_stations_count) ? next.trading_stations_count : 2
  next.manufacturing_stations_count = Number.isFinite(next.manufacturing_stations_count) ? next.manufacturing_stations_count : 4
  next.layout = next.layout || `${next.trading_stations_count}-${next.manufacturing_stations_count}-3`
  next.desc = next.desc || `${next.layout} 基建配置`
  next.Fiammetta = next.Fiammetta ?? { enable: false }
  next.drones = next.drones ?? { enable: false, order: 'pre', targets: [] }
  return next
}

function buildCustomDesc(config: LicenseConfig): string {
  return `${config.trading_stations_count}-${config.manufacturing_stations_count}-3 自定义配置`
}

function applyCounts(config: LicenseConfig): LicenseConfig {
  config.layout = `${config.trading_stations_count}-${config.manufacturing_stations_count}-3`
  config.desc = buildCustomDesc(config)
  return config
}

function validateConfig(config: LicenseConfig): { ok: true } | { ok: false; message: string } {
  const tradingCount = config.trading_stations_count
  const manufacturingCount = config.manufacturing_stations_count
  if (!Number.isInteger(tradingCount) || !Number.isInteger(manufacturingCount)) {
    return { ok: false, message: '贸易站和制造站数量必须是整数。' }
  }
  if (tradingCount < 1 || manufacturingCount < 1 || tradingCount + manufacturingCount !== 6) {
    return { ok: false, message: '当前版本固定 3 个发电站，贸易站 + 制造站需要等于 6。' }
  }
  const tradingTotal = sumCounts(config.product_requirements.trading_stations)
  if (tradingTotal !== tradingCount) {
    return { ok: false, message: `贸易产物数量合计为 ${tradingTotal}，需要等于 ${tradingCount}。` }
  }
  const manufacturingTotal = sumCounts(config.product_requirements.manufacturing_stations)
  if (manufacturingTotal !== manufacturingCount) {
    return { ok: false, message: `制造产物数量合计为 ${manufacturingTotal}，需要等于 ${manufacturingCount}。` }
  }
  if (config.drones?.enable && (!Array.isArray(config.drones.targets) || config.drones.targets.length === 0)) {
    return { ok: false, message: '启用无人机时至少需要一个加速目标。' }
  }
  return { ok: true }
}

export default function OptimizePage({
  license,
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

  const permission = getPermissionMode(license)
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
          退出登录
        </button>
      </header>

      <ConfigPanel
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
                基于当前干员配置和基建布局计算排班方案，完成后可直接下载给 MAA 使用的结果文件。
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

function ConfigPanel({
  config,
  permission,
  canEdit,
  changed,
  validation,
  onUpdate,
  onReset,
}: {
  config: LicenseConfig;
  permission: PermissionMode;
  canEdit: boolean;
  changed: boolean;
  validation: { ok: true } | { ok: false; message: string };
  onUpdate: (mutate: (config: LicenseConfig) => void) => void;
  onReset: () => void;
}) {
  const tradingProducts = uniqueProducts(TRADING_PRODUCTS, config.product_requirements.trading_stations)
  const manufacturingProducts = uniqueProducts(MANUFACTURING_PRODUCTS, config.product_requirements.manufacturing_stations)
  const droneTargets = (config.drones?.targets ?? []).join(', ')

  const applyPreset = (
    desc: string,
    tradingCount: number,
    manufacturingCount: number,
    trading: Record<string, number>,
    manufacturing: Record<string, number>
  ) => {
    onUpdate((next) => {
      next.layout = `${tradingCount}-${manufacturingCount}-3`
      next.desc = desc
      next.trading_stations_count = tradingCount
      next.manufacturing_stations_count = manufacturingCount
      next.product_requirements = {
        trading_stations: { ...trading },
        manufacturing_stations: { ...manufacturing },
      }
    })
  }

  const setStationCounts = (tradingCount: number, manufacturingCount: number) => {
    onUpdate((next) => {
      next.trading_stations_count = tradingCount
      next.manufacturing_stations_count = manufacturingCount
      next.product_requirements.trading_stations = fitProductCounts(
        next.product_requirements.trading_stations,
        tradingProducts,
        tradingCount,
        'LMD'
      )
      next.product_requirements.manufacturing_stations = fitProductCounts(
        next.product_requirements.manufacturing_stations,
        manufacturingProducts,
        manufacturingCount,
        'Pure Gold'
      )
      applyCounts(next)
    })
  }

  const setProductCount = (group: ProductGroup, product: string, value: number) => {
    onUpdate((next) => {
      next.product_requirements[group][product] = Math.max(0, Math.min(6, value))
      applyCounts(next)
    })
  }

  return (
    <section className="bg-surface-1 rounded-xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-surface-3/60 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-primary">基建配置</h2>
            {changed && (
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                已修改
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            {canEdit
              ? '修改配置后重新生成，保存工作文件会保留这次配置。'
              : `当前为 ${PERMISSION_LABELS[permission]} 权限，使用授权文件内的固定配置。`}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyPreset(
                '243 均衡流 (2赤金/2经验)',
                2,
                4,
                { LMD: 2 },
                { 'Pure Gold': 2, 'Battle Record': 2 }
              )}
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              243 均衡
            </button>
            <button
              type="button"
              onClick={() => applyPreset(
                '243 搓玉 (2赤金/2源石)',
                2,
                4,
                { LMD: 1, Orundum: 1 },
                { 'Pure Gold': 2, 'Originium Shard': 2 }
              )}
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              243 搓玉
            </button>
            <button
              type="button"
              onClick={() => applyPreset(
                '333 搓玉流',
                3,
                3,
                { LMD: 2, Orundum: 1 },
                { 'Pure Gold': 2, 'Originium Shard': 1 }
              )}
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              333 搓玉
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={!changed}
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:cursor-not-allowed disabled:text-ink-muted"
            >
              恢复授权配置
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 pt-5 lg:grid-cols-[1fr_1fr_0.9fr]">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-ink-primary">房间结构</h3>
              <p className="mt-1 text-xs text-ink-muted">当前: {config.layout}</p>
            </div>
          </div>
          {canEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <CounterField
                label="贸易站"
                value={config.trading_stations_count}
                min={1}
                max={5}
                onChange={(value) => setStationCounts(value, 6 - value)}
              />
              <CounterField
                label="制造站"
                value={config.manufacturing_stations_count}
                min={1}
                max={5}
                onChange={(value) => setStationCounts(6 - value, value)}
              />
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <ReadOnlyMetric label="贸易站" value={config.trading_stations_count} />
              <ReadOnlyMetric label="制造站" value={config.manufacturing_stations_count} />
            </dl>
          )}
        </div>

        <div className="rounded-lg bg-surface-2/60 p-4">
          <h3 className="font-semibold text-ink-primary">产物数量</h3>
          <div className="mt-4 space-y-4">
            <ProductGroupEditor
              label="贸易"
              products={tradingProducts}
              counts={config.product_requirements.trading_stations}
              canEdit={canEdit}
              onChange={(product, value) => setProductCount('trading_stations', product, value)}
            />
            <ProductGroupEditor
              label="制造"
              products={manufacturingProducts}
              counts={config.product_requirements.manufacturing_stations}
              canEdit={canEdit}
              onChange={(product, value) => setProductCount('manufacturing_stations', product, value)}
            />
          </div>
        </div>

        <div className="rounded-lg bg-surface-2/60 p-4">
          <h3 className="font-semibold text-ink-primary">特殊策略</h3>
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span>菲亚梅塔</span>
              <input
                type="checkbox"
                checked={config.Fiammetta?.enable ?? false}
                disabled={!canEdit}
                onChange={(event) => onUpdate((next) => {
                  next.Fiammetta = { enable: event.currentTarget.checked }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
              <span>无人机</span>
              <input
                type="checkbox"
                checked={config.drones?.enable ?? false}
                disabled={!canEdit}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { order: 'pre', targets: [] }),
                    enable: event.currentTarget.checked,
                  }
                  applyCounts(next)
                })}
                className="h-4 w-4 accent-brand-500"
              />
            </label>
            <div>
              <label className="mb-2 block text-xs font-medium text-ink-muted" htmlFor="drone-order">
                无人机顺序
              </label>
              <select
                id="drone-order"
                value={config.drones?.order ?? 'pre'}
                disabled={!canEdit || !config.drones?.enable}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { enable: true, targets: [] }),
                    order: event.currentTarget.value,
                  }
                  applyCounts(next)
                })}
                className="w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary disabled:text-ink-muted"
              >
                <option value="pre">pre</option>
                <option value="post">post</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-ink-muted" htmlFor="drone-targets">
                加速目标
              </label>
              <input
                id="drone-targets"
                type="text"
                value={droneTargets}
                disabled={!canEdit || !config.drones?.enable}
                onChange={(event) => onUpdate((next) => {
                  next.drones = {
                    ...(next.drones ?? { enable: true, order: 'pre' }),
                    targets: event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean),
                  }
                  applyCounts(next)
                })}
                placeholder="LMD, Pure Gold, LMD"
                className="w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted disabled:text-ink-muted"
              />
            </div>
          </div>
        </div>
      </div>

      {!validation.ok && (
        <p className="mt-4 text-sm text-warning">{validation.message}</p>
      )}
    </section>
  )
}

function uniqueProducts(defaults: string[], counts: Record<string, number>): string[] {
  return Array.from(new Set([...defaults, ...Object.keys(counts ?? {})]))
}

function fitProductCounts(
  current: Record<string, number>,
  products: string[],
  total: number,
  fallbackProduct: string
): Record<string, number> {
  const next: Record<string, number> = {}
  let remaining = total
  for (const product of products) {
    const count = Math.max(0, Math.min(remaining, current[product] ?? 0))
    if (count > 0) {
      next[product] = count
      remaining -= count
    }
  }
  if (remaining > 0) {
    next[fallbackProduct] = (next[fallbackProduct] ?? 0) + remaining
  }
  return next
}

function CounterField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-ink-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="number-input-clean w-full rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
      />
    </label>
  )
}

function ReadOnlyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-1 px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}

function ProductGroupEditor({
  label,
  products,
  counts,
  canEdit,
  onChange,
}: {
  label: string;
  products: string[];
  counts: Record<string, number>;
  canEdit: boolean;
  onChange: (product: string, value: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-muted">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {products.map((product) => (
          <label key={product} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-sm">
            <span className="text-ink-secondary">{PRODUCT_LABELS[product] ?? product}</span>
            {canEdit ? (
              <input
                type="number"
                min={0}
                max={6}
                value={counts[product] ?? 0}
                onChange={(event) => onChange(product, Number(event.currentTarget.value))}
                className="number-input-clean w-16 rounded-md border border-surface-4 bg-surface-0 px-3 py-1 text-right text-ink-primary"
              />
            ) : (
              <span className="font-semibold text-ink-primary">{counts[product] ?? 0}</span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
