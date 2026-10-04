import type { ReactNode } from 'react'
import { AnimatedPresenceRegion } from '../../components/MotionPrimitives'

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
