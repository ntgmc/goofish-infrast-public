import { useId, useState } from 'react'
import type { OperationsOverview } from '../../../lib/operations-overview'

export default function ActivityTrend({ days }: { days: OperationsOverview['days'] }) {
  const [selectedDate, setSelectedDate] = useState('')
  const titleId = useId()
  const active = days.find((day) => day.date === selectedDate) ?? days[days.length - 1]
  const width = 640, height = 160, left = 52, right = 16, top = 16, bottom = 32
  const max = Math.ceil(Math.max(2, ...days.flatMap((day) => [day.successful_users, day.registered_users])) / 2) * 2
  const x = (index: number) => left + (days.length < 2 ? (width - left - right) / 2 : index / (days.length - 1) * (width - left - right))
  const y = (value: number) => height - bottom - value / max * (height - top - bottom)
  const path = (key: 'successful_users' | 'registered_users') => days.map((day, index) => `${index ? 'L' : 'M'}${x(index)},${y(day[key])}`).join(' ')
  const selectedIndex = days.findIndex((day) => day.date === active?.date)

  return <div className="ops-trend">
    <div className="ops-trend-controls"><div className="ops-legend"><span className="ops-legend-primary">成功排班用户</span><span className="ops-legend-secondary">新注册用户</span></div>
      <label className="ops-day-select"><span>查看日期</span><select className="tool-field" value={active?.date ?? ''} onChange={(event) => setSelectedDate(event.currentTarget.value)}>
        {days.map((day) => <option key={day.date} value={day.date}>{day.date}</option>)}
      </select></label></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
      <title id={titleId}>成功排班用户与新注册用户的每日趋势，单位为人</title>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1={left} y1={y(max * fraction)} x2={width - right} y2={y(max * fraction)} className="ops-chart-grid" />
        <text x={left - 8} y={y(max * fraction) + 4} textAnchor="end">{new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(max * fraction)}</text></g>)}
      <path d={path('registered_users')} className="ops-chart-secondary" />
      <path d={path('successful_users')} className="ops-chart-primary" />
      {active && <g><line x1={x(selectedIndex)} y1={top} x2={x(selectedIndex)} y2={height - bottom} className="ops-chart-marker" />
        <circle cx={x(selectedIndex)} cy={y(active.successful_users)} r="4" className="ops-chart-point" /></g>}
      <text x={left} y={height - 8}>{days[0]?.date.slice(5)}</text><text x={width - right} y={height - 8} textAnchor="end">{days[days.length - 1]?.date.slice(5)}</text>
    </svg>
    {active && <p className="ops-trend-reading" aria-live="polite">{active.date}：<strong>{active.successful_users}</strong> 人成功排班，<strong>{active.registered_users}</strong> 人注册；成功生成 {active.successful_generations} 次，失败 {active.failed_requests} 次。</p>}
    <details className="ops-daily-details"><summary>查看每日记录</summary><div className="ops-table-scroll"><table>
      <caption className="sr-only">每日成功使用、新注册及生成结果</caption><thead><tr><th scope="col">日期</th><th scope="col">成功用户</th><th scope="col">注册用户</th><th scope="col">成功生成</th><th scope="col">生成失败</th></tr></thead>
      <tbody>{days.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.successful_users}</td><td>{day.registered_users}</td><td>{day.successful_generations}</td><td>{day.failed_requests}</td></tr>)}</tbody>
    </table></div></details>
  </div>
}
