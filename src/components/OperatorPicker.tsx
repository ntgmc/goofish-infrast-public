import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SearchIcon } from './icons'
import { matchesSearch } from '../lib/search'
import { copy } from '../copy'
import { OperatorAvatarTile } from './result-panel/OperatorAvatarStrip'

export default function OperatorPicker<T extends { id: string; name: string }>({ operators, selectedId, onChoose, details, title, controls, hint, searchLabel = copy.domain.manual_schedule.search }: {
  operators: T[]
  selectedId?: string
  onChoose: (operator: T) => void
  details: (operator: T) => ReactNode
  title?: (operator: T) => string
  controls?: ReactNode
  hint?: ReactNode
  searchLabel?: string
}) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (composing || search.trim() === query) return
    const timer = window.setTimeout(() => setQuery(search.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [search, composing, query])
  useEffect(() => {
    setVisibleCount(30)
    if (grid.current) grid.current.scrollTop = 0
  }, [operators, query])
  const matches = useMemo(() => operators.filter((operator) => matchesSearch(operator.name, query)), [operators, query])
  const candidates = useDeferredValue(matches, [])
  // shortcut: keep scrolled batches mounted; window rows if inventories grow to thousands.
  const showMore = useCallback(() => setVisibleCount((count) => Math.min(count + 30, matches.length)), [matches.length])
  return <>
    <div className="space-y-2">
      <div className="operator-picker-search flex min-w-0 items-center rounded-lg border border-surface-3 bg-surface-2/40 transition-colors duration-150 focus-within:border-brand-500">
        <label className="flex min-w-0 flex-1 items-center gap-2 px-3">
          <SearchIcon size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
            placeholder={searchLabel} aria-label={searchLabel}
            className="min-h-11 min-w-0 w-full bg-transparent text-sm text-ink-primary placeholder:text-ink-muted" />
        </label>
        {controls}
      </div>
      {hint && <p className="text-xs leading-5 text-ink-muted">{hint}</p>}
    </div>
    <div ref={grid} className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:max-h-72 sm:grid-cols-2 lg:grid-cols-3" aria-label={copy.domain.manual_schedule.picker}
      aria-busy={matches !== candidates || composing || query !== search.trim()} onScroll={(event) => {
        const element = event.currentTarget
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) showMore()
      }}>
      {candidates.length > 0 ? candidates.slice(0, visibleCount).map((operator, index) => <button key={operator.id} type="button" aria-label={operator.name} aria-pressed={selectedId === operator.id}
        title={title?.(operator) ?? operator.name}
        className={`flex min-h-22 min-w-0 items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${selectedId === operator.id ? 'border-brand-400 bg-brand-500/10' : 'border-surface-3 hover:bg-surface-2'}`}
        onFocus={index === visibleCount - 1 ? showMore : undefined} onClick={() => onChoose(operator)}>
        <div className="shrink-0"><OperatorAvatarTile operator={operator} compact showFullNames buttonChild /></div>
        <div className="min-w-0 flex-1 space-y-1.5">{details(operator)}</div>
      </button>) : matches.length > 0
        ? <div className="col-span-full h-52 rounded-md bg-surface-2 sm:h-72" aria-hidden="true" />
        : <p className="col-span-full py-6 text-center text-sm text-ink-muted">{copy.domain.manual_schedule.no_matches}</p>}
    </div>
  </>
}
