import type { ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { motionTokens } from '../../components/MotionPrimitives'

export default function V2Transition({ motionKey, children, className }: {
  motionKey: string
  children: ReactNode
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div className={`v2-transition ${className ?? ''}`} layout={reduceMotion ? false : 'position'} transition={motionTokens.spring}>
      <AnimatePresence initial={false}>
        <TransitionPane key={motionKey}>{children}</TransitionPane>
      </AnimatePresence>
    </motion.div>
  )
}

function TransitionPane({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  const isPresent = useIsPresent()
  return (
    <motion.div className="v2-transition-pane" aria-hidden={isPresent ? undefined : true} inert={isPresent ? undefined : true}
      initial={reduceMotion ? false : 'enter'} animate={isPresent ? 'visible' : 'exit'} exit="exit"
      variants={{
        enter: { opacity: 0, y: reduceMotion ? 0 : 6 },
        visible: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: reduceMotion ? 0 : -4 },
      }}
      transition={{
        duration: reduceMotion || !isPresent ? motionTokens.duration.exit : motionTokens.duration.enter,
        ease: isPresent ? motionTokens.ease.enter : motionTokens.ease.exit,
      }}>
      {children}
    </motion.div>
  )
}
