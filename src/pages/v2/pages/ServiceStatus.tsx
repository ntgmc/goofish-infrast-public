import { useState, type KeyboardEvent } from 'react'
import { RefreshIcon as RefreshCw } from '../../../components/icons'
import { copy } from '../../../copy'
import { useServiceStatus, createHistoryCells, historyCellLabel, statusLabel, incidentStatusLabel, incidentImpactLabel, formatUpdatedAt } from '../../../hooks/useServiceStatus'
import ServiceStatusBadge from '../../../components/ServiceStatusBadge'
import type { ServiceStatusLevel } from '../../../lib/service-status'
import { DataActivity } from '../components/DataActivity'
import { EmptyState, Notice, SectionTitle } from '../components/WorkspaceUI'
import './service-status.css'

const text = copy.status
const HISTORY_LEVELS = ['available', 'scaling', 'busy', 'congested', 'overloaded', 'unavailable', 'unknown'] as const

export default function ServiceStatus() {
  const m = useServiceStatus()
  const cells = createHistoryCells(m.currentStatus.history)
  const days = Array.from({ length: 7 }, (_, index) => cells.slice(index * 24, (index + 1) * 24))
  const [selectedHour, setSelectedHour] = useState(cells.length - 1)
  const selectedCell = cells[selectedHour]
  const incidents = [...m.currentStatus.incidents.filter((item) => item.status !== 'resolved'), ...m.currentStatus.incidents.filter((item) => item.status === 'resolved').slice(0, 3)]
  const components: { title: string; description: string; level: ServiceStatusLevel | undefined }[] = [
    { title: text.pages_StatusPage_009, description: text.pages_StatusPage_010, level: m.optimizationStatus },
    { title: text.pages_StatusPage_075, description: text.pages_StatusPage_076, level: m.sklandStatus },
  ]

  function navigateHistory(event: KeyboardEvent<HTMLDivElement>) {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 }[event.key]
    let next = selectedHour
    if (offset !== undefined) next += offset
    else if (event.key === 'Home') next = event.ctrlKey ? 0 : Math.floor(selectedHour / 24) * 24
    else if (event.key === 'End') next = event.ctrlKey ? cells.length - 1 : Math.floor(selectedHour / 24) * 24 + 23
    else return
    event.preventDefault()
    next = Math.max(0, Math.min(cells.length - 1, next))
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  return <div className="v2-service-status">
    <section className="v2-service-summary" data-level={m.status?.status ?? 'unknown'} aria-labelledby="v2-service-overall-title">
      <div>
        {m.status ? <ServiceStatusBadge level={m.status.status} /> : <span className="v2-service-unknown">{m.error ? text.pages_StatusPage_071 : text.pages_StatusPage_024}</span>}
        <h2 id="v2-service-overall-title" aria-live="polite" aria-atomic="true">{m.statusMessage}</h2>
        <p>{text.pages_StatusPage_006} · {m.updatedAt} · {text.pages_StatusPage_007}</p>
      </div>
      <button type="button" className="v2-button v2-button-secondary" disabled={m.refreshing} aria-busy={m.refreshing} onClick={() => void m.loadStatus()}>
        <RefreshCw aria-hidden="true" size={16} className={m.refreshing ? 'v2-spin' : undefined} />{m.refreshing ? text.pages_StatusPage_070 : text.pages_StatusPage_069}
      </button>
    </section>
    <Notice error>{m.error && <>{text.pages_StatusPage_021} · {text.pages_StatusPage_022}</>}</Notice>
    {m.refreshing && <DataActivity label={text.pages_StatusPage_070} skeleton={m.status ? undefined : 'cards'} />}

    <section className="v2-service-components" aria-label={text.pages_StatusPage_008}>
      <SectionTitle title={text.pages_StatusPage_008} />
      <div>{components.map(({ title, description, level }) => <article key={title}>
        <div><h3>{title}</h3><p>{description}</p></div>
        {level ? <ServiceStatusBadge level={level} compact /> : <span className="v2-service-unknown">{m.error ? text.pages_StatusPage_071 : text.pages_StatusPage_024}</span>}
      </article>)}</div>
    </section>

    <section className="v2-service-history" aria-label={text.pages_StatusPage_037}>
      <SectionTitle title={text.pages_StatusPage_037} description={`${text.pages_StatusPage_038}${m.currentStatus.history.complete ? `${text.pages_StatusPage_039} ${cells.reduce((sum, cell) => sum + cell.sample_count, 0)} ${text.pages_StatusPage_040}` : text.pages_StatusPage_041}`} />
      <div className="v2-service-history-panel">
        <div className="v2-status-legend" aria-label={text.pages_StatusPage_042}>{HISTORY_LEVELS.map((level) => <span key={level}><i data-level={level} aria-hidden="true" />{statusLabel(level)}</span>)}</div>
        <p className="v2-service-history-hint">{text.serviceStatus_historyHint}</p>
        <div className="v2-service-history-scroll">
          <div className="v2-service-week" role="grid" aria-label={text.pages_StatusPage_043} aria-rowcount={7} aria-colcount={24} onKeyDown={navigateHistory}>
            <div className="v2-service-hours" aria-hidden="true"><span />{days[0].map((cell, index) => <span key={cell.bucket_start}>{index % 3 === 0 ? new Date(cell.bucket_start).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }) : ''}</span>)}</div>
            {days.map((day, dayIndex) => <div className="v2-service-day" key={dayIndex} role="row">
              <time aria-hidden="true">{m.status ? new Date(day[0].bucket_start).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }) : '—'}</time>
              {day.map((cell, hourIndex) => {
                const index = dayIndex * 24 + hourIndex
                return <div role="gridcell" key={cell.bucket_start} aria-selected={selectedHour === index}>
                  <button type="button" data-level={cell.status} tabIndex={selectedHour === index ? 0 : -1} title={historyCellLabel(cell)} aria-label={historyCellLabel(cell)} onFocus={() => setSelectedHour(index)} onClick={() => setSelectedHour(index)} />
                </div>
              })}
            </div>)}
          </div>
        </div>
        <p id="v2-service-hour-detail" className="v2-service-hour-detail" aria-live="polite" aria-atomic="true"><i data-level={selectedCell.status} aria-hidden="true" />{m.status ? historyCellLabel(selectedCell) : m.error ? text.pages_StatusPage_071 : text.pages_StatusPage_024}</p>
      </div>
    </section>

    <section className="v2-service-incidents" aria-label={text.pages_StatusPage_045}>
      <SectionTitle title={text.pages_StatusPage_045} />
      {!incidents.length ? <EmptyState title={text.pages_StatusPage_046} /> : incidents.map((incident) => <article key={incident.id} data-state={incident.status} data-impact={incident.impact}>
        <header><div><h3>{incident.title}</h3><p>{incidentImpactLabel(incident.impact)} · {text.pages_StatusPage_047} {formatUpdatedAt(incident.started_at)}</p></div><span className="v2-service-incident-state">{incidentStatusLabel(incident.status)}</span></header>
        <ol>{incident.updates.map((update) => <li key={update.id}><time dateTime={update.created_at}>{formatUpdatedAt(update.created_at)}</time><div><strong>{incidentStatusLabel(update.status)}</strong><p>{update.body}</p></div></li>)}</ol>
      </article>)}
    </section>

    <details className="v2-disclosure"><summary>{text.pages_StatusPage_015}</summary>{([
      ['available', text.pages_StatusPage_016], ['scaling', text.pages_StatusPage_068], ['busy', text.pages_StatusPage_017],
      ['congested', text.pages_StatusPage_018], ['overloaded', text.pages_StatusPage_064], ['unavailable', text.pages_StatusPage_019],
    ] as const).map(([level, description]) => <div className="v2-status-rule" key={level}><ServiceStatusBadge level={level} compact /><p>{description}</p></div>)}<p>{text.pages_StatusPage_031}</p></details>
  </div>
}
