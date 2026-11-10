import { useRef, useState } from 'react'
import { useInView } from 'motion/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog'
import Link from '../../../components/InternalLink'
import { ExportMaaIcon, NextIcon, SelectedIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import { benchmarkNumber as number, siteBenchmark } from '../../../lib/site-benchmark'
import { useOptionalTheme } from '../../../lib/theme'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import { getUpgradePaybackDays } from '../../../lib/upgrade-suggestion-roi'
import { SAMPLE_RESULT } from '../sample-result'

const text = copy.public.pricing_story
const training = SAMPLE_RESULT.upgrade_suggestions!.filter((suggestion) => suggestion.type === 'single').find((suggestion) => suggestion.id === 'char_242_otter')!
const comparison = ['S1', 'S2'].map((layout) => siteBenchmark.cases.find((item) => item.sample === 'A01' && item.layout === layout && item.site === 'maatool')!)
const chartMaximum = Math.ceil(Math.max(...comparison.map((item) => item.resources.sanity)) / 100) * 100

export default function PricingBenefitVisual({ step }: { step: number }) {
  if (step === 0) return <Screenshot />
  if (step === 1) return <MaaDownload />
  return step === 2 ? <TrainingResult /> : <LayoutComparison />
}

function Screenshot() {
  const [open, setOpen] = useState(false)
  const theme = useOptionalTheme()?.resolvedTheme ?? 'light'
  const item = text.config
  const image = <img src={`/assets/pricing/config-strategy-${theme}.webp`} alt={item.alt} width={511} height={343} loading="lazy" decoding="async" />
  return <figure className="v2-benefit-scene v2-benefit-screenshot">
    <figcaption className="v2-benefit-caption">{item.source}</figcaption>
    <ul className="v2-benefit-config-options">{item.options.map((option) => <li key={option}><SelectedIcon size={16} aria-hidden="true" />{option}</li>)}</ul>
    <button type="button" className="v2-benefit-image" aria-label={`${text.enlarge} · ${item.source}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      {image}<span>{text.enlarge}<NextIcon size={16} aria-hidden="true" /></span>
    </button>
    <p className="v2-benefit-detail">{item.caption}</p>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="v2-dialog v2-benefit-dialog" showCloseButton closeLabel={text.close}>
        <DialogTitle>{item.source}</DialogTitle><DialogDescription>{item.caption}</DialogDescription>
        <p className="v2-benefit-pan-hint">{text.pan}</p>
        <div className="v2-benefit-zoom" tabIndex={0} role="region" aria-label={item.source}>{image}</div>
      </DialogContent>
    </Dialog>
  </figure>
}

function MaaDownload() {
  const element = useRef<HTMLElement>(null)
  const visible = useInView(element, { amount: 0.3 })
  const reduced = useAppReducedMotion()
  const item = text.exports
  return <figure ref={reduced || typeof IntersectionObserver === 'undefined' ? undefined : element} className="v2-benefit-scene v2-benefit-export" data-playing={visible && !reduced}>
    <figcaption className="v2-benefit-caption">{item.source}</figcaption>
    <div className="v2-benefit-unlimited"><strong aria-hidden="true">∞</strong><div><b>{item.unlimited}</b><span>{item.scope}</span></div></div>
    <div className="v2-benefit-export-flow" role="img" aria-label={item.flow}>
      <div className="v2-benefit-export-window" aria-hidden="true"><small>MaaTool</small><span className="v2-benefit-export-download"><ExportMaaIcon size={18} />{item.download}</span></div>
      <div className="v2-benefit-export-file" aria-hidden="true"><ExportMaaIcon size={28} /><span>JSON</span></div>
      <div className="v2-benefit-export-window" aria-hidden="true"><small>MAA</small><span className="v2-benefit-export-select"><SelectedIcon size={18} />{item.selected}</span></div>
    </div>
    <p className="v2-benefit-detail">{item.caption}</p>
  </figure>
}

function TrainingResult() {
  const cost = training.training_cost!
  const roi = training.roi!
  return <figure className="v2-benefit-scene v2-benefit-training">
    <figcaption className="v2-benefit-caption">{text.training.source}</figcaption>
    <div className="v2-benefit-operator"><img src={`/webp96/${training.id}.webp`} alt="" width={56} height={56} loading="lazy" /><strong>{text.training.upgrade(training.name!, training.current!, training.target!)}</strong></div>
    <dl className="v2-benefit-readings">
      <div><dt>{text.training.daily}</dt><dd className="v2-benefit-gain">+{number(roi.daily_sanity_gain!)}<small>{text.training.per_day}</small></dd></div>
      <div><dt>{text.training.payback}</dt><dd>{number(getUpgradePaybackDays(training))}<small>{text.training.days}</small></dd></div>
    </dl>
    <dl className="v2-benefit-costs"><div><dt>{text.training.total}</dt><dd>{number(cost.totals.equivalent_sanity)} {text.training.sanity}</dd></div><div><dt>{text.training.missing_cost}</dt><dd>{number(cost.missing.equivalent_sanity)} {text.training.sanity}</dd></div><div><dt>{text.training.missing}</dt><dd>{cost.missing.materials.map((material) => `${material.name} × ${material.count}`).join('、')}</dd></div></dl>
    <p className="v2-benefit-detail">{text.training.caption}</p>
  </figure>
}

function LayoutComparison() {
  const item = text.comparison
  return <figure className="v2-benefit-scene v2-benefit-comparison">
    <figcaption className="v2-benefit-caption">{item.source(siteBenchmark.date)}</figcaption>
    <p className="v2-benefit-chart-title">{item.metric}</p>
    <div className="v2-benefit-chart" role="img" aria-label={item.chart(number(comparison[0].resources.sanity), number(comparison[1].resources.sanity))}>
      {comparison.map((result) => <div className="v2-benefit-chart-row" key={result.id}>
        <span>{siteBenchmark.layouts.find((layout) => layout.id === result.layout)!.label}</span>
        <div className="v2-benefit-chart-track"><div style={{ width: `${result.resources.sanity / chartMaximum * 100}%` }} /></div>
        <strong>{number(result.resources.sanity)}</strong>
      </div>)}
      <div className="v2-benefit-chart-axis"><span>0</span><span>{chartMaximum}</span></div>
    </div>
    <div className="v2-benefit-outputs">{comparison.map((result) => <section key={result.id}>
      <h4>{siteBenchmark.layouts.find((layout) => layout.id === result.layout)!.label}</h4>
      <dl><div><dt>{item.lmd}</dt><dd>{number(result.resources.lmd, 0)}</dd></div><div><dt>{item.exp}</dt><dd>{number(result.resources.exp, 0)}</dd></div></dl>
    </section>)}</div>
    <p className="v2-benefit-pass"><SelectedIcon size={16} aria-hidden="true" />{item.passed}</p>
    <p className="v2-benefit-detail">{item.caption}</p>
    <Link className="v2-text-button" to="/v2/benchmarks?sample=A01&site=maatool#benchmark-data"><span>{item.evidence}</span><NextIcon size={16} aria-hidden="true" /></Link>
  </figure>
}
