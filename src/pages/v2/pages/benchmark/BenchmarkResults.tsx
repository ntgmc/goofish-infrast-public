import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { copy } from '../../../../copy'
import { BENCHMARK_ASSETS, benchmarkCasePath, benchmarkNumber as number, siteBenchmark as data, type BenchmarkCase } from '../../../../lib/site-benchmark'
import BenchmarkEvidence from './BenchmarkEvidence'

const text = copy.siteBenchmark

export default function BenchmarkResults() {
  const [params] = useSearchParams()
  return <Results key={params.toString()} params={params} />
}

function Results({ params }: { params: URLSearchParams }) {
  const [sample, setSample] = useState(() => data.samples.some((item) => item.alias === params.get('sample')) ? params.get('sample')! : '')
  const [layout, setLayout] = useState(() => data.layouts.some((item) => item.id === params.get('layout')) ? params.get('layout')! : '')
  const [site, setSite] = useState(() => data.sites.some((item) => item.id === params.get('site')) ? params.get('site')! : '')
  const [status, setStatus] = useState(() => ['passed', 'failed'].includes(params.get('status') ?? '') ? params.get('status')! : '')
  const selectedId = data.cases.find((item) => item.sample === params.get('sample') && item.layout === params.get('layout') && item.site === params.get('site'))?.id
  useEffect(() => {
    if (!selectedId) return
    const frame = requestAnimationFrame(() => document.querySelector(`[data-case-id="${selectedId}"]`)?.scrollIntoView?.({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [selectedId])
  const shown = data.cases.filter((item) => (!sample || sample === item.sample) && (!layout || layout === item.layout) && (!site || site === item.site) && (!status || item.passed === (status === 'passed')))
  const groups = data.layouts.map((layout) => ({ layout, samples: data.samples.map((sample) => ({ sample, cases: shown.filter((item) => item.sample === sample.alias && item.layout === layout.id) })).filter((group) => group.cases.length) })).filter((group) => group.samples.length)
  const filters = new URLSearchParams(Object.entries({ sample, layout, site, status }).filter(([, value]) => value))
  function reset() { setSample(''); setLayout(''); setSite(''); setStatus('') }
  return <section className="benchmark-section benchmark-data" id="benchmark-data">
    <h2>{text.dataTitle}</h2><p>{text.dataBody}</p><p className="benchmark-muted">{text.scoreScale}</p>
    <div className="benchmark-filters">
      <label>{text.sample}<select value={sample} onChange={(event) => setSample(event.target.value)}><option value="">{text.allSamples}</option>{data.samples.map((item) => <option value={item.alias} key={item.alias}>{item.alias}</option>)}</select></label>
      <label>{text.layout}<select value={layout} onChange={(event) => setLayout(event.target.value)}><option value="">{text.allLayouts}</option>{data.layouts.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label>{text.site}<select value={site} onChange={(event) => setSite(event.target.value)}><option value="">{text.allSites}</option>{data.sites.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label>{text.state}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{text.allStates}</option><option value="failed">{text.failuresOnly}</option><option value="passed">{text.passedOnly}</option></select></label>
      <button className="v2-button v2-button-secondary" type="button" onClick={reset}>{text.reset}</button>
    </div>
    <div className="benchmark-filter-summary"><p className="benchmark-muted" role="status" aria-live="polite">{text.shown(shown.length, data.cases.length)}</p>{filters.size > 0 && <Link className="benchmark-link" to={`/v2/benchmarks?${filters}#benchmark-data`}>{text.filterLink}</Link>}</div>
    <p className="benchmark-legend"><span className="benchmark-valid">✓ {text.passLabel}</span><span className="benchmark-invalid">× <s>{text.failedReading}</s></span></p>
    {groups.length ? groups.map(({ layout, samples }) => <section className="benchmark-layout-board" key={layout.id}>
      <header><h3>{layout.label}</h3><p>{layout.id === 'S3' ? text.costDirection : text.yieldDirection}</p></header>
      {samples.map((group) => <ResultGroup key={group.sample.alias} sample={group.sample.alias} cases={group.cases} selectedId={selectedId} />)}
    </section>) : <p className="benchmark-empty">{text.empty}</p>}
  </section>
}

function ResultGroup({ sample, cases, selectedId }: { sample: string; cases: BenchmarkCase[]; selectedId?: string }) {
  const [expandedId, setExpandedId] = useState(cases.find((item) => item.id === selectedId)?.id)
  const selected = cases.find((item) => item.id === expandedId)
  const value = (item: BenchmarkCase) => item.opportunityCost?.perOrundum ?? item.resources.sanity
  const values = data.cases.filter((item) => item.sample === sample && item.layout === cases[0].layout).map(value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = maximum - minimum
  return <div className="benchmark-result-group" role="group" aria-label={`${sample} · ${data.layouts.find((layout) => layout.id === cases[0].layout)!.label}`}>
    <h4>{sample}</h4>
    <div className="benchmark-match">
      {data.sites.map((site) => {
        const item = cases.find((item) => item.site === site.id)
        if (!item) return <div key={site.id} className="benchmark-score-empty" />
        const improvement = item.opportunityCost ? maximum - value(item) : value(item) - minimum
        return <button key={item.id} type="button" className={`benchmark-score ${item.passed ? 'benchmark-score-pass' : 'benchmark-score-fail'} ${site.id === 'maatool' ? 'benchmark-score-own' : ''}`} aria-expanded={expandedId === item.id} aria-controls={`${sample}-${item.layout}-evidence`} onClick={() => setExpandedId(expandedId === item.id ? undefined : item.id)} data-score-id={item.id}>
          <span className="benchmark-score-site">{text.siteShort[site.id as keyof typeof text.siteShort]}</span>
          <span className="benchmark-score-value">{item.passed ? number(value(item), item.opportunityCost ? 4 : 2) : <s>{number(value(item), item.opportunityCost ? 4 : 2)}</s>}</span>
          <span className="benchmark-score-bar" aria-hidden="true"><span style={{ transform: `scaleX(${range === 0 ? 1 : 0.2 + 0.8 * improvement / range})` }} /></span>
          <span className="benchmark-score-status"><span aria-hidden="true">{item.passed ? '✓' : '×'}</span> {item.passed ? text.scorePass : text.scoreFail}</span>
          {item.opportunityCost && <small>{number(item.resources.orundum, 1)} {text.unitOrundum}</small>}
        </button>
      })}
    </div>
    <div id={`${sample}-${cases[0].layout}-evidence`}>{selected && <CaseResult key={selected.id} item={selected} onClose={() => {
      document.querySelector<HTMLButtonElement>(`[data-score-id="${selected.id}"]`)?.focus()
      setExpandedId(undefined)
    }} />}</div>
  </div>
}

function CaseResult({ item, onClose }: { item: BenchmarkCase; onClose: () => void }) {
  const opportunity = item.opportunityCost
  const baseline = opportunity ? data.cases.find((candidate) => candidate.sample === item.sample && candidate.site === item.site && candidate.layout === opportunity.baselineScenario)! : null
  const site = data.sites.find((site) => site.id === item.site)!
  return <div className="benchmark-case-body" data-case-id={item.id}>
      <div className="benchmark-case-heading"><h4>{site.label} · {item.sample} · {data.layouts.find((layout) => layout.id === item.layout)!.label}</h4><button type="button" className="benchmark-link" onClick={onClose}>{text.closeEvidence}</button></div>
      <p className="benchmark-loop">{item.stable ? text.stable : text.unstable} · {text.iterations(item.iterations)} · {text.moodErrors(item.moodErrors)}</p>
      <h4>{text.resourcesTitle}</h4><dl className="benchmark-resources">{(Object.keys(text.resources) as (keyof typeof text.resources)[]).map((key) => <div key={key}><dt>{text.resources[key]}</dt><dd>{number(item.resources[key])}</dd></div>)}</dl>
      {opportunity && <><h4>{text.costTitle}</h4><dl className="benchmark-resources">
        <div><dt>{text.baseline}</dt><dd>{data.layouts.find((layout) => layout.id === opportunity.baselineScenario)!.label} · {number(baseline!.resources.sanity)}</dd></div><div><dt>{text.baselineStatus}</dt><dd>{baseline!.passed ? text.passLabel : text.failureLabel}</dd></div>
        {[[text.foregone, opportunity.foregoneProduction], [text.materials, opportunity.materialCost], [text.dailyCost, opportunity.dailyCost], [text.unitCost, opportunity.perOrundum]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value as number, label === text.unitCost ? 4 : 2)}</dd></div>)}</dl></>}
      <div className="benchmark-actions"><Link className="benchmark-link" to={benchmarkCasePath(item)}>{text.caseLink}</Link><a className="benchmark-link" href={`${BENCHMARK_ASSETS}/cases/${item.id}.json`} download>{text.caseDownload}</a></div>
      <BenchmarkEvidence item={item} />
  </div>
}
