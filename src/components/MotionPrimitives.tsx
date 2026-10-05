import { useEffect, useState, type ReactNode } from 'react'
import { useAppReducedMotion } from '../lib/motion-preference'
import {
  AnimatePresence,
  motion,
  type Transition,
  type Variants,
} from 'motion/react'

export const motionTokens = {
  duration: {
    instant: 0.14,
    exit: 0.12,
    enter: 0.24,
    page: 0.3,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  spring: {
    type: 'spring',
    stiffness: 420,
    damping: 34,
    mass: 0.75,
  } satisfies Transition,
}

export function PageTransition<T extends string>({ motionKey, children, className }: {
  motionKey: T
  children: (displayedKey: T) => ReactNode
  className?: string
}) {
  const reduceMotion = useAppReducedMotion()
  const [displayedKey, setDisplayedKey] = useState(motionKey)
  const exiting = !reduceMotion && displayedKey !== motionKey

  useEffect(() => {
    if (reduceMotion) setDisplayedKey(motionKey)
  }, [motionKey, reduceMotion])

  return <motion.div className={className} initial={false}
    animate={{ opacity: exiting ? 0 : 1, y: exiting ? 6 : 0 }}
    transition={{ duration: reduceMotion ? 0 : exiting ? motionTokens.duration.exit : motionTokens.duration.enter,
      ease: exiting ? motionTokens.ease.exit : motionTokens.ease.enter }}
    inert={exiting || undefined} aria-hidden={exiting || undefined}
    onAnimationComplete={() => { if (exiting) setDisplayedKey(motionKey) }}>
    {children(reduceMotion ? motionKey : displayedKey)}
  </motion.div>
}

type AnimatedPresenceRegionProps = {
  motionKey: string
  children: ReactNode
  className?: string
  id?: string
  labelledBy?: string
  role?: string
}

export function AnimatedPresenceRegion({
  motionKey,
  children,
  className,
  id,
  labelledBy,
  role,
}: AnimatedPresenceRegionProps) {
  return (
    <div
      key={motionKey}
      className={`motion-region-enter ${className ?? ''}`}
      id={id}
      role={role}
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  )
}

const staggerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.03,
      staggerChildren: 0.035,
      staggerDirection: 1,
    },
  },
}

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.enter, ease: motionTokens.ease.enter },
  },
}

export function StaggeredReveal({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useAppReducedMotion()
  if (reduceMotion) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      variants={staggerVariants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  )
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useAppReducedMotion()
  if (reduceMotion) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} variants={revealVariants}>
      {children}
    </motion.div>
  )
}

export function AnimatedValue({ value, className, accessibleLabel }: { value: string; className?: string; accessibleLabel?: string }) {
  const reduceMotion = useAppReducedMotion()
  return (
    <span className={`motion-value ${className ?? ''}`} aria-label={accessibleLabel ?? value}>
      {reduceMotion ? <span aria-hidden="true">{value}</span> : <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          aria-hidden="true"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: motionTokens.duration.instant, ease: motionTokens.ease.enter }}
        >
          {value}
        </motion.span>
      </AnimatePresence>}
    </span>
  )
}

export function MotionNavIndicator({ layoutId, variant = 'pill' }: { layoutId: string; variant?: 'pill' | 'underline' }) {
  const reduceMotion = useAppReducedMotion()
  const className = variant === 'underline' ? 'motion-nav-indicator motion-nav-indicator--underline' : 'motion-nav-indicator'
  if (reduceMotion) return <span aria-hidden="true" className={className} />
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className={className}
      transition={motionTokens.spring}
    />
  )
}
