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
    const frame = requestAnimationFrame(() => document.getElementById('benchmark-data')?.scrollIntoView?.({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [selectedId])
  const shown = data.cases.filter((item) => (!sample || sample === item.sample) && (!layout || layout === item.layout) && (!site || site === item.site) && (!status || item.passed === (status === 'passed')))
  const groups = data.samples.flatMap((sample) => data.layouts.map((layout) => ({ sample, layout, cases: shown.filter((item) => item.sample === sample.alias && item.layout === layout.id) }))).filter((group) => group.cases.length)
  const filters = new URLSearchParams(Object.entries({ sample, layout, site, status }).filter(([, value]) => value))
  function reset() { setSample(''); setLayout(''); setSite(''); setStatus('') }
  return <section className="benchmark-section benchmark-data" id="benchmark-data">
    <h2>{text.dataTitle}</h2><p>{text.dataBody}</p>
    <div className="benchmark-filters">
      <label>{text.sample}<select value={sample} onChange={(event) => setSample(event.target.value)}><option value="">{text.allSamples}</option>{data.samples.map((item) => <option value={item.alias} key={item.alias}>{item.alias}</option>)}</select></label>
      <label>{text.layout}<select value={layout} onChange={(event) => setLayout(event.target.value)}><option value="">{text.allLayouts}</option>{data.layouts.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label>{text.site}<select value={site} onChange={(event) => setSite(event.target.value)}><option value="">{text.allSites}</option>{data.sites.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label>{text.state}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{text.allStates}</option><option value="failed">{text.failuresOnly}</option><option value="passed">{text.passedOnly}</option></select></label>
      <button className="v2-button v2-button-secondary" type="button" onClick={reset}>{text.reset}</button>
    </div>
    <div className="benchmark-filter-summary"><p className="benchmark-muted" role="status" aria-live="polite">{text.shown(shown.length, data.cases.length)}</p>{filters.size > 0 && <Link className="benchmark-link" to={`/v2/benchmarks?${filters}#benchmark-data`}>{text.filterLink}</Link>}</div>
    {groups.length ? groups.map((group) => <section className="benchmark-result-group" key={`${group.sample.alias}-${group.layout.id}`}>
      <header><h3>{group.sample.alias} · {group.layout.label}</h3><p className="benchmark-muted">{text.inputSummary(group.sample.owned, group.sample.elite2)}</p></header>
      {group.cases.map((item) => <CaseResult key={item.id} item={item} initiallyOpen={item.id === selectedId} />)}
    </section>) : <p className="benchmark-empty">{text.empty}</p>}
  </section>
}

function CaseResult({ item, initiallyOpen }: { item: BenchmarkCase; initiallyOpen: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen)
  const opportunity = item.opportunityCost
  const baseline = opportunity ? data.cases.find((candidate) => candidate.sample === item.sample && candidate.site === item.site && candidate.layout === opportunity.baselineScenario)! : null
  const site = data.sites.find((site) => site.id === item.site)!
  return <details className="benchmark-case" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} data-case-id={item.id}>
    <summary><strong>{site.label}</strong><span className={`benchmark-status ${item.passed ? 'benchmark-valid' : 'benchmark-invalid'}`}>{item.passed ? text.passLabel : text.failureLabel}</span><span className="benchmark-case-value">{number(opportunity ? opportunity.perOrundum : item.resources.sanity, opportunity ? 4 : 2)}<small>{opportunity ? text.unitCost : text.unitSanity}</small></span><span className="benchmark-case-arrow" aria-hidden="true">＋</span></summary>
    {expanded && <div className="benchmark-case-body">
      <p className="benchmark-loop">{item.stable ? text.stable : text.unstable} · {text.iterations(item.iterations)} · {text.moodErrors(item.moodErrors)}</p>
      <h4>{text.resourcesTitle}</h4><dl className="benchmark-resources">{(Object.keys(text.resources) as (keyof typeof text.resources)[]).map((key) => <div key={key}><dt>{text.resources[key]}</dt><dd>{number(item.resources[key])}</dd></div>)}</dl>
      {opportunity && <><h4>{text.costTitle}</h4><dl className="benchmark-resources">
        <div><dt>{text.baseline}</dt><dd>{data.layouts.find((layout) => layout.id === opportunity.baselineScenario)!.label} · {number(baseline!.resources.sanity)}</dd></div><div><dt>{text.baselineStatus}</dt><dd>{baseline!.passed ? text.passLabel : text.failureLabel}</dd></div>
        {[[text.foregone, opportunity.foregoneProduction], [text.materials, opportunity.materialCost], [text.dailyCost, opportunity.dailyCost], [text.unitCost, opportunity.perOrundum]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value as number, label === text.unitCost ? 4 : 2)}</dd></div>)}</dl></>}
      <div className="benchmark-actions"><Link className="benchmark-link" to={benchmarkCasePath(item)}>{text.caseLink}</Link><a className="benchmark-link" href={`${BENCHMARK_ASSETS}/cases/${item.id}.json`} download>{text.caseDownload}</a></div>
      <BenchmarkEvidence item={item} />
    </div>}
  </details>
}
