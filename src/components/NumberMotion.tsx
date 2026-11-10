import { animate, AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { CURRENT_LOCALE } from '../copy'
import { useAppReducedMotion } from '../lib/motion-preference'
import { motionTokens } from './MotionPrimitives'
import './number-motion.css'

export function CountUp({ value, digits = 0 }: { value: number; digits?: number }) {
  const reduced = useAppReducedMotion()
  const visual = useRef<HTMLSpanElement>(null)
  const played = useRef<number | undefined>(undefined)
  const final = value.toLocaleString(CURRENT_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  useEffect(() => {
    const element = visual.current
    if (!element || reduced || played.current === value || typeof IntersectionObserver === 'undefined') return
    let animation: ReturnType<typeof animate> | undefined
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      played.current = value
      animation = animate(0, value, {
        duration: 0.75, ease: motionTokens.ease.enter,
        onUpdate: (current) => { element.textContent = current.toLocaleString(CURRENT_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }) },
        onComplete: () => { element.textContent = final },
      })
    }, { threshold: 0.4 })
    observer.observe(element)
    return () => { observer.disconnect(); animation?.stop(); element.textContent = final }
  }, [value, digits, reduced, final])
  return <span className="number-motion number-motion-count"><span className="sr-only">{final}</span><span ref={visual} aria-hidden="true">{final}</span><span className="number-motion-size" aria-hidden="true">{final}</span></span>
}

export function TweenValue({ value, format }: { value: number; format: (value: number) => string }) {
  const reduced = useAppReducedMotion()
  const visual = useRef<HTMLSpanElement>(null)
  const current = useRef(value)
  const final = format(value)
  useLayoutEffect(() => {
    const element = visual.current
    if (!element) return
    if (reduced || current.current === value) { current.current = value; element.textContent = final; return }
    element.textContent = format(current.current)
    const animation = animate(current.current, value, {
      duration: 0.45, ease: motionTokens.ease.enter,
      onUpdate: (next) => { current.current = next; element.textContent = format(next) },
      onComplete: () => { current.current = value; element.textContent = final },
    })
    return () => animation.stop()
  }, [value, format, final, reduced])
  return <span className="number-motion number-motion-count number-motion-tween" aria-label={final} data-value={final}><span ref={visual} aria-hidden="true">{final}</span></span>
}

export function RollingValue({ value }: { value: string }) {
  const reduced = useAppReducedMotion()
  return <span className="number-motion number-motion-roll" aria-label={value}>
    {reduced ? <span aria-hidden="true">{value}</span> : <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={value} aria-hidden="true" initial={{ y: '85%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-85%', opacity: 0 }}
        transition={{ duration: 0.3, ease: motionTokens.ease.enter }}>{value}</motion.span>
    </AnimatePresence>}
  </span>
}
