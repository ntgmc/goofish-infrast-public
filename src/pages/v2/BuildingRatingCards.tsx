import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { copy } from '../../copy'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import { motionTokens } from '../../components/MotionPrimitives'
import SharedCardDialog from '../../components/ui/shared-card-dialog'
import { DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { useAppReducedMotion } from '../../lib/motion-preference'
import { buildingRatingCharacter, comboBuildingRatingCore, comboBuildingRatingRange, ratingMemberStatus, ratingVariantStatus, type RatingCombo, type RatingRoster, type RatingVariant, type SingleBuildingRating } from '../../lib/building-skill-ratings'
import type { LicenseConfig } from '../../lib/types'
import { Avatar } from './ScheduleBoard'
import { RatingBadge, RatingStageDetails, RatingVariantDetails } from './BuildingRatingDetails'
import BuildingRatingVariantPicker from './BuildingRatingVariantPicker'

const text = copy.buildingRatings
export type BuildingRatingEntry = SingleBuildingRating | RatingCombo

function RatingIdentity({ entry, detail = false, variant }: { entry: BuildingRatingEntry; detail?: boolean; variant?: RatingVariant }) {
  const reduced = useAppReducedMotion()
  const combo = 'variants' in entry
  const name = combo ? entry.title : entry.name
  const range = variant ? { high: variant.score, low: undefined } : combo ? comboBuildingRatingRange(entry) : { high: entry.stage.assessment.score!, low: undefined }
  const primary = variant ?? (combo ? entry.variants.reduce((best, candidate) => candidate.score > best.score ? candidate : best) : null)
  const members = primary ? primary.members.filter((member) => member.room === entry.room) : []
  const portraits = combo ? (entry.partnerSlots && !detail ? comboBuildingRatingCore(entry) : members.length ? members : primary!.members).slice(0, 4) : [{ id: entry.operatorId }]
  const provisional = variant ? variant.provisional : combo ? entry.variants.some((candidate) => candidate.provisional) : entry.stage.assessment.provisional
  const Name = detail ? motion.h2 : motion.strong
  const title = <Name layoutId={reduced ? undefined : `rating-name-${entry.id}`} transition={motionTokens.morph}>{name}</Name>
  return <>
    <motion.div className="v2-rating-artwork" data-combo={combo || undefined} layoutId={reduced ? undefined : `rating-portrait-${entry.id}`} transition={motionTokens.morph}>
      <div className="v2-rating-portraits" data-combo={combo || undefined} data-count={portraits.length}>
        {portraits.map((member) => <Avatar key={member.id} operator={{ id: member.id, name: buildingRatingCharacter(member.id).name }} />)}
      </div>
      <RatingBadge score={range.high} low={range.low} emblem />
      {provisional && <span className="v2-rating-provisional">{text.provisional}</span>}
    </motion.div>
    <div className="v2-rating-identity">{detail ? <DialogTitle asChild>{title}</DialogTitle> : title}
      <span>{combo ? entry.usage : entry.stage.assessment.usage}</span>
    </div>
  </>
}

export function BuildingRatingGrid({ items, roster, activeId, onOpen }: { items: BuildingRatingEntry[]; roster: RatingRoster | null; activeId?: string; onOpen: (entry: BuildingRatingEntry, source: HTMLElement) => void }) {
  const grid = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [nearViewport, setNearViewport] = useState(true)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const virtual = typeof ResizeObserver !== 'undefined'
  const retainedIndex = items.findIndex((entry) => entry.id === (activeId ?? focusedId))
  const retainedRow = retainedIndex < 0 ? -1 : Math.floor(retainedIndex / columns)
  const count = Math.ceil(items.length / columns)
  const getItemKey = useCallback((index: number) => items[index * columns].id, [items, columns])
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indices = defaultRangeExtractor(range)
    // Retain the source and adjacent rows for the return transition and keyboard navigation.
    if (retainedRow >= 0) for (let index = Math.max(0, retainedRow - 1); index <= Math.min(range.count - 1, retainedRow + 1); index++) indices.push(index)
    return [...new Set(indices)].sort((a, b) => a - b)
  }, [retainedRow])
  const virtualizer = useWindowVirtualizer<HTMLDivElement>({ count, enabled: virtual, getItemKey, estimateSize: () => 240, overscan: 3, scrollMargin, rangeExtractor })
  useLayoutEffect(() => {
    const element = grid.current
    if (!element) return
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0
      setColumns(Math.max(1, Math.floor((element.clientWidth + gap) / (6 * rem + gap))))
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(element.closest('.v2-rating-results')!)
    // Single-row facilities need visibility updates even when the virtual range stays unchanged.
    const visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => setNearViewport(entry.isIntersecting), { rootMargin: '720px' })
    visibility?.observe(element)
    return () => { observer.disconnect(); visibility?.disconnect() }
  }, [])
  useLayoutEffect(() => { virtualizer.measure() }, [columns, virtualizer])
  const rows = virtualizer.getVirtualItems().filter((row) => nearViewport || retainedRow >= 0 && Math.abs(row.index - retainedRow) <= 1)
  const renderCard = (entry: BuildingRatingEntry, index: number) => <BuildingRatingCard key={entry.id} entry={entry} roster={roster} active={activeId === entry.id} onOpen={onOpen} position={index + 1} total={items.length} />
  return <div ref={grid} role="list" className={`v2-rating-grid${virtual ? ' v2-rating-virtual-grid' : ''}`} style={{ height: virtual ? virtualizer.getTotalSize() : undefined }}
    onFocusCapture={(event) => setFocusedId(event.target.closest<HTMLElement>('.v2-rating-card')?.id.slice('rating-'.length) ?? null)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null) }}>
    {virtual ? rows.map((row) => <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} className="v2-rating-grid v2-rating-virtual-row"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, transform: `translateY(${row.start - scrollMargin}px)` }}>
      {items.slice(row.index * columns, (row.index + 1) * columns).map((entry, index) => renderCard(entry, row.index * columns + index))}
    </div>) : items.map(renderCard)}
  </div>
}

