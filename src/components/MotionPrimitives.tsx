import type { ReactNode } from 'react'
import {
  AnimatePresence,
  motion,
  useReducedMotion,
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
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={reduceMotion ? undefined : staggerVariants}
      initial={reduceMotion ? false : 'hidden'}
      animate={reduceMotion ? undefined : 'visible'}
    >
      {children}
    </motion.div>
  )
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div className={className} variants={reduceMotion ? undefined : revealVariants}>
      {children}
    </motion.div>
  )
}

export function AnimatedValue({ value, className, accessibleLabel }: { value: string; className?: string; accessibleLabel?: string }) {
  const reduceMotion = useReducedMotion()
  return (
    <span className={`motion-value ${className ?? ''}`} aria-label={accessibleLabel ?? value}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          aria-hidden="true"
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: motionTokens.duration.instant, ease: motionTokens.ease.enter }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function MotionSkeleton({ label, rows = 3, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div className={`motion-skeleton tool-panel p-5 sm:p-6 ${className ?? ''}`} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="motion-skeleton-line h-4 w-32" aria-hidden="true" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden="true">
        {Array.from({ length: Math.max(1, Math.min(rows, 8)) }, (_, index) => (
          <div key={index} className="motion-skeleton-block h-24" />
        ))}
      </div>
    </div>
  )
}

export function MotionNavIndicator({ layoutId, variant = 'pill' }: { layoutId: string; variant?: 'pill' | 'underline' }) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className={variant === 'underline' ? 'motion-nav-indicator motion-nav-indicator--underline' : 'motion-nav-indicator'}
      transition={motionTokens.spring}
    />
  )
}
