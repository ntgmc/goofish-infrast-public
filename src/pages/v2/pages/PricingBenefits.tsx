import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useSpring, type MotionStyle } from 'motion/react'
import { ConfigIcon, CultivationIcon, ExportMaaIcon, ScheduleComparisonIcon } from '../../../components/icons'
import { motionTokens } from '../../../components/MotionPrimitives'
import { copy } from '../../../copy'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import { productPolicies } from '../../../lib/product-catalog'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import PricingBenefitVisual from './PricingBenefitVisual'
import './pricing-benefits.css'

const text = copy.public.pricing_story
const steps = [text.config, text.exports, text.training, text.comparison]
const icons = [ConfigIcon, ExportMaaIcon, CultivationIcon, ScheduleComparisonIcon]

export default function PricingBenefits() {
  const reduced = useAppReducedMotion()
  const { features } = useSiteFeatures()
  const section = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const pointerBounds = useRef<DOMRect | null>(null)
  const spotX = useMotionValue('50%'), spotY = useMotionValue('50%')
  const tiltX = useSpring(0, { stiffness: 240, damping: 30 }), tiltY = useSpring(0, { stiffness: 240, damping: 30 })
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
          <div className="v2-benefit-inline"><PricingBenefitVisual step={index} /></div>
        </section>
      })}</div>
      <div className="v2-benefit-stage" data-step={active}
        onPointerEnter={(event) => { if (!reduced && event.pointerType === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) pointerBounds.current = event.currentTarget.getBoundingClientRect() }}
        onPointerMove={(event) => {
          const bounds = pointerBounds.current
          if (reduced || !bounds || event.pointerType !== 'mouse') return
          const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
          const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
          spotX.set(`${x * 100}%`); spotY.set(`${y * 100}%`)
          tiltX.set((0.5 - y) * 4); tiltY.set((x - 0.5) * 4)
        }}
        onPointerLeave={() => { pointerBounds.current = null; tiltX.set(0); tiltY.set(0); spotX.set('50%'); spotY.set('50%') }}>
        <motion.div className="v2-benefit-showcase" style={{ '--spot-x': spotX, '--spot-y': spotY, rotateX: reduced ? 0 : tiltX, rotateY: reduced ? 0 : tiltY, transformPerspective: 1000 } as MotionStyle}>
          <AnimatePresence initial={false} mode="wait"><motion.div key={active} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: motionTokens.ease.enter }}><PricingBenefitVisual step={active} /></motion.div></AnimatePresence>
        </motion.div>
      </div>
    </div>
  </section>
}