const BuildingRatingCard = memo(function BuildingRatingCard({ entry, roster, active, onOpen, position, total }: { entry: BuildingRatingEntry; roster: RatingRoster | null; active: boolean; onOpen: (entry: BuildingRatingEntry, source: HTMLElement) => void; position: number; total: number }) {
  const reduced = useAppReducedMotion()
  const combo = 'variants' in entry
  const member = combo ? null : { id: entry.operatorId, room: entry.room, elite: entry.stage.elite, level: entry.stage.level, station: 'main' }
  const state = member ? ratingMemberStatus(member, roster) : null
  const owned = combo ? entry.variants.some((variant) => ratingVariantStatus(variant, roster, null).membersOwned) : state !== 'missing'
  // Share the dialog's ID namespace without measuring every other loaded card.
  return <LayoutGroup inherit="id"><motion.article id={`rating-${entry.id}`} className="v2-rating-card" data-owned={roster ? owned : undefined} role="listitem" aria-posinset={position} aria-setsize={total}
    layoutId={reduced ? undefined : `rating-card-${entry.id}`} layoutDependency={active} style={{ borderRadius: 6 }} transition={motionTokens.morph}
    onClick={(event) => onOpen(entry, event.currentTarget)}>
    <button type="button" className="v2-rating-card-trigger" aria-haspopup="dialog" aria-label={text.openDetails(combo ? entry.title : entry.name)} />
    <RatingIdentity entry={entry} />
    <div className="v2-rating-card-meta">
      {combo ? entry.partnerSlots ? <span>{text.flexiblePartners(entry.partnerSlots)}</span> : entry.variants.length > 1 && <span>{text.variants(entry.variants.length)}</span> : <span>{copy.domain.building_skills.unlock(entry.stage.elite, entry.stage.level)}</span>}
      {roster && <span className="v2-rating-state" data-state={state ?? (owned ? 'ready' : 'missing')}>{combo ? owned ? text.membersOwned : text.membersMissing : text.memberStates[state!]}</span>}
    </div>
  </motion.article></LayoutGroup>
})

export function BuildingRatingDialog({ entry, initialVariant, source, roster, config, profileId, onClose }: {
  entry: BuildingRatingEntry; initialVariant: number; source: HTMLElement | null; roster: RatingRoster | null; config: LicenseConfig | null; profileId?: string; onClose: () => void
}) {
  const [variantIndex, setVariantIndex] = useState(initialVariant)
  const combo = 'variants' in entry
  return <SharedCardDialog layoutId={`rating-card-${entry.id}`} source={source} onClose={onClose} closeLabel={copy.v2.close} className="v2-rating-dialog">
    <header className="v2-rating-dialog-heading"><RatingIdentity entry={entry} detail variant={combo ? entry.variants[variantIndex] : undefined} />
      <DialogDescription className="v2-rating-dialog-description">{ROOM_LABELS[entry.room] ?? entry.room}{combo ? entry.partnerSlots ? ` · ${text.corePartners}` : entry.variants.length > 1 && ` · ${text.variants(entry.variants.length)}` : ` · ${text.minimum} · ${copy.domain.building_skills.unlock(entry.stage.elite, entry.stage.level)}`}</DialogDescription>
    </header>
    {combo ? <div className="v2-rating-dialog-body">
      <BuildingRatingVariantPicker combo={entry} index={variantIndex} onChange={setVariantIndex} roster={roster} />
      <RatingVariantDetails variant={entry.variants[variantIndex]} index={!entry.partnerSlots && entry.variants.length > 1 ? variantIndex : undefined} roster={roster} config={config} />
    </div> : <RatingStageDetails stages={entry.stages} member={{ id: entry.operatorId, room: entry.room, elite: entry.stage.elite, level: entry.stage.level, station: 'main' }} profileId={profileId} />}
  </SharedCardDialog>
}
