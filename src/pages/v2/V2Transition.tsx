import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { AnimatedPresenceRegion, motionTokens } from '../../components/MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'

export function V2PageTransition<T extends string>({ motionKey, children }: {
  motionKey: T
  children: (displayedKey: T) => ReactNode
}) {
  const reduceMotion = useAppReducedMotion()
  const [displayedKey, setDisplayedKey] = useState(motionKey)
  const exiting = !reduceMotion && displayedKey !== motionKey

  useEffect(() => {
    if (reduceMotion) setDisplayedKey(motionKey)
  }, [motionKey, reduceMotion])

  return <motion.div className="v2-page-transition" initial={false}
    animate={{ opacity: exiting ? 0 : 1, y: exiting ? 6 : 0 }}
    transition={{ duration: reduceMotion ? 0 : exiting ? motionTokens.duration.exit : motionTokens.duration.enter,
      ease: exiting ? motionTokens.ease.exit : motionTokens.ease.enter }}
    inert={exiting || undefined} aria-hidden={exiting || undefined}
    onAnimationComplete={() => { if (exiting) setDisplayedKey(motionKey) }}>
    {children(reduceMotion ? motionKey : displayedKey)}
  </motion.div>
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
