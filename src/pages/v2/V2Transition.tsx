import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { motion, useAnimationControls } from 'motion/react'
import { AnimatedPresenceRegion, motionTokens } from '../../components/MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'

export function V2PageTransition<T extends string>({ motionKey, children, className }: {
  motionKey: T
  children: (displayedKey: T) => ReactNode
  className?: string
}) {
  const reducedMotion = useAppReducedMotion()
  const controls = useAnimationControls()
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (!mounted.current || reducedMotion) controls.set({ opacity: 1, y: 0 })
    else void controls.start({ opacity: [0, 1], y: [4, 0], transition: { duration: 0.18, ease: motionTokens.ease.enter } })
    mounted.current = true
    return () => controls.stop()
  }, [motionKey, reducedMotion, controls])

  return <motion.div className={className} initial={false} animate={controls}>{children(motionKey)}</motion.div>
}

export default function V2Transition({ motionKey, children, className }: {
  motionKey: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`v2-transition ${className ?? ''}`}>
      <AnimatedPresenceRegion motionKey={motionKey} className="v2-transition-pane">
        {children}
      </AnimatedPresenceRegion>
    </div>
  )
}
