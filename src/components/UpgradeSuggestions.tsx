import { useCallback, useMemo, useState } from 'react'
import type {
  UpgradeImpactRoom,
  UpgradePartialOutcome,
  UpgradeSuggestion,
  UpgradeTrainingCost,
  UpgradeTrainingCostBucket,
  UpgradeTrainingMaterial,
} from '../lib/types'
import ScheduleProgress, { type ScheduleProgressState } from './ScheduleProgress'

interface Props {
  suggestions: UpgradeSuggestion[];
  onApply: (selectedIds: string[]) => void;
  loading: boolean;
  progress?: ScheduleProgressState | null;
  error?: string | null;
  onReset: () => void;
  embedded?: boolean;
}

type SortMode = 'payback' | 'gain' | 'stock'

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'payback', label: '最快回本' },
  { id: 'gain', label: '最大收益' },
  { id: 'stock', label: '材料已够' },
]

export default function UpgradeSuggestions({ suggestions, onApply, loading, progress, error, onReset, embedded = false }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('payback')
  const [singleOnly, setSingleOnly] = useState(false)

  const selectedIds = useMemo(() => Array.from(selected), [selected])

  const visibleSuggestions = useMemo(() => {
    return suggestions
      .map((suggestion, index) => ({ suggestion, index, id: suggestion.id || `bundle-${index}` }))
      .filter((item) => !singleOnly || item.suggestion.type === 'single')
      .sort((left, right) => compareSuggestions(left.suggestion, right.suggestion, sortMode, left.index, right.index))
  }, [singleOnly, sortMode, suggestions])

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
    <div className={embedded ? 'space-y-4' : 'space-y-8'}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          {!embedded && (
            <h2 className="mb-2 text-xl font-semibold text-ink-primary">
              练度优化建议
            </h2>
          )}
          <p className="text-sm leading-6 text-ink-secondary">
            建议按缺口理智和每日理智收益估算回本，材料成本来自森空岛养成库存。
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center xl:flex-shrink-0">
          <div className="inline-flex w-full overflow-hidden rounded-lg border border-surface-3 bg-surface-0 p-1 lg:w-auto" role="group" aria-label="建议排序">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSortMode(option.id)}
                className={`min-h-10 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors duration-150 lg:flex-none ${
                  sortMode === option.id
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-surface-3 bg-surface-0 px-3 text-sm font-semibold text-ink-secondary">
            <input
              type="checkbox"
              checked={singleOnly}
              onChange={(event) => setSingleOnly(event.currentTarget.checked)}
              className="h-4 w-4 accent-brand-500"
            />
            只看单人提升
          </label>
          <button
            onClick={() => onApply(selectedIds)}
            disabled={loading || selected.size === 0}
            className="min-h-11 rounded-lg bg-surface-2 px-4 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-muted lg:flex-shrink-0"
          >
            {loading ? (
              <span className="inline-flex items-center gap-3">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                重新计算中
              </span>
            ) : (
              `应用建议 (${selected.size})`
            )}
          </button>
        </div>
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
              className="min-h-10 rounded-lg bg-error px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-error/90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted"
            >
              重试
            </button>
            <button
              type="button"
              onClick={onReset}
              className="min-h-10 rounded-lg bg-surface-2 px-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
            >
              重新选择文件
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visibleSuggestions.map(({ suggestion, id }, displayIndex) => (
          <SuggestionCard
            key={id}
            suggestion={suggestion}
            id={id}
            rank={displayIndex + 1}
            selected={selected.has(id)}
            expanded={expanded.has(id)}
            onToggle={() => toggle(id)}
            onToggleExpanded={() => toggleExpanded(id)}
            embedded={embedded}
          />
        ))}
      </div>

      {visibleSuggestions.length === 0 && (
        <div className={`${embedded ? 'bg-surface-2/60' : 'bg-surface-1'} rounded-lg p-4 text-sm text-ink-secondary`}>
          当前筛选下没有可展示的建议。
        </div>
      )}

      <div className={`${embedded ? 'bg-surface-2/60' : 'bg-surface-1'} rounded-lg p-4 text-sm leading-6 text-ink-secondary`}>
        已选 {selected.size} 项。应用建议后会重新计算并生成新方案，当前方案仍可下载留底。
      </div>
    </div>
  )
}

function SuggestionCard({
  suggestion,
  id,
  rank,
  selected,
  expanded,
  onToggle,
  onToggleExpanded,
  embedded,
}: {
  suggestion: UpgradeSuggestion;
  id: string;
  rank: number;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleExpanded: () => void;
  embedded: boolean;
}) {
  const title = suggestion.name || suggestion.ops?.map((op) => op.name).join(' + ') || '升级建议'
  const cost = suggestion.training_cost
  const stockEnough = isStockEnough(cost)
  const stockLabel = getStockLabel(cost)

  return (
    <article
      className={`
        rounded-lg border transition-colors duration-150
        ${selected ? 'border-brand-500/40 bg-brand-500/10' : `${embedded ? 'border-surface-3 bg-surface-2/60' : 'border-surface-3 bg-surface-1'} hover:border-surface-4`}
      `}
    >
      <div className="grid gap-4 p-4 lg:grid-cols-[auto_1fr] lg:items-start">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-3 h-5 w-5 flex-shrink-0 accent-brand-500"
            aria-label={`选择 ${title}`}
          />
          <OperatorPortraits suggestion={suggestion} />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-surface-0 px-2 py-1 text-xs font-semibold text-ink-muted">#{rank}</span>
                <h3 className="text-base font-semibold text-ink-primary sm:text-lg">{title}</h3>
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${stockEnough ? 'border-success/30 bg-success/10 text-success' : 'border-surface-4 bg-surface-0 text-ink-muted'}`}>
                  {stockLabel}
                </span>
              </div>
              {suggestion.desc && (
                <p className="mt-1 text-sm leading-6 text-ink-secondary">{suggestion.desc}</p>
              )}
              {(suggestion.rooms || suggestion.impact?.summary) && (
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {suggestion.impact?.summary || `影响 ${suggestion.rooms}`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onToggleExpanded}
              className="min-h-10 rounded-lg bg-surface-0 px-3 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary xl:flex-shrink-0"
              aria-expanded={expanded}
            >
              {expanded ? '收起解释' : '查看解释'}
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
    { label: '提升收益', value: `+${formatCostNumber(roi?.efficiency_gain ?? suggestion.gain)}%`, tone: 'brand' as const },
    orundumRoi
      ? { label: '每日合成玉', value: formatSignedAmount(orundumRoi.daily_orundum_gain), tone: 'success' as const }
      : { label: '每日理智收益', value: formatSignedSanity(roi?.daily_sanity_gain), tone: 'success' as const },
    orundumRoi
      ? { label: '机会成本', value: `${formatSignedAmount(orundumRoi.opportunity_cost_delta)} 理智/日`, tone: 'warning' as const }
      : { label: '预计回本', value: formatPayback(roi?.payback_days), tone: 'warning' as const },
    { label: '总需求理智', value: formatSanity(totalSanity), tone: 'default' as const },
    { label: '缺口理智', value: formatSanity(missingSanity), tone: 'default' as const },
    { label: '库存状态', value: getStockLabel(cost), tone: isStockEnough(cost) ? 'success' as const : 'default' as const },
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-h-20 rounded-lg border border-surface-3 bg-surface-0 px-3 py-2">
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
      <div className="rounded-lg border border-surface-3 bg-surface-0/70 px-3 py-2 text-sm leading-6 text-ink-muted">
        {cost?.warnings[0] || '材料成本暂不可用'}
      </div>
    )
  }

  const available = cost.available ?? deriveAvailableBucket(cost)
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <CostColumn title="所需材料" bucket={cost.totals} emptyLabel="无额外需求" />
      <CostColumn title="已有库存" bucket={available} emptyLabel="暂无可覆盖库存" />
      <CostColumn title="缺口材料" bucket={cost.missing} emptyLabel="材料已够" emphasizeMissing />
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
    <div className="rounded-lg border border-surface-3 bg-surface-0 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <p className={`text-xs font-semibold ${emphasizeMissing ? 'text-warning' : 'text-ink-muted'}`}>
          {formatSanity(bucket.equivalent_sanity)}
        </p>
      </div>
      <div className="mt-2 grid gap-1 text-xs text-ink-secondary">
        <span>龙门币 <span className="font-mono text-ink-primary">{formatCostNumber(bucket.cash)}</span></span>
        <span>经验 <span className="font-mono text-ink-primary">{formatCostNumber(bucket.exp)}</span></span>
        <span>材料 <span className="font-mono text-ink-primary">{formatCostNumber(materialTotal)}</span></span>
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
              +{bucket.materials.length - materials.length} 种
            </span>
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
      <div className="rounded-lg border border-surface-3 bg-surface-0 p-3">
        <p className="text-sm font-semibold text-ink-primary">影响房间/组合</p>
        {impactRooms.length > 0 ? (
          <div className="mt-2 space-y-2">
            {impactRooms.slice(0, 6).map((room, index) => (
              <ImpactRoomRow key={`${room.room_name}-${room.rule_description}-${index}`} room={room} />
            ))}
            {impactRooms.length > 6 && (
              <p className="text-xs text-ink-muted">另有 {impactRooms.length - 6} 条影响已折叠到收益估算中。</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            {suggestion.rooms ? `影响 ${suggestion.rooms}` : '暂无结构化影响说明'}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-surface-3 bg-surface-0 p-3">
        <p className="text-sm font-semibold text-ink-primary">组合拆分收益</p>
        {suggestion.type !== 'bundle' ? (
          <p className="mt-2 text-sm leading-6 text-ink-muted">单人提升不需要拆分模拟。</p>
        ) : partials.length > 0 ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs leading-5 text-ink-muted">{summarizePartialOutcomes(partials)}</p>
            {partials.map((outcome) => (
              <PartialOutcomeRow key={outcome.missing_operator.name} outcome={outcome} />
            ))}
            {suggestion.partial_outcomes_truncated && (
              <p className="text-xs text-warning">{suggestion.partial_outcomes_unavailable_reason || '组合拆分模拟未完全完成。'}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-ink-muted">该组合暂无拆分模拟结果。</p>
        )}
      </div>
    </div>
  )
}

function ImpactRoomRow({ room }: { room: UpgradeImpactRoom }) {
  const operators = room.operators.join(' + ') || '-'
  const missing = room.missing_operators.join(' + ') || '-'
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink-primary">{room.room_name || room.room_type}</p>
        <p className="text-xs font-semibold text-brand-300">+{formatCostNumber(room.estimated_gain)}%</p>
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">
        {room.product || '全局'} · {room.rule_description || '目标组合'}
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">组合 {operators}；缺口 {missing}</p>
    </div>
  )
}

function PartialOutcomeRow({ outcome }: { outcome: UpgradePartialOutcome }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink-primary">缺 {outcome.missing_operator.name}</p>
        <p className={`text-xs font-semibold ${outcome.has_benefit ? 'text-success' : 'text-ink-muted'}`}>
          {outcome.has_benefit ? '仍有收益' : '无明显收益'}
        </p>
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">
        剩余 {outcome.remaining_ops.map((op) => op.name).join(' + ') || '-'} · +{formatCostNumber(outcome.efficiency_gain)}% · {formatSignedSanity(outcome.daily_sanity_gain)}
      </p>
      {outcome.rooms && <p className="mt-1 text-xs text-ink-muted">影响 {outcome.rooms}</p>}
    </div>
  )
}

function compareSuggestions(left: UpgradeSuggestion, right: UpgradeSuggestion, mode: SortMode, leftIndex: number, rightIndex: number): number {
  if (mode === 'gain') {
    return compareNullableDesc(primaryDailyGain(left), primaryDailyGain(right))
      || right.gain - left.gain
      || leftIndex - rightIndex
  }
  if (mode === 'stock') {
    return Number(isStockEnough(right.training_cost)) - Number(isStockEnough(left.training_cost))
      || compareNullableAsc(left.training_cost?.missing.equivalent_sanity, right.training_cost?.missing.equivalent_sanity)
    || compareNullableAsc(left.roi?.payback_days, right.roi?.payback_days)
    || right.gain - left.gain
      || leftIndex - rightIndex
  }
  return compareNullableAsc(left.roi?.payback_days, right.roi?.payback_days)
    || compareNullableDesc(primaryDailyGain(left), primaryDailyGain(right))
    || right.gain - left.gain
    || leftIndex - rightIndex
}

function primaryDailyGain(suggestion: UpgradeSuggestion): number | null | undefined {
  return suggestion.orundum_roi?.daily_orundum_gain ?? suggestion.roi?.daily_sanity_gain
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
  if (!cost || cost.status === 'unavailable') return false
  return cost.missing.cash === 0 && cost.missing.exp === 0 && cost.missing.materials.length === 0
}

function getStockLabel(cost?: UpgradeTrainingCost): string {
  if (!cost || cost.status === 'unavailable') return '库存不可读'
  return isStockEnough(cost) ? '材料已够' : '仍有缺口'
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
  if (outcomes.every((outcome) => outcome.has_benefit)) return '缺任意一个成员时仍有收益，但收益会下降。'
  if (outcomes.some((outcome) => outcome.has_benefit)) return '部分成员缺席时仍有收益，具体见下方拆分。'
  return '缺少任意成员后都没有明显收益。'
}

function formatPayback(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂不可算'
  if (value === 0) return '0 天'
  return `约 ${formatCostNumber(value)} 天`
}

function formatSignedSanity(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂不可算'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatCostNumber(value)} 理智/日`
}

function formatSignedAmount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂不可算'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatCostNumber(value)}`
}

function formatSanity(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂不可算'
  return `${formatCostNumber(value)} 理智`
}

function formatCostNumber(value: number): string {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('zh-CN')
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}
