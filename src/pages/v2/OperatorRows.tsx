import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { copy } from '../../copy'
import type { LicenseOperator } from '../../lib/types'
import BuildingSkills from './BuildingSkills'
import { Avatar } from './ScheduleBoard'

export default memo(function OperatorRows({ operators }: { operators: LicenseOperator[] }) {
  const list = useRef<HTMLDivElement>(null)
  const expanded = useRef(new Set<string>())
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const virtual = operators.length > 100
  const focusedIndex = focusedId === null ? -1 : operators.findIndex((operator) => operator.id === focusedId)
  const getItemKey = useCallback((index: number) => operators[index].id, [operators])
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indices = defaultRangeExtractor(range)
    // Keep focus and its neighbours mounted so Tab can continue through the list.
    if (focusedIndex >= 0) {
      for (let index = Math.max(0, focusedIndex - 1); index <= Math.min(range.count - 1, focusedIndex + 1); index++) indices.push(index)
    }
    return [...new Set(indices)].sort((left, right) => left - right)
  }, [focusedIndex])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: operators.length,
    enabled: virtual,
    getScrollElement: () => list.current?.closest<HTMLDivElement>('.v2-drawer-body') ?? null,
    getItemKey,
    estimateSize: () => 140,
    overscan: 4,
    scrollMargin,
    rangeExtractor,
  })

  useLayoutEffect(() => {
    const element = list.current
    const scroll = element?.closest<HTMLDivElement>('.v2-drawer-body')
    if (!virtual || !element || !scroll) return
    const measure = () => setScrollMargin(element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientTop)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    observer.observe(element.closest('.v2-operator-management') ?? element)
    return () => observer.disconnect()
  }, [virtual])

  useLayoutEffect(() => {
    const element = list.current
    const scroll = element?.closest<HTMLDivElement>('.v2-drawer-body')
    if (!element || !scroll) return
    const top = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientTop
    if (scroll.scrollTop > top) scroll.scrollTop = top
  }, [operators])

  const rows = virtual ? virtualizer.getVirtualItems() : operators.map((operator, index) => ({ key: operator.id, index, start: 0 }))
  return <div ref={list} className={virtual ? 'v2-operator-virtual-list' : undefined} role="list" aria-label={copy.v2.operatorManagement.list}
    style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
    onFocusCapture={(event) => {
      const index = event.target.closest<HTMLElement>('[data-index]')?.dataset.index
      if (index !== undefined) setFocusedId(operators[Number(index)].id)
    }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null) }}>
    {rows.map((row) => {
      const operator = operators[row.index]
      return <div key={row.key} ref={virtual ? virtualizer.measureElement : undefined} data-index={row.index}
        className={`v2-operator-entry${virtual ? ' v2-operator-virtual-row' : ''}`} data-owned={operator.own !== false}
        role="listitem" aria-posinset={row.index + 1} aria-setsize={operators.length}
        style={virtual ? { transform: `translateY(${row.start - scrollMargin}px)` } : undefined}>
        <OperatorRow operator={operator} expanded={expanded.current} />
      </div>
    })}
  </div>
})

const OperatorRow = memo(function OperatorRow({ operator, expanded }: { operator: LicenseOperator; expanded: Set<string> }) {
  return <>
    <div className="v2-operator-row"><Avatar operator={operator} /><strong>{operator.name}</strong>
      <span className="v2-operator-status">{operator.own !== false ? copy.v2.ownedLabel : copy.v2.notOwnedLabel}</span>
      <div className="v2-operator-training"><span className="v2-operator-status">{copy.v2.elite(operator.elite)}</span>
        <span className="v2-operator-status">{copy.v2.operatorLevel(typeof operator.level === 'number' || typeof operator.level === 'string' ? operator.level : undefined)}</span></div>
    </div><BuildingSkills operator={operator} defaultOpen={expanded.has(operator.id)}
      onOpenChange={(open) => { if (open) expanded.add(operator.id); else expanded.delete(operator.id) }} />
  </>
})
