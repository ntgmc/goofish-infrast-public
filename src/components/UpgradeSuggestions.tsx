import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  UpgradeImpactRoom,
  UpgradePartialOutcome,
  UpgradeSuggestion,
  UpgradeTrainingCost,
  UpgradeTrainingCostBucket,
  UpgradeTrainingMaterial,
} from '../lib/types'
import { getUpgradeSuggestionId } from '../lib/upgrade-suggestion-id'
import ScheduleProgress, { type ScheduleProgressState } from './ScheduleProgress'
import { copy, CURRENT_LOCALE } from '../copy/index'


interface Props {
  suggestions: UpgradeSuggestion[];
  onApply: (selectedIds: string[]) => void;
  loading: boolean;
  progress?: ScheduleProgressState | null;
  error?: string | null;
  onReset: () => void;
  embedded?: boolean;
  readOnly?: boolean;
}

type SortMode = 'payback' | 'gain' | 'stock'

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'payback', label: copy.optimize.components_UpgradeSuggestions_001 },
  { id: 'gain', label: copy.optimize.components_UpgradeSuggestions_002 },
  { id: 'stock', label: copy.optimize.components_UpgradeSuggestions_003 },
]

export default function UpgradeSuggestions({ suggestions, onApply, loading, progress, error, onReset, embedded = false, readOnly = false }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('payback')
  const [singleOnly, setSingleOnly] = useState(false)

  const visibleSuggestions = useMemo(() => {
    return suggestions
      .map((suggestion, index) => ({ suggestion, index, id: getUpgradeSuggestionId(suggestion, index) }))
      .filter((item) => !singleOnly || item.suggestion.type === 'single')
      .sort((left, right) => compareSuggestions(left.suggestion, right.suggestion, sortMode, left.index, right.index))
  }, [singleOnly, sortMode, suggestions])
  const visibleIdSet = useMemo(() => new Set(visibleSuggestions.map((item) => item.id)), [visibleSuggestions])
  const selectedIds = useMemo(
    () => Array.from(selected).filter((id) => visibleIdSet.has(id)),
    [selected, visibleIdSet],
  )

  useEffect(() => {
    const prune = (current: Set<string>) => {
      const next = new Set(Array.from(current).filter((id) => visibleIdSet.has(id)))
      return next.size === current.size ? current : next
    }
    setSelected(prune)
    setExpanded(prune)
  }, [visibleIdSet])

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className={embedded ? 'space-y-4' : 'tool-panel space-y-6 p-5 sm:p-6'}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          {!embedded && (
            <h2 className="mb-2 text-xl font-semibold text-ink-primary">
              {copy.optimize.components_UpgradeSuggestions_004}</h2>
          )}
          <p className="text-sm leading-6 text-ink-secondary">
            {copy.optimize.components_UpgradeSuggestions_005}</p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center xl:flex-shrink-0">
          <div className="tool-inset inline-flex w-full overflow-hidden p-1 lg:w-auto" role="group" aria-label={copy.optimize.components_UpgradeSuggestions_006}>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSortMode(option.id)}
                aria-pressed={sortMode === option.id}
                className={`tool-secondary-action min-h-11 flex-1 whitespace-nowrap px-3 text-sm lg:flex-none ${
                  sortMode === option.id
                    ? 'tool-option-selected'
                    : 'border-transparent bg-transparent text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="tool-inset inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-ink-secondary">
            <input
              type="checkbox"
              checked={singleOnly}
              onChange={(event) => setSingleOnly(event.currentTarget.checked)}
              className="h-4 w-4 accent-brand-500"
            />
            {copy.optimize.components_UpgradeSuggestions_007}</label>
          {!readOnly && (
            <button
              onClick={() => onApply(selectedIds)}
              disabled={loading || selectedIds.length === 0}
              aria-describedby="upgrade-selection-note"
              className="tool-primary-action lg:flex-shrink-0"
            >
              {loading ? (
                <span className="inline-flex items-center gap-3">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {copy.optimize.components_UpgradeSuggestions_008}</span>
              ) : (
                `${copy.optimize.components_UpgradeSuggestions_009}${selectedIds.length})`
              )}
            </button>
          )}
        </div>
      </div>

      {progress && (loading || progress.estimatePhase === 'cancelled') && (
        <ScheduleProgress progress={progress} />
      )}

      {error && (
        <div className="tool-alert tool-alert--error" role="alert">
          <p className="text-sm font-semibold text-error">{copy.optimize.components_UpgradeSuggestions_010}</p>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onApply(selectedIds)}
              disabled={loading || selectedIds.length === 0}
              className="tool-primary-action"
            >
              {copy.optimize.components_UpgradeSuggestions_011}</button>
            <button
              type="button"
              onClick={onReset}
              className="tool-secondary-action"
            >
              {copy.optimize.components_UpgradeSuggestions_012}</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visibleSuggestions.map(({ suggestion, id }, displayIndex) => (
          <SuggestionCard
            key={id}
            suggestion={suggestion}
            rank={displayIndex + 1}
            selected={selected.has(id)}
            expanded={expanded.has(id)}
            onToggle={() => toggle(id)}
            onToggleExpanded={() => toggleExpanded(id)}
            embedded={embedded}
            selectable={!readOnly}
          />
        ))}
      </div>

      {visibleSuggestions.length === 0 && (
        <div className="tool-inset p-4 text-sm text-ink-secondary">
          {copy.optimize.components_UpgradeSuggestions_013}</div>
      )}

      {!readOnly && (
        <div id="upgrade-selection-note" className="tool-inset p-4 text-sm leading-6 text-ink-secondary" role="status" aria-live="polite">
          {selectedIds.length === 0
            ? copy.optimize.components_UpgradeSuggestions_014
            : `${copy.optimize.components_UpgradeSuggestions_015}${selectedIds.length}${copy.optimize.components_UpgradeSuggestions_016}`}
        </div>
      )}
    </div>
  )
}

function SuggestionCard({
  suggestion,
  rank,
  selected,
  expanded,
  onToggle,
  onToggleExpanded,
  embedded,
  selectable,
}: {
  suggestion: UpgradeSuggestion;
  rank: number;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleExpanded: () => void;
  embedded: boolean;
  selectable: boolean;
}) {
  const title = suggestion.name || suggestion.ops?.map((op) => op.name).join(' + ') || copy.optimize.components_UpgradeSuggestions_017
  const cost = suggestion.training_cost
  const stockEnough = isStockEnough(cost)
  const stockLabel = getStockLabel(cost)

  return (
    <article className={`tool-panel transition-colors duration-150 ${selected ? 'border-brand-500/40 bg-brand-500/10' : `${embedded ? 'bg-surface-2/60' : ''} hover:border-surface-4`}`}>
      <div className="grid gap-4 p-4 lg:grid-cols-[auto_1fr] lg:items-start">
        <div className="flex items-start gap-3">
          {selectable && (
            <label className="mt-1 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-surface-0">
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggle}
                className="h-5 w-5 accent-brand-500"
                aria-label={`${copy.optimize.components_UpgradeSuggestions_018}${title}`}
              />
              <span className="sr-only">{copy.optimize.components_UpgradeSuggestions_019}{title}</span>
            </label>
          )}
          <OperatorPortraits suggestion={suggestion} />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tool-status">#{rank}</span>
                <h3 className="text-base font-semibold text-ink-primary sm:text-lg">{title}</h3>
                <span className={`tool-status ${stockEnough ? 'tool-status--success' : ''}`}>
                  {stockLabel}
                </span>
              </div>
              {suggestion.desc && (
                <p className="mt-1 text-sm leading-6 text-ink-secondary">{suggestion.desc}</p>
              )}
              {(suggestion.rooms || suggestion.impact?.summary) && (
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {suggestion.impact?.summary || `${copy.optimize.components_UpgradeSuggestions_020}${suggestion.rooms}`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onToggleExpanded}
              className="tool-secondary-action px-3 text-sm xl:flex-shrink-0"
              aria-expanded={expanded}
            >
              {expanded ? copy.optimize.components_UpgradeSuggestions_021 : copy.optimize.components_UpgradeSuggestions_022}
            </button>
          </div>

          <MetricGrid suggestion={suggestion} cost={cost} />

          {expanded && (
            <div className="space-y-3 border-t border-surface-3 pt-4">
              <TrainingCostPanel cost={cost} />
              <ImpactPanel suggestion={suggestion} />
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function OperatorPortraits({ suggestion }: { suggestion: UpgradeSuggestion }) {
  if (suggestion.type === 'single' && suggestion.id) {
    return (
      <img
        src={`/webp96/${suggestion.id}.webp`}
        alt=""
        className="h-12 w-12 rounded-lg bg-surface-2 object-cover"
        width={48}
        height={48}
        loading="lazy"
        decoding="async"
        onError={(event) => (event.currentTarget.style.display = 'none')}
      />
    )
  }
  if (suggestion.type === 'bundle' && suggestion.ops) {
    return (
      <div className="flex -space-x-2">
        {suggestion.ops.slice(0, 4).map((op) => (
          <img
            key={op.id || op.name}
            src={`/webp96/${op.id}.webp`}
            alt=""
            className="h-10 w-10 rounded-lg border-2 border-surface-1 bg-surface-2 object-cover"
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            onError={(event) => (event.currentTarget.style.display = 'none')}
          />
        ))}
      </div>
    )
  }
  return <div className="h-12 w-12 rounded-lg bg-surface-2" aria-hidden="true" />
}

function MetricGrid({ suggestion, cost }: { suggestion: UpgradeSuggestion; cost?: UpgradeTrainingCost }) {
  const roi = suggestion.roi
  const orundumRoi = suggestion.orundum_roi
  const totalSanity = cost?.totals.equivalent_sanity ?? cost?.equivalent_sanity ?? null
  const missingSanity = cost?.missing.equivalent_sanity ?? null
  const metrics = [
    { label: copy.optimize.components_UpgradeSuggestions_023, value: formatSignedAmount(roi?.efficiency_gain ?? suggestion.gain), tone: 'brand' as const },
    orundumRoi
      ? { label: copy.optimize.components_UpgradeSuggestions_024, value: formatSignedAmount(orundumRoi.daily_orundum_gain), tone: 'success' as const }
      : { label: copy.optimize.components_UpgradeSuggestions_025, value: formatSignedSanity(roi?.daily_sanity_gain), tone: 'success' as const },
    orundumRoi
      ? { label: copy.optimize.components_UpgradeSuggestions_026, value: `${formatSignedAmount(orundumRoi.opportunity_cost_delta)}${copy.optimize.components_UpgradeSuggestions_027}`, tone: 'warning' as const }
      : { label: copy.optimize.components_UpgradeSuggestions_028, value: formatPayback(roi?.payback_days), tone: 'warning' as const },
    { label: copy.optimize.components_UpgradeSuggestions_029, value: formatSanity(totalSanity), tone: 'default' as const },
    { label: copy.optimize.components_UpgradeSuggestions_030, value: formatSanity(missingSanity), tone: 'default' as const },
    { label: copy.optimize.components_UpgradeSuggestions_031, value: getStockLabel(cost), tone: isStockEnough(cost) ? 'success' as const : 'default' as const },
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.label} className="tool-inset min-h-20 px-3 py-2">
          <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
          <p className={`mt-1 break-words text-sm font-semibold ${metricToneClass(metric.tone)}`}>{metric.value}</p>
        </div>
      ))}
    </div>
  )
}

function TrainingCostPanel({ cost }: { cost?: UpgradeTrainingCost }) {
  if (!cost || cost.status === 'unavailable') {
    return (
      <div className="tool-inset space-y-2 px-3 py-2 text-sm leading-6 text-ink-muted">
        {(cost?.warnings.length ? cost.warnings : [copy.optimize.components_UpgradeSuggestions_032]).map((warning, index) => (
          <p key={`${index}:${warning}`}>{warning}</p>
        ))}
      </div>
    )
  }

  const available = cost.available ?? deriveAvailableBucket(cost)
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <CostColumn title={copy.optimize.components_UpgradeSuggestions_033} bucket={cost.totals} emptyLabel={copy.optimize.components_UpgradeSuggestions_034} />
        <CostColumn title={copy.optimize.components_UpgradeSuggestions_035} bucket={available} emptyLabel={copy.optimize.components_UpgradeSuggestions_036} />
        <CostColumn title={copy.optimize.components_UpgradeSuggestions_037} bucket={cost.missing} emptyLabel={copy.optimize.components_UpgradeSuggestions_038} emphasizeMissing />
      </div>
      {(cost.status === 'partial' || cost.warnings.length > 0 || cost.unpriced_items.length > 0) && (
        <div className="tool-alert tool-alert--warning space-y-2 text-sm leading-6" role="status">
          {cost.status === 'partial' && <p>{copy.optimize.components_UpgradeSuggestions_076}</p>}
          {cost.warnings.map((warning, index) => <p key={`${index}:${warning}`}>{warning}</p>)}
          {cost.unpriced_items.length > 0 && (
            <p>{copy.optimize.components_UpgradeSuggestions_077}{cost.unpriced_items.map((item) => item.name).join('、')}</p>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted">
        {copy.optimize.components_UpgradeSuggestions_078}{formatPricingSource(cost)}
      </p>
    </div>
  )
}

function CostColumn({
  title,
  bucket,
  emptyLabel,
  emphasizeMissing = false,
}: {
  title: string;
  bucket: UpgradeTrainingCostBucket;
  emptyLabel: string;
  emphasizeMissing?: boolean;
}) {
  const materials = topMaterials(bucket.materials)
  const materialTotal = bucket.materials.reduce((sum, item) => sum + item.count, 0)
  const isEmpty = bucket.cash === 0 && bucket.exp === 0 && materialTotal === 0

  return (
    <div className="tool-inset p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <p className={`text-xs font-semibold ${emphasizeMissing ? 'text-warning' : 'text-ink-muted'}`}>
          {formatSanity(bucket.equivalent_sanity)}
        </p>
      </div>
      <div className="mt-2 grid gap-1 text-xs text-ink-secondary">
        <span>{copy.optimize.components_UpgradeSuggestions_039}<span className="font-mono text-ink-primary">{formatCostNumber(bucket.cash)}</span></span>
        <span>{copy.optimize.components_UpgradeSuggestions_040}<span className="font-mono text-ink-primary">{formatCostNumber(bucket.exp)}</span></span>
        <span>{copy.optimize.components_UpgradeSuggestions_041}<span className="font-mono text-ink-primary">{formatCostNumber(materialTotal)}</span></span>
      </div>
      {isEmpty ? (
        <p className="mt-2 text-xs text-ink-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {materials.map((item) => (
            <span key={item.id} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-secondary">
              {item.name} x{formatCostNumber(item.count)}
            </span>
          ))}
          {bucket.materials.length > materials.length && (
            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-muted">
              +{bucket.materials.length - materials.length} {copy.optimize.components_UpgradeSuggestions_042}</span>
          )}
        </div>
      )}
    </div>
  )
}

function ImpactPanel({ suggestion }: { suggestion: UpgradeSuggestion }) {
  const impactRooms = suggestion.impact?.rooms ?? []
  const partials = suggestion.partial_outcomes ?? []
  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_0.95fr]">
      <div className="tool-inset p-3">
        <p className="text-sm font-semibold text-ink-primary">{copy.optimize.components_UpgradeSuggestions_043}</p>
        {impactRooms.length > 0 ? (
          <div className="mt-2 space-y-2">
            {impactRooms.slice(0, 6).map((room, index) => (
              <ImpactRoomRow key={`${room.room_name}-${room.rule_description}-${index}`} room={room} />
            ))}
            {impactRooms.length > 6 && (
              <p className="text-xs text-ink-muted">{copy.optimize.components_UpgradeSuggestions_044}{impactRooms.length - 6} {copy.optimize.components_UpgradeSuggestions_045}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            {suggestion.rooms ? `${copy.optimize.components_UpgradeSuggestions_046}${suggestion.rooms}` : copy.optimize.components_UpgradeSuggestions_047}
          </p>
        )}
      </div>

      <div className="tool-inset p-3">
        <p className="text-sm font-semibold text-ink-primary">{copy.optimize.components_UpgradeSuggestions_048}</p>
        {suggestion.type !== 'bundle' ? (
          <p className="mt-2 text-sm leading-6 text-ink-muted">{copy.optimize.components_UpgradeSuggestions_049}</p>
        ) : partials.length > 0 ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs leading-5 text-ink-muted">{summarizePartialOutcomes(partials)}</p>
            {partials.map((outcome) => (
              <PartialOutcomeRow key={outcome.missing_operator.name} outcome={outcome} />
            ))}
            {suggestion.partial_outcomes_truncated && (
              <p className="text-xs text-warning">{suggestion.partial_outcomes_unavailable_reason || copy.optimize.components_UpgradeSuggestions_050}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-ink-muted">{copy.optimize.components_UpgradeSuggestions_051}</p>
        )}
      </div>
    </div>
  )
}

function ImpactRoomRow({ room }: { room: UpgradeImpactRoom }) {
  const operators = room.operators.join(' + ') || '-'
  const missing = room.missing_operators.join(' + ') || '-'
  return (
    <div className="tool-inset px-3 py-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink-primary">{room.room_name || room.room_type}</p>
        <p className="text-xs font-semibold text-brand-300">+{formatCostNumber(room.estimated_gain)}%</p>
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">
        {room.product || copy.optimize.components_UpgradeSuggestions_052} · {room.rule_description || copy.optimize.components_UpgradeSuggestions_053}
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">{copy.optimize.components_UpgradeSuggestions_054}{operators}{copy.optimize.components_UpgradeSuggestions_055}{missing}</p>
    </div>
  )
}

function PartialOutcomeRow({ outcome }: { outcome: UpgradePartialOutcome }) {
  return (
    <div className="tool-inset px-3 py-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink-primary">{copy.optimize.components_UpgradeSuggestions_056}{outcome.missing_operator.name}</p>
        <p className={`text-xs font-semibold ${outcome.has_benefit ? 'text-success' : 'text-ink-muted'}`}>
          {outcome.has_benefit ? copy.optimize.components_UpgradeSuggestions_057 : copy.optimize.components_UpgradeSuggestions_058}
        </p>
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">
        {copy.optimize.components_UpgradeSuggestions_059}{outcome.remaining_ops.map((op) => op.name).join(' + ') || '-'} · +{formatCostNumber(outcome.efficiency_gain)}% · {formatSignedSanity(outcome.daily_sanity_gain)}
      </p>
      {outcome.rooms && <p className="mt-1 text-xs text-ink-muted">{copy.optimize.components_UpgradeSuggestions_060}{outcome.rooms}</p>}
    </div>
  )
}

function compareSuggestions(left: UpgradeSuggestion, right: UpgradeSuggestion, mode: SortMode, leftIndex: number, rightIndex: number): number {
  if (mode === 'gain') {
    return compareEconomicGain(left, right)
      || leftIndex - rightIndex
  }
  if (mode === 'stock') {
    return Number(isStockEnough(right.training_cost)) - Number(isStockEnough(left.training_cost))
      || compareNullableAsc(left.training_cost?.missing.equivalent_sanity, right.training_cost?.missing.equivalent_sanity)
      || compareNullableAsc(left.roi?.payback_days, right.roi?.payback_days)
      || leftIndex - rightIndex
  }
  return compareNullableAsc(left.roi?.payback_days, right.roi?.payback_days)
    || compareEconomicGain(left, right)
    || leftIndex - rightIndex
}

function compareEconomicGain(left: UpgradeSuggestion, right: UpgradeSuggestion): number {
  if (left.orundum_roi || right.orundum_roi) {
    return compareNullableDesc(left.orundum_roi?.daily_orundum_gain, right.orundum_roi?.daily_orundum_gain)
      || compareNullableDesc(left.orundum_roi?.sustainable_orundum_gain, right.orundum_roi?.sustainable_orundum_gain)
      || compareNullableDesc(left.orundum_roi?.opportunity_cost_delta, right.orundum_roi?.opportunity_cost_delta)
  }
  return compareNullableDesc(left.roi?.daily_sanity_gain, right.roi?.daily_sanity_gain)
}

function compareNullableAsc(left: number | null | undefined, right: number | null | undefined): number {
  const leftFinite = typeof left === 'number' && Number.isFinite(left)
  const rightFinite = typeof right === 'number' && Number.isFinite(right)
  if (leftFinite && rightFinite) return left - right
  if (leftFinite) return -1
  if (rightFinite) return 1
  return 0
}

function compareNullableDesc(left: number | null | undefined, right: number | null | undefined): number {
  const leftFinite = typeof left === 'number' && Number.isFinite(left)
  const rightFinite = typeof right === 'number' && Number.isFinite(right)
  if (leftFinite && rightFinite) return right - left
  if (leftFinite) return -1
  if (rightFinite) return 1
  return 0
}

function isStockEnough(cost?: UpgradeTrainingCost): boolean {
  if (!cost || cost.status !== 'available' || cost.operators.some((operator) => operator.status !== 'complete')) return false
  return cost.missing.cash === 0 && cost.missing.exp === 0 && cost.missing.materials.length === 0
}

function getStockLabel(cost?: UpgradeTrainingCost): string {
  if (!cost || cost.status === 'unavailable') return copy.optimize.components_UpgradeSuggestions_061
  if (cost.status === 'partial' || cost.operators.some((operator) => operator.status !== 'complete')) {
    return copy.optimize.components_UpgradeSuggestions_079
  }
  return isStockEnough(cost) ? copy.optimize.components_UpgradeSuggestions_062 : copy.optimize.components_UpgradeSuggestions_063
}

function formatPricingSource(cost: UpgradeTrainingCost): string {
  const fetchedAt = cost.sources.pricing_fetched_at
    ? new Date(cost.sources.pricing_fetched_at).toLocaleString(CURRENT_LOCALE)
    : copy.optimize.components_UpgradeSuggestions_080
  const snapshot = cost.sources.pricing_snapshot_id?.slice(0, 12) ?? copy.optimize.components_UpgradeSuggestions_080
  const valuationVersion = cost.sources.valuation_version ?? copy.optimize.components_UpgradeSuggestions_080
  return `${cost.sources.yituliu} · ${fetchedAt} · ${snapshot} · ${valuationVersion}`
}

function metricToneClass(tone: 'brand' | 'success' | 'warning' | 'default'): string {
  if (tone === 'brand') return 'text-brand-300'
  if (tone === 'success') return 'text-success'
  if (tone === 'warning') return 'text-warning'
  return 'text-ink-primary'
}

function deriveAvailableBucket(cost: UpgradeTrainingCost): UpgradeTrainingCostBucket {
  const missingById = new Map(cost.missing.materials.map((item) => [item.id, item.count]))
  const materials = cost.totals.materials
    .map((item) => ({ ...item, count: Math.max(0, item.count - (missingById.get(item.id) ?? 0)) }))
    .filter((item) => item.count > 0)
  const available: UpgradeTrainingCostBucket = {
    cash: Math.max(0, cost.totals.cash - cost.missing.cash),
    exp: Math.max(0, cost.totals.exp - cost.missing.exp),
    materials,
    equivalent_sanity: null,
  }
  return available
}

function topMaterials(materials: UpgradeTrainingMaterial[]): UpgradeTrainingMaterial[] {
  return [...materials]
    .sort((left, right) => (
      (right.equivalent_sanity ?? 0) - (left.equivalent_sanity ?? 0) ||
      right.count - left.count ||
      left.name.localeCompare(right.name)
    ))
    .slice(0, 4)
}

function summarizePartialOutcomes(outcomes: UpgradePartialOutcome[]): string {
  if (outcomes.every((outcome) => outcome.has_benefit)) return copy.optimize.components_UpgradeSuggestions_064
  if (outcomes.some((outcome) => outcome.has_benefit)) return copy.optimize.components_UpgradeSuggestions_065
  return copy.optimize.components_UpgradeSuggestions_066
}

function formatPayback(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return copy.optimize.components_UpgradeSuggestions_067
  if (value === 0) return copy.optimize.components_UpgradeSuggestions_068
  return `${copy.optimize.components_UpgradeSuggestions_069}${formatCostNumber(value)}${copy.optimize.components_UpgradeSuggestions_070}`
}

function formatSignedSanity(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return copy.optimize.components_UpgradeSuggestions_071
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatCostNumber(value)}${copy.optimize.components_UpgradeSuggestions_072}`
}

function formatSignedAmount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return copy.optimize.components_UpgradeSuggestions_073
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatCostNumber(value)}`
}

function formatSanity(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return copy.optimize.components_UpgradeSuggestions_074
  return `${formatCostNumber(value)}${copy.optimize.components_UpgradeSuggestions_075}`
}

function formatCostNumber(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString(CURRENT_LOCALE)
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}
