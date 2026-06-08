import { useCallback, useMemo, useState } from 'react'
import type { UpgradeSuggestion } from '../lib/types'

interface Props {
  suggestions: UpgradeSuggestion[];
  onApply: (selectedIds: string[]) => void;
  loading: boolean;
}

export default function UpgradeSuggestions({ suggestions, onApply, loading }: Props) {
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
    if (gain >= 20) return { cls: 'bg-warning/10 text-warning border-warning/30', icon: '🔥', label: '极大提升' }
    if (gain >= 10) return { cls: 'bg-brand-500/10 text-brand-400 border-brand-500/30', icon: '✅', label: '显著提升' }
    return { cls: 'bg-surface-3 text-ink-secondary border-surface-4', icon: '📊', label: '效率提升' }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-ink-primary mb-2">
          🎯 练度优化建议
        </h2>
        <p className="text-ink-secondary text-sm">
          勾选要应用的建议，然后点击「应用选中建议」
        </p>
      </div>

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
                <span className="mr-1.5">{badge.icon}</span>
                {badge.label}
                <span className="ml-2 font-mono">+{s.gain}%</span>
              </div>
            </label>
          )
        })}
      </div>

      {/* Apply button */}
      <div className="sticky bottom-6 pt-4">
        <button
          onClick={() => onApply(selectedIds)}
          disabled={loading || selected.size === 0}
          className="w-full bg-success hover:bg-success/90 disabled:bg-surface-3 disabled:text-ink-muted text-white font-semibold py-4 px-8 rounded-xl text-lg transition-colors duration-150 shadow-lg shadow-success/20"
        >
          {loading ? (
            <span className="inline-flex items-center gap-3">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              计算中...
            </span>
          ) : (
            `应用选中建议 (${selected.size})`
          )}
        </button>
      </div>
    </div>
  )
}
