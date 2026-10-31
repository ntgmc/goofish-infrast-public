import { Link } from 'react-router'
import { copy } from '../../../copy'
import { ExportIcon, NextIcon, SuccessIcon } from '../../../components/icons'
import { BENCHMARK_ASSETS, benchmarkCasePath, benchmarkMedian, benchmarkNumber as number, regularBenchmarkComparison, siteBenchmark as data } from '../../../lib/site-benchmark'
import { v2Path } from '../navigation'
import BenchmarkResults from './benchmark/BenchmarkResults'
import './benchmark/benchmark.css'

const text = copy.siteBenchmark
const comparisons = data.layouts.filter((layout) => layout.id !== 'S3').flatMap((layout) => data.sites.filter((site) => site.id !== 'maatool').map((site) => ({ layout, site, ...regularBenchmarkComparison(layout.id, site.id) })))

export default function SiteBenchmark() {
  const own = data.cases.filter((item) => item.site === 'maatool')
  const passed = own.filter((item) => item.passed).length
  return <article className="site-benchmark">
    <header className="benchmark-hero">
      <div className="benchmark-lead">
        <p className="benchmark-stamp"><time dateTime={data.date}>{data.date}</time><span>{text.organizer} · {data.organizer}</span></p>
        <div className="benchmark-hero-number">{passed}<span>／{own.length}</span></div>
        <h2>{text.headline(data.sites[0].label, own.length)}</h2>
        <p>{text.heroBody}</p>
        <p className="benchmark-muted">{text.scope(data.samples.length, data.layouts.length, data.sites.length)}<br />{text.simulator} · {data.simulatorVersion.split('@')[0]}</p>
        <div className="benchmark-actions"><a className="v2-button v2-button-primary" href="#benchmark-data">{text.viewData}<NextIcon size={16} aria-hidden="true" /></a><Link className="v2-button v2-button-secondary" to={v2Path('generation')}>{text.generate}</Link></div>
      </div>
      <div className="benchmark-site-summary" aria-label={text.passLabel}>
        {data.sites.map((site) => {
          const cases = data.cases.filter((item) => item.site === site.id)
          const passes = cases.filter((item) => item.passed).length
          return <div className="benchmark-site" key={site.id}>
            <div className="benchmark-site-heading"><a href={site.url} target="_blank" rel="noreferrer">{site.label}</a><strong>{text.passCount(passes, cases.length)}</strong></div>
            <div className="benchmark-bar" aria-hidden="true"><span style={{ transform: `scaleX(${passes / cases.length})` }} /></div>
            <div className="benchmark-site-heading benchmark-muted"><span>{text.failCount(cases.length - passes, cases.length)}</span><span>{number(passes / cases.length * 100, passes === cases.length ? 0 : 1)}%</span></div>
            <dl className="benchmark-layout-counts">{data.layouts.map((layout) => <div key={layout.id}><dt>{layout.label}</dt><dd>{cases.filter((item) => item.layout === layout.id && item.passed).length}／{cases.filter((item) => item.layout === layout.id).length}</dd></div>)}</dl>
            <p className="benchmark-muted">{text.shifts} · {site.shiftHours.join('／')}{text.hourUnit}</p>
          </div>
        })}
      </div>
    </header>
    <nav className="benchmark-index" aria-label={text.title}>{text.sectionLinks.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
    <section className="benchmark-section" id="benchmark-execution">
      <h2>{text.executionTitle}</h2><p>{text.executionBody}</p><p className="benchmark-emphasis">{text.executionEmphasis}</p><p className="benchmark-muted">{text.executionNote}</p>
    </section>
    <section className="benchmark-section" id="benchmark-regular">
      <h2>{text.regularTitle}</h2><p>{text.regularBody}</p>
      <table className="benchmark-table benchmark-stack-table"><thead><tr>{[text.layout, text.rival, text.onlyMaa, text.bothHigher, text.bothClose, text.bothLower, text.onlyRival, text.bothFail].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{comparisons.map(({ layout, site, counts }) => <tr key={`${layout.id}-${site.id}`}><th scope="row">{layout.label}</th><td data-label={text.rival}>{site.label}</td>{(Object.keys(counts) as (keyof typeof counts)[]).map((key, index) => <td key={key} data-label={[text.onlyMaa, text.bothHigher, text.bothClose, text.bothLower, text.onlyRival, text.bothFail][index]}>{counts[key]}／{data.samples.length}</td>)}</tr>)}</tbody></table>
      <div className="benchmark-readings">{data.sites.filter((site) => site.id !== 'maatool').map((site) => {
        const groups = comparisons.filter((item) => item.site.id === site.id)
        const count = (key: keyof typeof groups[number]['counts']) => groups.reduce((total, item) => total + item.counts[key], 0)
        return <p key={site.id}>{text.regularReading(site.label, count('onlyMaaToolPasses'), count('bothPassMaaToolHigher'), count('bothPassClose'), count('bothPassMaaToolLower'), groups.length * data.samples.length)}</p>
      })}</div>
    </section>
    <section className="benchmark-section" id="benchmark-conflicts">
      <h2>{text.conflictsTitle}</h2><p>{text.conflictsBody}</p>
      <div className="benchmark-conflicts">{data.conflicts.map((conflict, index) => {
        const item = data.cases.find((item) => item.id === conflict.caseId)!
        return <article key={conflict.caseId}>
          <p className="benchmark-muted">{data.sites.find((site) => site.id === item.site)!.label} · {item.sample}／{data.layouts.find((layout) => layout.id === item.layout)!.label}</p>
          <h3>{conflict.operator}</h3><p className="benchmark-deficit">{text.moodDeficit(conflict.start, conflict.needed)}</p>
          <ol className="benchmark-timeline">{conflict.shifts.map((shift, index) => <li key={index} style={{ flexGrow: shift.hours }}><span>{text.shift(index + 1)} · {text.hours(shift.hours)}</span><strong>{shift.roomKind ? `${text.roomTypes[shift.roomKind as keyof typeof text.roomTypes]}${shift.roomIndex}` : text.unassigned}</strong></li>)}</ol>
          <p>{text.conflicts[index]}</p><Link className="benchmark-link" to={benchmarkCasePath(item)}>{text.inspectCase}<NextIcon size={16} aria-hidden="true" /></Link>
        </article>
      })}</div>
    </section>
    <section className="benchmark-section" id="benchmark-yield">
      <h2>{text.yieldTitle}</h2><p>{text.yieldBody}</p>
      <table className="benchmark-table benchmark-stack-table"><thead><tr>{[text.layout, text.rival, text.paired, text.medianGain, text.pairedSamples].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{comparisons.map(({ layout, site, pairs, median }) => <tr key={`${layout.id}-${site.id}`}><th scope="row">{layout.label}</th><td data-label={text.rival}>{site.label}</td><td data-label={text.paired}>{pairs.length}／{data.samples.length}</td><td data-label={text.medianGain}>{median === null ? '—' : `${median > 0 ? '+' : ''}${number(median)}%`}</td><td data-label={text.pairedSamples}>{pairs.length ? pairs.map((pair) => pair.sample).join('、') : text.noPair}</td></tr>)}</tbody></table>
    </section>
    <section className="benchmark-section" id="benchmark-orundum">
      <h2>{text.orundumTitle}</h2><p>{text.orundumBody}</p>
      <table className="benchmark-table benchmark-stack-table"><thead><tr>{text.orundumHeads.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.sites.map((site) => {
        const cases = data.cases.filter((item) => item.site === site.id && item.layout === 'S3')
        const values = [text.passCount(cases.filter((item) => item.passed).length, cases.length), number(benchmarkMedian(cases.map((item) => item.opportunityCost!.perOrundum)), 4), number(benchmarkMedian(cases.map((item) => item.resources.orundum)), 1), number(benchmarkMedian(cases.map((item) => item.resources.shardsNet))), number(benchmarkMedian(cases.map((item) => item.resources.goldNet)))]
        return <tr key={site.id}><th scope="row">{site.label}</th>{values.map((value, index) => <td key={index} data-label={text.orundumHeads[index + 1]}>{value}</td>)}</tr>
      })}</tbody></table>
      <p className="benchmark-muted">{text.orundumNote}</p><details className="benchmark-disclosure"><summary>{text.orundumFormula.split('＝')[0]}</summary><p>{text.orundumFormula}</p></details>
    </section>
    <details className="benchmark-disclosure benchmark-changes"><summary>{text.changesTitle}</summary><p>{text.changesBody}</p>
      <table className="benchmark-table benchmark-stack-table"><thead><tr>{text.changeHeads.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.maatoolChanges.map((item) => <tr key={`${item.account}-${item.scenario}`}><th scope="row">{item.account}</th><td data-label={text.layout}>{data.layouts.find((layout) => layout.id === item.scenario)!.label}</td>{[number(item.previous, item.scenario === 'S3' ? 4 : 2), number(item.current, item.scenario === 'S3' ? 4 : 2), item.delta === null ? '—' : `${item.delta > 0 ? '+' : ''}${number(item.delta, item.scenario === 'S3' ? 4 : 2)}`, item.previousPassed === null ? text.notScored : item.previousPassed ? text.passLabel : text.failureLabel, item.passed ? text.passLabel : text.failureLabel].map((value, index) => <td key={index} data-label={text.changeHeads[index + 2]}>{value}</td>)}</tr>)}</tbody></table>
    </details>
    <BenchmarkResults />
    <section className="benchmark-section" id="benchmark-method">
      <h2>{text.methodTitle}</h2><dl className="benchmark-methods">{text.methods.map(([title, body]) => <div key={title}><dt>{title}</dt><dd>{body}</dd></div>)}</dl>
      <details className="benchmark-disclosure"><summary>{text.configurations}</summary><div className="benchmark-configurations">{data.layouts.map((layout) => <section key={layout.id}><h3>{layout.label}</h3><dl>{[[text.trading, layout.config.trading_station_levels], [text.manufacture, layout.config.manufacturing_station_levels], [text.power, layout.powerLevels], [text.dormitory, layout.dormitoryLevels]].map(([label, levels]) => <div key={String(label)}><dt>{label}</dt><dd>{(levels as number[]).join('／')}</dd></div>)}</dl><p>{Object.entries(layout.config.product_requirements.trading_stations).map(([product, count]) => `${text.products[product as keyof typeof text.products]}×${count}`).join(' · ')}</p><p>{Object.entries(layout.config.product_requirements.manufacturing_stations).map(([product, count]) => `${text.products[product as keyof typeof text.products]}×${count}`).join(' · ')}</p></section>)}</div></details>
      <details className="benchmark-disclosure"><summary>{text.samplesTitle}</summary><dl className="benchmark-samples">{data.samples.map((sample) => <div key={sample.alias}><dt>{sample.alias} · {text.inputSummary(sample.owned, sample.elite2)}</dt><dd><span>{text.fingerprint}</span><code>{sample.rosterSha256}</code></dd></div>)}</dl></details>
      <details className="benchmark-disclosure"><summary>{text.generationTitle}</summary><dl className="benchmark-versions"><div><dt>{text.simulator}</dt><dd><code>{data.simulatorVersion}</code></dd></div><div><dt>{data.sites[0].label}</dt><dd>{data.generation.maatool}</dd></div><div><dt>{data.sites[1].label}</dt><dd>{data.generation.yituliuData} · {data.generation.yituliuEngine}</dd></div><div><dt>{data.sites[2].label}</dt><dd><code>{data.generation.riicClient}</code></dd></div></dl></details>
    </section>
    <section className="benchmark-section" id="benchmark-downloads"><h2>{text.downloadsTitle}</h2><p>{text.downloadsBody}</p><div className="benchmark-downloads">{text.downloads.map(([file, label, format]) => <a key={file} href={`${BENCHMARK_ASSETS}/${file}`} download><ExportIcon size={18} aria-hidden="true" /><span>{label}</span><small>{format}</small></a>)}</div><p className="benchmark-fingerprint">{text.sourceFingerprint}<code>{data.sourceManifestSha256}</code></p></section>
    <footer className="benchmark-cta"><SuccessIcon size={24} aria-hidden="true" /><div><p>{text.footer}</p><Link className="v2-button v2-button-primary" to={v2Path('generation')}>{text.generate}<NextIcon size={16} aria-hidden="true" /></Link></div></footer>
  </article>
}
