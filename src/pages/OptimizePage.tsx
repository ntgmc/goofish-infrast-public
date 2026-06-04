import { useState, useCallback } from 'react'
import type { LicenseFile, OptimizeResult, UpgradeSuggestion } from '../lib/types'
import { mergeOperators } from '../lib/license'
import { deriveClientKey, signClientState, encryptPayload, canonicalJson } from '../lib/crypto'
import UpgradeSuggestions from '../components/UpgradeSuggestions'
import ResultPanel from '../components/ResultPanel'

interface Props {
  license: LicenseFile;
  eliteOverrides: Record<string, number>;
  setEliteOverrides: (v: Record<string, number>) => void;
  onReset: () => void;
}

export default function OptimizePage({ license, eliteOverrides, setEliteOverrides, onReset }: Props) {
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([])
  const [currentResult, setCurrentResult] = useState<OptimizeResult | null>(null)
  const [finalResult, setFinalResult] = useState<OptimizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'suggestions' | 'final'>('idle')

  const mergedOperators = mergeOperators(license.operators, eliteOverrides)

  const runOptimize = useCallback(async (ignoreElite: boolean) => {
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operators: mergedOperators, config: license.config, ignore_elite: ignoreElite }),
    })
    if (!resp.ok) throw new Error(`优化请求失败: ${resp.status}`)
    return resp.json() as Promise<OptimizeResult>
  }, [mergedOperators, license.config])

  const handleGenerate = useCallback(async () => {
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
  }, [runOptimize])

  const handleApplySuggestions = useCallback(async (selectedIds: string[]) => {
    const newOverrides = { ...eliteOverrides }
    for (const s of suggestions) {
      if (s.type === 'single' && s.id && selectedIds.includes(s.id) && s.target_elite !== undefined) {
        newOverrides[s.id] = s.target_elite
      }
      if (s.type === 'bundle' && s.id && s.ops && selectedIds.includes(s.id)) {
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
          config: license.config,
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
  }, [eliteOverrides, suggestions, license, setEliteOverrides])

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
    const derivedKey = await deriveClientKey(license.sig)
    const clientSig = await signClientState(derivedKey, eliteOverrides)
    const workfile = {
      license,
      client_state: {
        operator_elite_overrides: eliteOverrides,
        updated_at: new Date().toISOString(),
        client_sig: clientSig,
      },
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
  }, [license, eliteOverrides])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <header className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">
            智能排班生成器
          </h1>
          <p className="text-ink-secondary text-sm mt-1">
            配置: {license.config.desc} · ID: {license.order_hash.slice(0, 8)}...
          </p>
        </div>
        <button 
          onClick={onReset} 
          className="text-ink-secondary hover:text-ink-primary text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors duration-150"
        >
          退出登录
        </button>
      </header>

      {/* Idle state */}
      {phase === 'idle' && !currentResult && (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-surface-2 mb-8">
            <span className="text-4xl" role="img" aria-label="生成">🤖</span>
          </div>
          <h2 className="text-xl font-semibold text-ink-primary mb-4">
            准备生成排班方案
          </h2>
          <p className="text-ink-secondary mb-8 max-w-md mx-auto">
            基于当前干员配置和基建布局，计算最优排班方案
          </p>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-brand-600 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted text-white font-semibold py-4 px-10 rounded-xl text-lg transition-colors duration-150"
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
              '🚀 生成排班方案'
            )}
          </button>
        </div>
      )}

      {/* Suggestions phase */}
      {phase === 'suggestions' && suggestions.length > 0 && (
        <UpgradeSuggestions
          suggestions={suggestions}
          onApply={handleApplySuggestions}
          loading={loading}
        />
      )}

      {/* No suggestions */}
      {phase === 'suggestions' && suggestions.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mb-6">
            <span className="text-3xl" role="img" aria-label="完成">✅</span>
          </div>
          <h2 className="text-xl font-semibold text-success mb-4">
            当前练度已是最佳配置
          </h2>
          <p className="text-ink-secondary mb-8">
            无需升级建议，直接查看优化结果
          </p>
          <ResultPanel result={currentResult!} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}

      {/* Final phase */}
      {phase === 'final' && finalResult && (
        <div>
          <div className="bg-success/10 border border-success/30 rounded-xl p-5 mb-8">
            <div className="flex items-center gap-3">
              <span className="text-2xl" role="img" aria-label="成功">✅</span>
              <div>
                <p className="font-semibold text-success">排班方案已生成</p>
                <p className="text-success/80 text-sm mt-1">已应用练度修改</p>
              </div>
            </div>
          </div>
          <ResultPanel result={finalResult} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}
    </div>
  )
}