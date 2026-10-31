import { Link } from 'react-router'
import { copy } from '../../../copy'
import { ExportIcon, NextIcon, SuccessIcon } from '../../../components/icons'
import { BENCHMARK_ASSETS, benchmarkCasePath, benchmarkNumber as number, regularBenchmarkComparison, siteBenchmark as data } from '../../../lib/site-benchmark'
import { v2Path } from '../navigation'
import BenchmarkResults from './benchmark/BenchmarkResults'
import './benchmark/benchmark.css'

const text = copy.siteBenchmark
const comparisons = data.layouts.filter((layout) => layout.id !== 'S3').flatMap((layout) => data.sites.filter((site) => site.id !== 'maatool').map((site) => ({ layout, site, ...regularBenchmarkComparison(layout.id, site.id) })))
const pairs = comparisons.flatMap((group) => group.pairs)
const higher = pairs.filter((pair) => pair.deltaPercent > 0).length
const aboveOne = pairs.filter((pair) => pair.deltaPercent > 1).length

export default function SiteBenchmark() {
  const own = data.cases.filter((item) => item.site === 'maatool')
  const passed = own.filter((item) => item.passed).length
  return <article className="site-benchmark">
    <header className="benchmark-hero">
      <p className="benchmark-stamp"><time dateTime={data.date}>{data.date}</time><span>{text.organizer} · {data.organizer}</span><span>{text.simulator} · {data.simulatorVersion.split('@')[0]}</span></p>
      <h2>{text.headline(data.sites[0].label, own.length).map((part) => <span key={part}>{part}</span>)}</h2>
      <div className="benchmark-hero-metrics">
        <div><strong>{number(passed / own.length * 100, 0)}<span>%</span></strong><p>{text.heroPass(passed, own.length)}</p></div>
        <div><strong>{higher}<span>／{pairs.length}</span></strong><p>{text.heroYield}</p></div>
      </div>
      <p className="benchmark-muted">{text.scope(data.samples.length, data.layouts.length, data.sites.length)} · {text.heroScope}</p>
      <div className="benchmark-actions"><a className="v2-button v2-button-primary" href="#benchmark-data">{text.viewData}<NextIcon size={16} aria-hidden="true" /></a><Link className="v2-button v2-button-secondary" to={v2Path('generation')}>{text.generate}</Link></div>
    </header>
    <nav className="benchmark-index" aria-label={text.title}>{text.sectionLinks.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
    <section className="benchmark-section" id="benchmark-execution">
      <div className="benchmark-section-heading"><h2>{text.executionTitle}</h2><p className="benchmark-muted">{text.executionScope}</p></div>
      <div className="benchmark-site-summary" aria-label={text.passLabel}>
        {data.sites.map((site) => {
          const cases = data.cases.filter((item) => item.site === site.id)
          const passes = cases.filter((item) => item.passed).length
          return <div className={`benchmark-site ${site.id === 'maatool' ? 'benchmark-site-own' : ''}`} key={site.id}>
            <a className="benchmark-site-name" href={site.url} target="_blank" rel="noreferrer">{text.siteShort[site.id as keyof typeof text.siteShort]}</a>
            <strong className="benchmark-pass-percent">{number(passes / cases.length * 100, passes === cases.length ? 0 : 1)}<small>%</small></strong>
            <p className="benchmark-site-total">{text.passCount(passes, cases.length)}</p>
            <div className="benchmark-check-grid" aria-hidden="true">{cases.map((item) => <span key={item.id} className={item.passed ? 'benchmark-check-pass' : 'benchmark-check-fail'}>{item.passed ? '✓' : '×'}</span>)}</div>
            <p className={passes === cases.length ? 'benchmark-valid' : 'benchmark-invalid'}>{text.failureTotal(cases.length - passes)}</p>
          </div>
        })}
      </div>
      <p className="benchmark-legend"><span className="benchmark-valid">✓ {text.passLabel}</span><span className="benchmark-invalid">× {text.failureLabel}</span><span>{text.oneMark}</span></p>
    </section>
    <section className="benchmark-section" id="benchmark-yield">
      <div className="benchmark-section-heading"><h2>{text.yieldTitle(higher, pairs.length)}</h2><p>{text.yieldBody(aboveOne, pairs.length - aboveOne)}</p></div>
      <div className="benchmark-gains">{comparisons.filter((group) => group.pairs.length).sort((a, b) => b.median! - a.median!).map(({ layout, site, pairs, median }) => <article className="benchmark-gain" key={`${layout.id}-${site.id}`}>
        <p>{layout.label}<span>{text.against(text.siteShort[site.id as keyof typeof text.siteShort])}</span></p>
        <strong className="benchmark-gain-number">{median! > 0 ? '+' : ''}{number(median)}<small>%</small></strong>
        <p className="benchmark-muted">{text.medianGain}</p>
        <div className="benchmark-gain-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.abs(median!) / Math.max(...comparisons.map((group) => Math.abs(group.median ?? 0)))})` }} /></div>
        <p className="benchmark-pair-count">{text.pairCount(pairs.length)}</p>
        <ul className="benchmark-pair-gains">{pairs.map((pair) => <li key={pair.sample}><span>{pair.sample}</span><strong>{pair.deltaPercent > 0 ? '+' : ''}{number(pair.deltaPercent)}%</strong></li>)}</ul>
      </article>)}</div>
    </section>
    <BenchmarkResults />
    <section className="benchmark-section" id="benchmark-conflicts">
      <div className="benchmark-section-heading"><h2>{text.conflictsTitle}</h2><p>{text.executionBody}</p></div>
      <div className="benchmark-conflicts">{data.conflicts.map((conflict, index) => {
        const item = data.cases.find((item) => item.id === conflict.caseId)!
        return <article key={conflict.caseId}>
          <p className="benchmark-muted">{data.sites.find((site) => site.id === item.site)!.label} · {item.sample}／{data.layouts.find((layout) => layout.id === item.layout)!.label}</p>
          <h3><span className="benchmark-invalid" aria-hidden="true">× </span>{conflict.operator}</h3><p className="benchmark-deficit">{text.moodDeficit(conflict.start, conflict.needed)}</p>
          <ol className="benchmark-timeline">{conflict.shifts.map((shift, index) => <li key={index} style={{ flexGrow: shift.hours }}><span>{text.shift(index + 1)} · {text.hours(shift.hours)}</span><strong>{shift.roomKind ? `${text.roomTypes[shift.roomKind as keyof typeof text.roomTypes]}${shift.roomIndex}` : text.unassigned}</strong></li>)}</ol>
          <p>{text.conflicts[index]}</p><Link className="benchmark-link" to={benchmarkCasePath(item)}>{text.inspectCase}<NextIcon size={16} aria-hidden="true" /></Link>
        </article>
      })}</div>
      <details className="benchmark-disclosure"><summary>{text.executionDetails}</summary><p>{text.executionEmphasis}</p><p className="benchmark-muted">{text.executionNote}</p></details>
    </section>
    <section className="benchmark-section" id="benchmark-method">
      <details className="benchmark-disclosure benchmark-method-disclosure"><summary>{text.methodTitle}</summary>
        <dl className="benchmark-methods">{text.methods.map(([title, body]) => <div key={title}><dt>{title}</dt><dd>{body}</dd></div>)}</dl>
        <p className="benchmark-muted">{text.orundumNote}</p>
        <details className="benchmark-disclosure"><summary>{text.configurations}</summary><div className="benchmark-configurations">{data.layouts.map((layout) => <section key={layout.id}><h3>{layout.label}</h3><dl>{[[text.trading, layout.config.trading_station_levels], [text.manufacture, layout.config.manufacturing_station_levels], [text.power, layout.powerLevels], [text.dormitory, layout.dormitoryLevels]].map(([label, levels]) => <div key={String(label)}><dt>{label}</dt><dd>{(levels as number[]).join('／')}</dd></div>)}</dl><p>{Object.entries(layout.config.product_requirements.trading_stations).map(([product, count]) => `${text.products[product as keyof typeof text.products]}×${count}`).join(' · ')}</p><p>{Object.entries(layout.config.product_requirements.manufacturing_stations).map(([product, count]) => `${text.products[product as keyof typeof text.products]}×${count}`).join(' · ')}</p></section>)}</div></details>
        <details className="benchmark-disclosure"><summary>{text.samplesTitle}</summary><dl className="benchmark-samples">{data.samples.map((sample) => <div key={sample.alias}><dt>{sample.alias} · {text.inputSummary(sample.owned, sample.elite2)}</dt><dd><span>{text.fingerprint}</span><code>{sample.rosterSha256}</code></dd></div>)}</dl></details>
        <details className="benchmark-disclosure"><summary>{text.generationTitle}</summary><dl className="benchmark-versions"><div><dt>{text.simulator}</dt><dd><code>{data.simulatorVersion}</code></dd></div><div><dt>{data.sites[0].label}</dt><dd>{data.generation.maatool}</dd></div><div><dt>{data.sites[1].label}</dt><dd>{data.generation.yituliuData} · {data.generation.yituliuEngine}</dd></div><div><dt>{data.sites[2].label}</dt><dd><code>{data.generation.riicClient}</code></dd></div></dl></details>
      </details>
    </section>
    <section className="benchmark-section" id="benchmark-downloads"><h2>{text.downloadsTitle}</h2><div className="benchmark-downloads">{text.downloads.map(([file, label, format]) => <a key={file} href={`${BENCHMARK_ASSETS}/${file}`} download><ExportIcon size={18} aria-hidden="true" /><span>{label}</span><small>{format}</small></a>)}</div></section>
    <footer className="benchmark-cta"><SuccessIcon size={24} aria-hidden="true" /><div><p>{text.footer}</p><Link className="v2-button v2-button-primary" to={v2Path('generation')}>{text.generate}<NextIcon size={16} aria-hidden="true" /></Link></div></footer>
  </article>
}
