import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useId, useLayoutEffect, useState, type CSSProperties } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { copy } from '../../copy'
import { motionTokens } from '../../components/MotionPrimitives'
import SharedCardDialog from '../../components/ui/shared-card-dialog'
import { DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { operatorBuildingSkills } from '../../components/result-panel/building-skills'
import { useListReveal } from '../../lib/use-list-reveal'
import { useAppReducedMotion } from '../../lib/motion-preference'
import type { LicenseOperator } from '../../lib/types'
import { BuildingSkillList } from './BuildingSkills'
import { Avatar } from './ScheduleBoard'

export default memo(function OperatorRows({ operators, reveal = true }: { operators: LicenseOperator[]; reveal?: boolean }) {
  const list = useListReveal(reveal, 50)
  const group = useId()
  const reduced = useAppReducedMotion()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId === null ? null : operators.find((operator) => operator.id === selectedId) ?? null
  const [columns, setColumns] = useState(1)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const virtual = operators.length > 100
  const rowCount = Math.ceil(operators.length / columns)
  const retainedId = selected?.id ?? focusedId
  const focusedIndex = retainedId === null ? -1 : operators.findIndex((operator) => operator.id === retainedId)
  const focusedRow = focusedIndex < 0 ? -1 : Math.floor(focusedIndex / columns)
  const getItemKey = useCallback((index: number) => operators[index * columns].id, [operators, columns])
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indices = defaultRangeExtractor(range)
    // Keep the open card and neighbouring rows mounted for the return transition and Tab.
    if (focusedRow >= 0) {
      for (let index = Math.max(0, focusedRow - 1); index <= Math.min(range.count - 1, focusedRow + 1); index++) indices.push(index)
    }
    return [...new Set(indices)].sort((left, right) => left - right)
  }, [focusedRow])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    enabled: virtual,
    getScrollElement: () => list.current?.closest<HTMLDivElement>('.v2-drawer-body') ?? null,
    getItemKey,
    estimateSize: () => 160,
    overscan: 3,
    scrollMargin,
    rangeExtractor,
  })

  useLayoutEffect(() => {
    const element = list.current
    const scroll = element?.closest<HTMLDivElement>('.v2-drawer-body')
    if (!element || !scroll) return
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setColumns(Math.max(1, Math.floor((element.clientWidth + rem * 0.5) / (rem * 8.5))))
      setScrollMargin(element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientTop)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(scroll)
    observer.observe(element.closest('.v2-operator-management') ?? element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => { virtualizer.measure() }, [columns, virtualizer])
  useLayoutEffect(() => {
    const element = list.current
    const scroll = element?.closest<HTMLDivElement>('.v2-drawer-body')
    if (!element || !scroll) return
    const top = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientTop
    if (scroll.scrollTop > top) scroll.scrollTop = top
  }, [operators])

  const selectedSkills = selected ? operatorBuildingSkills(selected) : []
  const rows = virtual ? virtualizer.getVirtualItems() : Array.from({ length: rowCount }, (_, index) => ({ key: operators[index * columns].id, index, start: 0 }))
  return <LayoutGroup id={group}>
    <div ref={list} className={`v2-operator-grid${virtual ? ' v2-operator-virtual-list' : ''}`} role="list" aria-label={copy.v2.operatorManagement.list}
      style={{ '--v2-operator-columns': columns, height: virtual ? virtualizer.getTotalSize() : undefined } as CSSProperties}
      onFocusCapture={(event) => {
        const index = event.target.closest<HTMLElement>('[data-operator-index]')?.dataset.operatorIndex
        if (index !== undefined) setFocusedId(operators[Number(index)].id)
      }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null) }}>
      {rows.map((row) => <div key={row.key} ref={virtual ? virtualizer.measureElement : undefined} data-index={row.index}
        className={`v2-operator-grid-row${virtual ? ' v2-operator-virtual-row' : ''}`}
        style={virtual ? { transform: `translateY(${row.start - scrollMargin}px)` } : undefined}>
        {operators.slice(row.index * columns, (row.index + 1) * columns).map((operator, column) => <motion.div key={operator.id}
          layoutDependency={selectedId} layoutId={reduced ? undefined : `card-${operator.id}`} transition={reduced ? { duration: 0 } : motionTokens.morph}
          className="v2-operator-entry" data-owned={operator.own !== false} data-operator-index={row.index * columns + column}
          style={{ borderRadius: 6 }} role="listitem" data-reveal-id={operator.id}
          aria-posinset={row.index * columns + column + 1} aria-setsize={operators.length}>
          <button type="button" className="v2-operator-card-trigger" aria-label={copy.v2.operatorManagement.skills(operator.name)} aria-haspopup="dialog" onClick={() => setSelectedId(operator.id)} />
          <div data-reveal-content><OperatorCard operator={operator} /></div>
        </motion.div>)}
      </div>)}
    </div>
    <AnimatePresence>{selected && <SharedCardDialog key={selected.id} layoutId={`card-${selected.id}`}
      onClose={() => setSelectedId(null)} closeLabel={copy.v2.close} className="v2-operator-detail">
      <header>
        <motion.span className="v2-operator-portrait" layoutId={reduced ? undefined : `portrait-${selected.id}`} transition={motionTokens.morph}><Avatar operator={selected} /></motion.span>
        <div><DialogTitle asChild><motion.h2 layoutId={reduced ? undefined : `name-${selected.id}`} transition={motionTokens.morph}>{selected.name}</motion.h2></DialogTitle>
          <DialogDescription>{copy.domain.building_skills.title} · {copy.v2.elite(selected.elite)} · {copy.v2.operatorLevel(typeof selected.level === 'number' || typeof selected.level === 'string' ? selected.level : undefined)}</DialogDescription></div>
      </header>
      <motion.div initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>
        {selectedSkills.length ? <BuildingSkillList skills={selectedSkills} /> : <p className="v2-muted">{copy.v2.skillsUnavailable}</p>}
      </motion.div>
    </SharedCardDialog>}</AnimatePresence>
  </LayoutGroup>
})

const OperatorCard = memo(function OperatorCard({ operator }: { operator: LicenseOperator }) {
  const reduced = useAppReducedMotion()
  const skills = operatorBuildingSkills(operator)
  return <>
    <div className="v2-operator-row">
      <motion.span className="v2-operator-portrait" layoutId={reduced ? undefined : `portrait-${operator.id}`} transition={motionTokens.morph}><Avatar operator={operator} /></motion.span>
      <motion.strong layoutId={reduced ? undefined : `name-${operator.id}`} transition={motionTokens.morph}>{operator.name}</motion.strong>
      <div className="v2-operator-training"><span className="v2-operator-status">{copy.v2.elite(operator.elite)}</span>
        <span className="v2-operator-status">{copy.v2.operatorLevel(typeof operator.level === 'number' || typeof operator.level === 'string' ? operator.level : undefined)}</span></div>
      <span className={operator.own === false ? 'v2-operator-status' : 'sr-only'}>{operator.own === false ? copy.v2.notOwnedLabel : copy.v2.ownedLabel}</span>
    </div>
    {skills.length ? <div className="v2-operator-skills-preview">
      <span>{copy.domain.building_skills.title}</span><span className="v2-skill-icons">{skills.filter((skill) => skill.state === 'active' || skill.state === 'unknown').map((skill) =>
        <img key={skill.id} src={`/building-skills/${skill.icon}.png`} alt={skill.name} width={20} height={20} loading="lazy" decoding="async" />)}</span><span aria-hidden="true">＋</span>
    </div> : <p className="v2-muted">{copy.v2.skillsUnavailable}</p>}
  </>
})
