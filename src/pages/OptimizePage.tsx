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
        const upgradeList: UpgradeSuggestion[] = serverSuggestions.map((s) => {
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
      if (s.type === 'bundle' && s.ops) {
        const allSelected = s.ops.every(op => selectedIds.includes(op.id))
        if (allSelected) {
          for (const op of s.ops) {
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
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">🏭 智能排班生成器</h1>
          <p className="text-gray-400 text-sm">配置: {license.config.desc} | ID: {license.order_hash.slice(0, 8)}...</p>
        </div>
        <div className="space-x-2">
          <button onClick={onReset} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm">
            退出登录
          </button>
        </div>
      </div>

      {phase === 'idle' && !currentResult && (
        <div className="text-center py-12">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-3 px-8 rounded-lg text-lg transition"
          >
            {loading ? '正在分析基建潜力...' : '🚀 生成排班方案'}
          </button>
        </div>
      )}

      {phase === 'suggestions' && suggestions.length > 0 && (
        <UpgradeSuggestions
          suggestions={suggestions}
          onApply={handleApplySuggestions}
          loading={loading}
        />
      )}

      {phase === 'suggestions' && suggestions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-green-400 text-lg mb-4">✅ 当前练度已是最优，无需提升</p>
          <ResultPanel result={currentResult!} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}

      {phase === 'final' && finalResult && (
        <div>
          <div className="bg-green-900/30 border border-green-500 rounded-lg p-4 mb-4">
            <p className="text-green-300">✅ 排班方案已生成（已应用练度修改）</p>
          </div>
          <ResultPanel result={finalResult} onDownload={handleDownloadMAA} onSaveWorkfile={handleSaveWorkfile} />
        </div>
      )}
    </div>
  )
}


