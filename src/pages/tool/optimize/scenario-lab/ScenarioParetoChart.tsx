import { useMemo, useState } from 'react'
import type { ScenarioComparisonPoint } from '../../../../lib/scenario-comparison'

const WIDTH = 720
const HEIGHT = 320
const PADDING = { left: 70, right: 30, top: 30, bottom: 52 }

export default function ScenarioParetoChart({
  points,
  selectedId,
  onSelect,
}: {
  points: ScenarioComparisonPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const successful = useMemo(() => points.filter((point) => metric(point)), [points])
  const outputs = successful.map((point) => metric(point)!.productionSanityPerDay)
  const minOutput = outputs.length ? Math.min(...outputs) : 0
  const maxOutput = outputs.length ? Math.max(...outputs) : 1
  const outputPadding = Math.max(1, (maxOutput - minOutput) * 0.12)
  const yMin = Math.max(0, minOutput - outputPadding)
  const yMax = maxOutput + outputPadding
  const frontier = successful.filter((point) => point.isFrontier).sort((a, b) => a.operationsPerDay - b.operationsPerDay)
  const summary = frontier.length > 0
    ? `已验证前沿包含 ${frontier.length} 个场景，操作成本从 ${frontier[0].operationsPerDay} 次到 ${frontier[frontier.length - 1]?.operationsPerDay ?? frontier[0].operationsPerDay} 次每日换班。`
    : '当前没有形成已验证 Pareto 前沿。'

  const x = (operations: number) => PADDING.left + ((operations - 2) / 2) * (WIDTH - PADDING.left - PADDING.right)
  const y = (output: number) => PADDING.top + (1 - (output - yMin) / Math.max(1, yMax - yMin)) * (HEIGHT - PADDING.top - PADDING.bottom)
  const frontierPath = frontier.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.operationsPerDay)} ${y(metric(point)!.productionSanityPerDay)}`).join(' ')

  return (
    <div>
      <svg className="h-auto w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="scenario-chart-title scenario-chart-desc">
        <title id="scenario-chart-title">产量与每日换班次数 Pareto 图</title>
        <desc id="scenario-chart-desc">{summary} 横轴越靠左操作越少，纵轴越靠上等效理智产量越高。</desc>
        {[2, 3, 4].map((value) => (
          <g key={value}>
            <line x1={x(value)} x2={x(value)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="var(--color-surface-3)" strokeWidth="1" />
            <text x={x(value)} y={HEIGHT - 24} textAnchor="middle" fill="var(--color-ink-muted)" fontSize="12">{value} 次</text>
          </g>
        ))}
        {[0, 0.5, 1].map((ratio) => {
          const value = yMin + (yMax - yMin) * ratio
          return (
            <g key={ratio}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(value)} y2={y(value)} stroke="var(--color-surface-3)" strokeWidth="1" />
              <text x={PADDING.left - 10} y={y(value) + 4} textAnchor="end" fill="var(--color-ink-muted)" fontSize="12">{format(value)}</text>
            </g>
          )
        })}
        <text x={(PADDING.left + WIDTH - PADDING.right) / 2} y={HEIGHT - 5} textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="12">每日换班次数（越少越好）</text>
        <text transform={`translate(17 ${(PADDING.top + HEIGHT - PADDING.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="12">等效理智/日（越高越好）</text>
        {frontierPath && <path d={frontierPath} fill="none" stroke="var(--color-brand-400)" strokeWidth="2.5" />}
        {successful.map((point) => {
          const value = metric(point)!
          const px = x(point.operationsPerDay)
          const py = y(value.productionSanityPerDay)
          const selected = point.id === selectedId
          const focused = point.id === focusedId
          const fill = point.isFrontier ? 'var(--color-brand-500)' : point.verified ? 'var(--color-brand-300)' : 'var(--color-surface-4)'
          return (
            <g
              key={point.id}
              role="button"
              tabIndex={0}
              aria-label={`${point.label}，${format(value.productionSanityPerDay)} 等效理智每日，${point.operationsPerDay} 次换班${point.isFrontier ? '，已验证前沿' : ''}`}
              className="cursor-pointer focus:outline-none"
              onClick={() => onSelect(point.id)}
              onFocus={() => setFocusedId(point.id)}
              onBlur={() => setFocusedId(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(point.id)
                }
              }}
            >
              {(selected || focused) && <circle cx={px} cy={py} r="11" fill="none" stroke="var(--color-warning)" strokeWidth="2" />}
              {point.scheduleMode === 'rotation'
                ? <rect x={px - 5} y={py - 5} width="10" height="10" rx="1" fill={fill} stroke="var(--color-surface-0)" strokeWidth="1.5" />
                : <circle
                    cx={px}
                    cy={py}
                    r="6"
                    fill={fill}
                    stroke="var(--color-surface-0)"
                    strokeWidth="1.5"
                    strokeDasharray={point.scheduleStrategy === 'variable' ? '2 2' : undefined}
                  />}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted" aria-label="图例">
        <LegendMark shape="circle" className="bg-surface-4" label="MAA 快速筛选" />
        <LegendMark shape="circle" className="bg-brand-300" label="精确复核" />
        <LegendMark shape="circle" className="bg-brand-500" label="已验证前沿" />
        <LegendMark shape="square" className="bg-surface-4" label="游戏内轮换" />
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-ink-muted" />自动非固定</span>
      </div>
    </div>
  )
}

function LegendMark({ shape, className, label }: { shape: 'circle' | 'square'; className: string; label: string }) {
  return <span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 ${shape === 'circle' ? 'rounded-full' : 'rounded-sm'} ${className}`} />{label}</span>
}

function metric(point: ScenarioComparisonPoint) {
  return point.verified ?? point.screening
}

function format(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}
