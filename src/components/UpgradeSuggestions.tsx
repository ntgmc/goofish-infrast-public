import { useCallback, useMemo, useState } from 'react'
import type { UpgradeSuggestion } from '../lib/types'
import ScheduleProgress, { type ScheduleProgressState } from './ScheduleProgress'

interface Props {
  suggestions: UpgradeSuggestion[];
  onApply: (selectedIds: string[]) => void;
  loading: boolean;
  progress?: ScheduleProgressState | null;
  error?: string | null;
  onReset: () => void;
}

export default function UpgradeSuggestions({ suggestions, onApply, loading, progress, error, onReset }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const selectedIds = useMemo(() => Array.from(selected), [selected])

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const getBadge = (gain: number) => {
    if (gain >= 20) return { cls: 'bg-warning/10 text-warning border-warning/30', label: '极大提升' }
    if (gain >= 10) return { cls: 'bg-brand-500/10 text-brand-400 border-brand-500/30', label: '显著提升' }
    return { cls: 'bg-surface-3 text-ink-secondary border-surface-4', label: '效率提升' }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink-primary mb-2">
            练度优化建议
          </h2>
          <p className="text-ink-secondary text-sm">
            可选路径：先下载当前方案离开，或勾选建议后重新计算。
          </p>
        </div>
        <button
          onClick={() => onApply(selectedIds)}
          disabled={loading || selected.size === 0}
          className="rounded-xl bg-surface-2 px-5 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-muted lg:flex-shrink-0"
        >
          {loading ? (
            <span className="inline-flex items-center gap-3">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              重新计算中...
            </span>
          ) : (
            `应用练度建议后重新计算 (${selected.size})`
          )}
        </button>
      </div>

      {loading && progress && (
        <ScheduleProgress progress={progress} />
      )}

      {error && (
        <div className="rounded-lg border border-error/40 bg-error/10 p-4">
          <p className="text-sm font-semibold text-error">应用建议失败</p>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onApply(selectedIds)}
              disabled={loading || selected.size === 0}
              className="rounded-lg bg-error px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-error/90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
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
      )}

      {/* Suggestions list */}
      <div className="space-y-3">
        {suggestions.map((s, i) => {
          const badge = getBadge(s.gain)
          const id = s.id || `bundle-${i}`
          return (
            <label
              key={id}
              className={`
                flex items-center gap-5 p-5 rounded-xl cursor-pointer
                transition-colors duration-150
                ${selected.has(id) 
                  ? 'bg-brand-500/10 border border-brand-500/30' 
                  : 'bg-surface-1 border border-transparent hover:border-surface-4'
                }
              `}
            >
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => toggle(id)}
                className="w-5 h-5 accent-brand-500 rounded"
                aria-label={`选择 ${s.name || '升级建议'}`}
              />

              {/* Operator images */}
              <div className="flex-shrink-0">
                {s.type === 'single' && s.id && (
                  <img 
                    src={`/webp96/${s.id}.webp`} 
                    alt="" 
                    className="w-12 h-12 rounded-lg bg-surface-2 object-cover"
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => (e.currentTarget.style.display = 'none')} 
                  />
                )}
                {s.type === 'bundle' && s.ops && (
                  <div className="flex -space-x-2">
                    {s.ops.slice(0, 4).map((op) => (
                      <img 
                        key={op.id} 
                        src={`/webp96/${op.id}.webp`} 
                        alt="" 
                        className="w-10 h-10 rounded-lg bg-surface-2 object-cover border-2 border-surface-1"
                        width={40}
                        height={40}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => (e.currentTarget.style.display = 'none')} 
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink-primary text-lg">
                  {s.name || s.ops?.map(o => o.name).join(' + ')}
                </div>
                <div className="text-ink-secondary text-sm mt-1">
                  {s.desc}
                </div>
              </div>

              {/* Badge */}
              <div className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold border ${badge.cls}`}>
                {badge.label}
                <span className="ml-2 font-mono">+{s.gain}%</span>
              </div>
            </label>
          )
        })}
      </div>

      <div className="rounded-lg bg-surface-1 p-4 text-sm text-ink-secondary">
        已选 {selected.size} 项。建议先下载当前方案留底；应用建议后，系统会重新计算并生成一份新方案，不会覆盖现在这份结果。
      </div>
    </div>
  )
}
