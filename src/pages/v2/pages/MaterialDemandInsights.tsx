import { materialDemandCopy as text } from '../../../copy/zh-CN/material-demand'
import type { MaterialDemandAnalysis } from '../../../lib/material-demand-analysis'

const copy = text.analysis
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)
const range = (period: MaterialDemandAnalysis['recent']) => period.start && period.end ? copy.range(period.start, period.end) : '—'

export default function MaterialDemandInsights({ analysis, onMonth }: { analysis: MaterialDemandAnalysis; onMonth: (month: string) => void }) {
  const { recent, previous, comparable } = analysis
  const sourceDelta = { operators: recent.operators - previous.operators, modules: recent.modules - previous.modules }
  const delta = recent.total - previous.total
  const operatorContribution = delta > 0 ? sourceDelta.operators : -sourceDelta.operators
  const moduleContribution = delta > 0 ? sourceDelta.modules : -sourceDelta.modules
  const driver = Math.abs(operatorContribution - moduleContribution) < 0.05 ? copy.bothSources : operatorContribution > moduleContribution ? text.operators : text.modules
  const max = Math.max(1, recent.total, comparable ? previous.total : 0)
  const origins = ['direct', 'purple', 'gold'] as const

  return <section className="material-demand-insights" aria-labelledby="material-demand-insights-title">
    <div className="material-demand-insights-heading"><h3 id="material-demand-insights-title">{copy.title}</h3><p>{comparable ? copy.compareRange(range(recent), range(previous)) : range(recent)}</p></div>
    <p className="material-demand-conclusion">{comparable ? copy.summary(copy.describeChange(analysis.change, '%'), copy.describeChange(analysis.shareChange, copy.pp)) : analysis.firstDemand ? copy.shortHistoryHint : copy.noDemand}</p>
    {!comparable && analysis.firstDemand && <p className="v2-muted">{copy.since(analysis.firstDemand)}</p>}
    <dl className="material-demand-analysis-metrics">
      <div><dt>{copy.total}</dt><dd>{number(recent.total)}<small>{copy.unit}</small></dd></div>
      <div><dt>{copy.growth}</dt><dd>{copy.signedChange(analysis.change, '%')}</dd></div>
      <div><dt>{copy.shareChange}</dt><dd>{copy.signedChange(analysis.shareChange, '')}<small>{copy.pp}</small></dd></div>
    </dl>
    {comparable && analysis.change === null && <p className="v2-muted">{copy.noBaseline}</p>}
    {analysis.halfYearChange !== null && <p className="material-demand-half-year">{copy.halfYear} {copy.signedChange(analysis.halfYearChange, '%')}</p>}
    <figure className="material-demand-comparison"><figcaption>{copy.sources}</figcaption>
      {(comparable ? [{ label: copy.previous, period: previous }, { label: copy.recent, period: recent }] : [{ label: copy.recent, period: recent }]).map(({ label, period }) => <div className="material-demand-comparison-row" key={label}>
        <span>{label}</span><div className="material-demand-comparison-track" role="img" aria-label={`${label}，${text.operators} ${number(period.operators)}，${text.modules} ${number(period.modules)}`}>
          <span className="material-demand-bar-operators" style={{ width: `${period.operators / max * 100}%` }} /><span className="material-demand-bar-modules" style={{ width: `${period.modules / max * 100}%` }} />
        </div><strong>{number(period.total)}</strong>
      </div>)}
      <div className="material-demand-source-labels"><span>{text.operators} {number(recent.operators)}{comparable && <small>{copy.previousDifference} {copy.signedChange(sourceDelta.operators, '')}</small>}</span><span>{text.modules} {number(recent.modules)}{comparable && <small>{copy.previousDifference} {copy.signedChange(sourceDelta.modules, '')}</small>}</span></div>
      {comparable && <p>{Math.abs(delta) < 0.05 ? copy.balanced : copy.driver(driver, delta > 0 ? copy.directionUp : copy.directionDown)}</p>}
    </figure>
    {recent.total > 0 && <figure className="material-demand-origins"><figcaption>{copy.recipeSources}</figcaption>
      <div className="material-demand-origin-track" role="img" aria-label={origins.map((origin) => `${copy.origins[origin]} ${number(recent.origins[origin] / recent.total * 100)}%`).join('，')}>
        {origins.map((origin) => <span key={origin} className={`material-demand-origin-${origin}`} style={{ width: `${recent.origins[origin] / recent.total * 100}%` }} />)}
      </div>
      <dl>{origins.map((origin) => <div key={origin}><dt><i className={`material-demand-origin-${origin}`} />{copy.origins[origin]}</dt><dd>{number(recent.origins[origin])} · {number(recent.origins[origin] / recent.total * 100)}%{comparable && <small>{copy.previousDifference} {copy.signedChange(recent.origins[origin] - previous.origins[origin], '')}</small>}</dd></div>)}</dl>
      <p>{copy.recipeHint}</p>
    </figure>}
    <details className="v2-disclosure material-demand-contributors"><summary>{copy.contributors}</summary>
      {analysis.peak && <button type="button" className="v2-text-button" onClick={() => onMonth(analysis.peak!.month)} aria-label={copy.jumpMonth(analysis.peak.month)}>{copy.peak(analysis.peak.month)} · {number(analysis.peak.amount)}</button>}
      <ol>{analysis.contributors.map((row) => <li key={`${row.source}:${row.id}`}><button type="button" onClick={() => onMonth(row.month)}><span>{row.name}<small>{row.month} · {text[row.source]}</small></span><strong>{number(row.amount)}</strong></button></li>)}</ol>
    </details>
  </section>
}
