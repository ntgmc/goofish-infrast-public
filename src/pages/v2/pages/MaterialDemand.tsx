import { useEffect, useMemo, useRef, useState } from 'react'
import { materialDemandCopy as text } from '../../../copy/zh-CN/material-demand'
import snapshot from '../../../data/material-demand.json'
import { materialDemandCsv, materialDemandMonths, materialDemandSeries, type MaterialDemandMetric } from '../../../lib/material-demand'
import MaterialDemandChart from './MaterialDemandChart'
import './material-demand.css'

const months = materialDemandMonths(snapshot)
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)

export default function MaterialDemand() {
  const [materialId, setMaterialId] = useState(snapshot.materials[0].id)
  const [metric, setMetric] = useState<MaterialDemandMetric>('amount')
  const [window, setWindow] = useState(6)
  const [selected, setSelected] = useState(Math.max(0, months.length - (months[months.length - 1]?.partial ? 2 : 1)))
  const [sources, setSources] = useState(true)
  const [rawPoints, setRawPoints] = useState(false)
  const [fullScale, setFullScale] = useState(false)
  const [narrow, setNarrow] = useState(() => Boolean(globalThis.matchMedia?.('(max-width: 639px)').matches))
  useEffect(() => {
    const query = globalThis.matchMedia?.('(max-width: 639px)')
    if (!query) return
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const chartHeading = useRef<HTMLHeadingElement>(null)
  const materialIndex = snapshot.materials.findIndex((item) => item.id === materialId)
  const material = snapshot.materials[materialIndex]
  const series = useMemo(() => snapshot.materials.map((_, index) => materialDemandSeries(months, index, metric, window)), [metric, window])
  const points = series[materialIndex], active = points[selected], month = months[selected]
  const latest = [...points].reverse().find((point) => point.value !== null)
  const suffix = metric === 'share' ? '%' : ''
  const unit = metric === 'share' ? text.shareUnit : text.amountUnit
  const contributions = [...snapshot.operators.map((row) => ({ ...row, source: text.operators })), ...snapshot.modules.map((row) => ({ ...row, source: text.modules }))]
    .filter((row) => row.date.startsWith(month.month) && row.amounts[materialIndex] > 0).sort((a, b) => b.amounts[materialIndex] - a.amounts[materialIndex])
  const download = () => {
    const url = URL.createObjectURL(new Blob([materialDemandCsv(snapshot, months)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `material-demand-${snapshot.asOf}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const selectMaterial = (id: string) => { setMaterialId(id); chartHeading.current?.focus({ preventScroll: true }); chartHeading.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }) }

  return <div className="material-demand-page">
    <div className="material-demand-intro"><p className="v2-lead">{text.description}</p><span className="v2-muted">{text.snapshot(snapshot.asOf)}</span></div>
    <div className="material-demand-toolbar">
      <label className="v2-field"><span>{text.metric}</span><select className="v2-input" aria-label={text.metric} value={metric} onChange={(event) => setMetric(event.target.value as MaterialDemandMetric)}><option value="amount">{text.amount}</option><option value="share">{text.share}</option></select></label>
      <label className="v2-field"><span>{text.window}</span><select className="v2-input" aria-label={text.window} value={window} onChange={(event) => setWindow(Number(event.target.value))}>{Object.entries(text.windows).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="material-demand-basis"><span>{text.basis}</span><small>{text.basisHint}</small></div>
    </div>
    <section className="material-demand-focus" aria-labelledby="material-demand-detail-title">
      <div className="material-demand-focus-heading"><h2 id="material-demand-detail-title" ref={chartHeading} tabIndex={-1}><img src={`/item-icons/${material.icon}.png`} width={40} height={40} alt="" />{material.name}</h2><span>{unit}</span></div>
      <div className="material-demand-legend"><span className="material-demand-legend-total">{text.all}</span>{sources && <><span className="material-demand-legend-operators">{text.operators}</span><span className="material-demand-legend-modules">{text.modules}</span></>}{rawPoints && <span className="material-demand-legend-raw">{text.raw}</span>}</div>
      <MaterialDemandChart name={material.name} points={points} share={metric === 'share'} narrow={narrow} sources={sources} rawPoints={rawPoints} fullScale={fullScale} selected={selected} onSelect={setSelected} />
      <div className="material-demand-controls"><label className="v2-field"><span>{text.month}</span><select className="v2-input" aria-label={text.month} value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{months.map((row, index) => <option key={row.month} value={index}>{row.month}{row.partial ? ` · ${text.partial}` : ''}</option>)}</select></label>
        <label className="material-demand-checkbox"><input type="checkbox" checked={sources} onChange={(event) => setSources(event.target.checked)} />{text.sources}</label>
        <label className="material-demand-checkbox"><input type="checkbox" checked={rawPoints} onChange={(event) => setRawPoints(event.target.checked)} />{text.rawPoints}</label>
        <label className="material-demand-checkbox"><input type="checkbox" checked={fullScale} onChange={(event) => setFullScale(event.target.checked)} />{text.fullScale}</label></div>
      {!fullScale && <p className="material-demand-axis-hint">{text.focusedScaleHint}</p>}
      <div className="material-demand-reading" aria-live="polite"><div><span>{text.reading(active.month)}</span><strong>{active.value === null ? '—' : `${format(active.value)}${suffix}`}</strong></div>
        {active.value !== null ? <p>{text.operators} {format(active.operators!)}{suffix} · {text.modules} {format(active.modules!)}{suffix}<small>{text.counts(active.operatorCount, active.moduleCount)}</small></p> : <p>{month.partial ? text.partial : metric === 'share' && selected >= window - 1 ? text.emptyShare : text.incompleteWindow}</p>}
        <p>{text.raw} <strong>{active.raw === null ? '—' : `${format(active.raw)}${suffix}`}</strong></p></div>
    </section>
    <section aria-labelledby="material-demand-overview-title"><div className="material-demand-overview-heading"><h2 id="material-demand-overview-title">{text.overview}</h2><p>{text.overviewHint}</p></div>
      <div className="material-demand-overview">{snapshot.materials.map((item, index) => {
        const last = [...series[index]].reverse().find((point) => point.value !== null)
        return <button type="button" key={item.id} aria-label={text.selectMaterial(item.name)} aria-pressed={item.id === materialId} onClick={() => selectMaterial(item.id)}>
          <span className="material-demand-card-heading"><img src={`/item-icons/${item.icon}.png`} alt="" width={32} height={32} loading="lazy" /><strong>{item.name}</strong><span>{last ? `${format(last.value!)}${suffix}` : '—'}</span></span>
          <MaterialDemandChart name={item.name} points={series[index]} share={metric === 'share'} rawPoints={rawPoints} fullScale={fullScale} compact />
        </button>
      })}</div><p className="material-demand-footnote">{latest?.month} · {unit}</p>
    </section>
    <details className="v2-disclosure material-demand-data"><summary>{text.data}</summary><button type="button" className="v2-button v2-button-secondary" onClick={download}>{text.download}</button>
      <div className="material-demand-table-scroll"><table><caption>{material.name} · {text.tableCaption}</caption><thead><tr><th scope="col">{text.columns.month}</th><th scope="col">{text.columns.operators}</th><th scope="col">{text.columns.modules}</th><th scope="col">{text.columns.total}</th><th scope="col">{text.columns.share}</th></tr></thead><tbody>{months.map((row) => {
        const total = row.operators[materialIndex] + row.modules[materialIndex]
        return <tr key={row.month}><th scope="row">{row.month}{row.partial && <small>{text.partial}</small>}</th><td>{format(row.operators[materialIndex])}</td><td>{format(row.modules[materialIndex])}</td><td>{format(total)}</td><td>{row.total > 0 ? `${format(total / row.total * 100)}%` : '—'}</td></tr>
      })}</tbody></table></div>
      <details className="v2-disclosure"><summary>{text.details} · {month.month}</summary>{contributions.length ? <div className="material-demand-table-scroll"><table><caption>{text.contributionCaption}</caption><thead><tr><th scope="col">{text.columns.content}</th><th scope="col">{text.columns.date}</th><th scope="col">{text.columns.source}</th><th scope="col">{text.columns.amount}</th></tr></thead><tbody>{contributions.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.date}</td><td>{row.source}</td><td>{format(row.amounts[materialIndex])}</td></tr>)}</tbody></table></div> : <p>{text.noContributions}</p>}</details>
    </details>
    <details className="v2-disclosure material-demand-methodology"><summary>{text.methodology}</summary><p>{text.methodologyText}</p><p>{text.exclusions}</p><p>{text.currentTables}</p><p>{text.scope}</p>
      <div className="v2-actions"><a className="v2-text-button" href={`https://github.com/Kengxxiao/ArknightsGameData/tree/${snapshot.gameSha}/zh_CN/gamedata/excel`} target="_blank" rel="noreferrer">{text.gameData}</a><a className="v2-text-button" href="https://prts.wiki/w/%E5%B9%B2%E5%91%98%E4%B8%8A%E7%BA%BF%E6%97%B6%E9%97%B4%E4%B8%80%E8%A7%88" target="_blank" rel="noreferrer">{text.releaseDates}</a></div>
    </details>
  </div>
}
