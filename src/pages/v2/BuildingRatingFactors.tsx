import { useId } from 'react'
import { copy } from '../../copy'
import type { RatingFactor, RatingFactorId } from '../../lib/building-rating-factors'

const text = copy.buildingRatings.factors
type RatingFactorSeries = { id: string; label: string; factors: RatingFactor[] }

export default function BuildingRatingFactors({ room, series, current = series.length - 1 }: { room: string; series: RatingFactorSeries[]; current?: number }) {
  const caption = useId()
  const profiles = series.map((item, index) => ({ ...item, index }))
  const axes = series[0].factors.map((factor) => factor.id)
  const limit = Math.max(5, ...series.flatMap((item) => item.factors.map((factor) => factor.score ?? 0)))
  const label = (id: RatingFactorId) => id === 'efficiency' ? text.efficiency[room] ?? text.labels.efficiency : id === 'coverage' ? text.coverage[room] ?? text.labels.coverage : text.labels[id]
  return <div className="v2-rating-factors">
    <h3>{text.title}</h3>
    {series.length > 1 && <ul className="v2-factor-legend" aria-label={text.stages}>{profiles.map((item) => <li key={item.id} data-series={item.index} data-current={item.index === current}>
      <span className="v2-factor-swatch" aria-hidden="true" />{item.label}{item.index === current && <small>{text.current}</small>}
    </li>)}</ul>}
    <figure>
      <svg viewBox="0 0 320 280" role="img" aria-label={text.chart} aria-describedby={caption}>
        {[1, 2, 3, 4, 5].map((tick) => <g key={tick} className="v2-factor-grid"><polygon points={axes.map((_, index) => point(index, tick, limit).join(',')).join(' ')} />{(limit === 5 || tick === 5) && <text x="164" y={145 - 85 * tick / limit + 3}>{tick}</text>}</g>)}
        {axes.map((id, index) => {
          const [x, y] = point(index, limit, limit)
          const [labelX, labelY] = position(index, 108)
          return <g className="v2-factor-axis" key={id}><line x1="160" y1="145" x2={x} y2={y} /><text x={labelX} y={labelY} dominantBaseline="middle" textAnchor={labelX < 130 ? 'end' : labelX > 190 ? 'start' : 'middle'}>{label(id)}</text></g>
        })}
        {profiles.map((item) => {
          const points = item.factors.map((factor, index) => factor.score === null ? null : point(index, factor.score, limit))
          return <g key={item.id} className="v2-factor-series" data-series={item.index} data-current={item.index === current}>
            {points.every((value) => value !== null) ? <polygon points={points.map((value) => value!.join(',')).join(' ')} /> : points.map((value, index) => {
              const next = points[(index + 1) % points.length]
              return value && next && <line key={index} x1={value[0]} y1={value[1]} x2={next[0]} y2={next[1]} />
            })}
            {points.map((value, index) => value && <g key={index}><circle cx={value[0]} cy={value[1]} r={item.index === current ? 3.5 : 2.5} />{item.factors[index].score! > 5 && <text x={value[0] + 7} y={value[1] - 7}>{item.factors[index].score}</text>}</g>)}
          </g>
        })}
      </svg>
      <figcaption id={caption}>{text.help} {text.summary}</figcaption>
    </figure>
    <details className="v2-disclosure v2-factor-evidence"><summary>{text.table}</summary>
      <table className="v2-factor-table"><caption className="sr-only">{text.table}</caption><thead><tr><th scope="col">{text.factor}</th>{profiles.map((item) => <th scope="col" key={item.id}>{item.label}</th>)}</tr></thead>
        <tbody>{axes.map((id, index) => <tr key={id}><th scope="row">{label(id)}</th>{profiles.map((item) => <td key={item.id} data-current={item.index === current}>{item.factors[index].score === null ? text.unknown : text.level(item.factors[index].score!)}</td>)}</tr>)}</tbody>
      </table>
      {profiles.map((item) => <div key={item.id}>
        <h4>{item.label}</h4><dl>{item.factors.map((factor) => <div key={factor.id}><dt>{label(factor.id)}</dt><dd>{measurement(factor)}{factor.conditional && ` · ${text.conditional}`}<p>{text.basis[factor.basis]}</p>{factor.scenes?.map((scene) => <p key={scene}>{text.basis[scene]}</p>)}</dd></div>)}</dl>
      </div>)}
    </details>
  </div>
}

function position(index: number, radius: number) {
  const angle = index * Math.PI * 2 / 5 - Math.PI / 2
  return [160 + Math.cos(angle) * radius, 145 + Math.sin(angle) * radius]
}

function point(index: number, value: number, limit: number) {
  return position(index, value / limit * 85)
}

function measurement(factor: RatingFactor) {
  if (factor.raw === undefined) return factor.score === null ? text.unknown : text.level(factor.score)
  const raw = Number(factor.raw.toFixed(3))
  if (factor.basis === 'hourMood' || factor.basis === 'craftMood') return text.mood(raw, factor.high, factor.basis === 'craftMood')
  if (factor.basis === 'recovery') return text.recovery(raw)
  if (factor.id === 'efficiency') return text.percent(raw)
  return text.count(raw)
}
