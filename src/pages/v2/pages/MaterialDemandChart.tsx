import { useId, type KeyboardEvent, type PointerEvent } from 'react'
import { materialDemandCopy as text } from '../../../copy/zh-CN/material-demand'
import { materialDemandChartMax, type MaterialDemandPoint } from '../../../lib/material-demand'

const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)

export default function MaterialDemandChart({ name, points, share, compact = false, narrow = false, sources = false, rawPoints = false, fullScale = false, selected, onSelect }: {
  name: string; points: MaterialDemandPoint[]; share: boolean; compact?: boolean; narrow?: boolean; sources?: boolean; rawPoints?: boolean; fullScale?: boolean
  selected?: number; onSelect?: (index: number) => void
}) {
  const titleId = useId()
  const width = compact ? 340 : narrow ? 360 : 920, height = compact ? 170 : narrow ? 240 : 310
  const left = compact ? 42 : 52, right = 16, top = 16, bottom = 30
  const max = materialDemandChartMax(points, { share, rawPoints, fullScale })
  const clipId = `${titleId}-plot`
  const peaks = points.map((point, index) => ({ point, index, value: Math.max(point.value ?? 0, rawPoints ? point.raw ?? 0 : 0) })).filter(({ value }) => value > max)
  const x = (index: number) => left + index / Math.max(1, points.length - 1) * (width - left - right)
  const y = (value: number) => height - bottom - value / max * (height - top - bottom)
  const path = (key: 'value' | 'operators' | 'modules') => {
    let connected = false
    return points.map((point, index) => {
      const value = point[key]
      if (value === null) { connected = false; return '' }
      const step = `${connected ? 'L' : 'M'}${x(index)},${y(value)}`
      connected = true
      return step
    }).join(' ')
  }
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    if (!onSelect) return
    const rectangle = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - rectangle.left) / rectangle.width * width
    onSelect(Math.max(0, Math.min(points.length - 1, Math.round((position - left) / (width - left - right) * (points.length - 1)))))
  }
  const navigate = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!onSelect) return
    const current = selected ?? points.length - 1
    const next = event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowRight' ? current + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null
    if (next === null) return
    event.preventDefault()
    onSelect(Math.max(0, Math.min(points.length - 1, next)))
  }
  const active = selected === undefined ? undefined : points[selected]
  const tickIndices = compact || narrow ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  return <svg className={`material-demand-chart${compact ? ' material-demand-chart-compact' : ''}`} viewBox={`0 0 ${width} ${height}`}
    role={onSelect ? 'slider' : 'img'} aria-labelledby={titleId} tabIndex={onSelect ? 0 : undefined}
    aria-valuemin={onSelect ? 0 : undefined} aria-valuemax={onSelect ? points.length - 1 : undefined} aria-valuenow={onSelect ? selected ?? points.length - 1 : undefined}
    aria-valuetext={onSelect && active ? `${active.month}，${active.value === null ? text.incompleteWindow : `${number(active.value)}${share ? '%' : ''}`}` : undefined}
    onPointerMove={pick} onPointerDown={pick} onKeyDown={navigate}>
    <title id={titleId}>{text.chartTitle(name)}</title>
    {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1={left} y1={y(max * fraction)} x2={width - right} y2={y(max * fraction)} className="material-demand-grid" />
      <text x={left - 7} y={y(max * fraction) + 4} textAnchor="end">{number(max * fraction)}{share ? '%' : ''}</text></g>)}
    <defs><clipPath id={clipId}><rect x={left - 4} y={top} width={width - left - right + 8} height={height - top - bottom + 4} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
    {rawPoints && points.map((point, index) => point.raw !== null && <circle key={point.month} cx={x(index)} cy={y(point.raw)} r={compact ? 1.6 : 2.3} className="material-demand-raw" />)}
    {sources && <><path d={path('operators')} className="material-demand-line material-demand-operators" /><path d={path('modules')} className="material-demand-line material-demand-modules" /></>}
    <path d={path('value')} className="material-demand-line material-demand-total" />
    {active && selected !== undefined && <g><line x1={x(selected)} y1={top} x2={x(selected)} y2={height - bottom} className="material-demand-marker" />
      {(active.value !== null || rawPoints && active.raw !== null) && <circle cx={x(selected)} cy={y(active.value ?? active.raw!)} r="4" className="material-demand-active" />}</g>}
    </g>
    {peaks.map(({ point, index, value }) => <path key={point.month} d={`M${x(index) - 4},${top + 7} L${x(index)},${top} L${x(index) + 4},${top + 7} Z`} className="material-demand-peak"><title>{text.peakValue(point.month, `${number(value)}${share ? '%' : ''}`)}</title></path>)}
    {tickIndices.map((index, position) => <text key={index} x={x(index)} y={height - 6} textAnchor={position === 0 ? 'start' : position === tickIndices.length - 1 ? 'end' : 'middle'}>{points[index]?.month}</text>)}
  </svg>
}
