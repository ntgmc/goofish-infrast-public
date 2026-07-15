import { useMemo, useState } from 'react'
import type { ScenarioComparisonPoint } from '../../../../lib/scenario-comparison'
import { copy, CURRENT_LOCALE } from '../../../../copy/index'


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
    ? `${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_001}${frontier.length}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_002}${frontier[0].operationsPerDay}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_003}${frontier[frontier.length - 1]?.operationsPerDay ?? frontier[0].operationsPerDay}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_004}`
    : copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_005

  const x = (operations: number) => PADDING.left + ((operations - 2) / 2) * (WIDTH - PADDING.left - PADDING.right)
  const y = (output: number) => PADDING.top + (1 - (output - yMin) / Math.max(1, yMax - yMin)) * (HEIGHT - PADDING.top - PADDING.bottom)
  const frontierPath = frontier.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.operationsPerDay)} ${y(metric(point)!.productionSanityPerDay)}`).join(' ')

  return (
    <div>
      <svg className="h-auto w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="scenario-chart-title scenario-chart-desc">
        <title id="scenario-chart-title">{copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_006}</title>
        <desc id="scenario-chart-desc">{summary} {copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_007}</desc>
        {[2, 3, 4].map((value) => (
          <g key={value}>
            <line x1={x(value)} x2={x(value)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="var(--color-surface-3)" strokeWidth="1" />
            <text x={x(value)} y={HEIGHT - 24} textAnchor="middle" fill="var(--color-ink-muted)" fontSize="12">{value} {copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_008}</text>
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
        <text x={(PADDING.left + WIDTH - PADDING.right) / 2} y={HEIGHT - 5} textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="12">{copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_009}</text>
        <text transform={`translate(17 ${(PADDING.top + HEIGHT - PADDING.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="12">{copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_010}</text>
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
              aria-label={`${point.label}，${format(value.productionSanityPerDay)}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_011}${point.operationsPerDay}${copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_012}${point.isFrontier ? copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_013 : ''}`}
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
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted" aria-label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_014}>
        <LegendMark shape="circle" className="bg-surface-4" label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_015} />
        <LegendMark shape="circle" className="bg-brand-300" label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_016} />
        <LegendMark shape="circle" className="bg-brand-500" label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_017} />
        <LegendMark shape="square" className="bg-surface-4" label={copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_018} />
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-ink-muted" />{copy.optimize.pages_tool_optimize_scenario_lab_ScenarioParetoChart_019}</span>
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
  return value.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 1 })
}
