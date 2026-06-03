import { useState } from 'react'
import type { UpgradeSuggestion } from '../lib/types'

interface Props {
  suggestions: UpgradeSuggestion[];
  onApply: (selectedIds: string[]) => void;
  loading: boolean;
}

export default function UpgradeSuggestions({ suggestions, onApply, loading }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const getBadge = (gain: number) => {
    if (gain >= 20) return { cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-500', icon: '🔥', label: '极大提升' }
    if (gain >= 10) return { cls: 'bg-purple-900/40 text-purple-300 border-purple-500', icon: '✨', label: '显著提升' }
    return { cls: 'bg-blue-900/40 text-blue-300 border-blue-500', icon: '📈', label: '效率提升' }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">📊 练度优化建议</h2>
      <p className="text-gray-400 text-sm mb-4">勾选要应用的建议，然后点击「应用选中建议」</p>

      <div className="space-y-3 mb-6">
        {suggestions.map((s, i) => {
          const badge = getBadge(s.gain)
          const id = s.id || `bundle-${i}`
          return (
            <label
              key={id}
              className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center gap-4 cursor-pointer hover:border-gray-500 transition"
            >
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => toggle(id)}
                className="w-5 h-5 accent-blue-500"
              />
              <div className="flex-1">
                <span className="font-bold text-lg">{s.name || s.ops?.map(o => o.name).join('+')}</span>
                <span className="text-gray-400 ml-3 text-sm">{s.desc}</span>
              </div>
              <span className={`px-3 py-1 rounded text-sm font-bold border ${badge.cls}`}>
                {badge.icon} {badge.label} +{s.gain}%
              </span>
            </label>
          )
        })}
      </div>

      <button
        onClick={() => onApply(Array.from(selected))}
        disabled={loading || selected.size === 0}
        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold py-2 px-6 rounded transition"
      >
        {loading ? '计算中...' : `应用选中建议 (${selected.size})`}
      </button>
    </div>
  )
}
