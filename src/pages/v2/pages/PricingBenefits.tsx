import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ConfigIcon, CultivationIcon, ExportMaaIcon, NextIcon, ScheduleComparisonIcon, SelectedIcon, TradingStationIcon, ManufactureIcon, PowerPlantIcon, DormitoryIcon, OperatorsIcon } from '../../../components/icons'
import { motionTokens } from '../../../components/MotionPrimitives'
import { copy } from '../../../copy'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import { productPolicies } from '../../../lib/product-catalog'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import './pricing-benefits.css'

const text = copy.public.pricing_story
const steps = [text.config, text.exports, text.training, text.comparison]
const icons = [ConfigIcon, ExportMaaIcon, CultivationIcon, ScheduleComparisonIcon]

export default function PricingBenefits() {
  const reduced = useAppReducedMotion()
  const { features } = useSiteFeatures()
  const section = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.find((entry) => entry.isIntersecting)
      if (entry) setActive(Number((entry.target as HTMLElement).dataset.step))
    }, { rootMargin: '-25% 0px -45% 0px' })
    section.current?.querySelectorAll('.v2-benefit-step').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [reduced])
  const quotas = productPolicies.metered_billing.scenario_quotas
  return <section ref={section} className="v2-benefit-story" aria-labelledby="pricing-benefits-title">
    <header><h2 id="pricing-benefits-title">{text.title}</h2><p>{text.description}</p></header>
    <div className="v2-benefit-content">
      <div className="v2-benefit-steps">{steps.map((step, index) => {
        const Icon = icons[index]
        return <section key={step.title} className="v2-benefit-step" data-step={index} data-active={active === index}>
          <Icon size={24} aria-hidden="true" /><h3>{step.title}</h3><p>{step.body}</p>
          {index === 1 && !features.maa_export && <p className="v2-benefit-note">{copy.public.pricing_choice.export_unavailable}</p>}
          {index === 3 && <p className="v2-benefit-note">{features.scenario_comparison ? copy.optimize.paid_preview.quotas(quotas.month, quotas.half_year, quotas.year) : copy.optimize.paid_preview.lab_unavailable}</p>}
          <div className="v2-benefit-inline"><BenefitScene step={index} /></div>
        </section>
      })}</div>
      <div className="v2-benefit-stage" data-step={active} aria-hidden="true">
        <AnimatePresence initial={false} mode="wait"><motion.div key={active} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2, ease: motionTokens.ease.enter }}><BenefitScene step={active} /></motion.div></AnimatePresence>
      </div>
    </div>
  </section>
}

function BenefitScene({ step }: { step: number }) {
  return <div className={`v2-benefit-scene v2-benefit-scene-${step}`} aria-hidden="true">
    <span className="v2-benefit-caption">{text.illustration}</span>
    {step === 0 && <>
      <div className="v2-benefit-rooms">{[TradingStationIcon, ManufactureIcon, PowerPlantIcon, DormitoryIcon].map((Icon, index) => <div key={text.config.labels[index]}><Icon size={26} /><span>{text.config.labels[index]}</span><div className="v2-benefit-room-slots">{Array.from({ length: index === 3 ? 5 : 3 }, (_, slot) => <i key={slot} />)}</div></div>)}</div>
      <div className="v2-benefit-controls">{text.config.controls.map((label) => <span key={label}><SelectedIcon size={16} />{label}</span>)}</div>
    </>}
    {step === 1 && <>
      <p className="v2-benefit-mode"><ExportMaaIcon size={18} />{text.exports.mode}</p>
      <ol className="v2-benefit-export-flow">{text.exports.labels.map((label, index) => <li key={label}><span>{index === 0 ? <ConfigIcon size={28} /> : index === 1 ? <ExportMaaIcon size={28} /> : <SelectedIcon size={28} />}</span><strong>{label}</strong>{index < 2 && <NextIcon size={20} />}</li>)}</ol>
    </>}
    {step === 2 && <>
      <div className="v2-benefit-training-flow">{text.training.flow.map((label, index) => <span key={label}>{index === 0 ? <OperatorsIcon size={24} /> : index === 1 ? <CultivationIcon size={24} /> : <ConfigIcon size={24} />}{label}</span>)}</div>
      <div className="v2-benefit-analysis">{text.training.labels.map((label) => <div key={label}><SelectedIcon size={18} /><span>{label}</span></div>)}</div>
    </>}
    {step === 3 && <>
      <div className="v2-benefit-compare">{text.comparison.labels.map((label, index) => <div key={label}><ScheduleComparisonIcon size={24} /><strong>{label}</strong><div className="v2-benefit-layout">{Array.from({ length: 6 }, (_, room) => <i key={room} data-kind={(room + index) % 3} />)}</div></div>)}</div>
      <div className="v2-benefit-controls">{text.comparison.metrics.map((label) => <span key={label}><SelectedIcon size={16} />{label}</span>)}</div>
    </>}
  </div>
}
