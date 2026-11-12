import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { motion, useAnimationControls } from 'motion/react'
import { AnimatedPresenceRegion, motionTokens } from '../../components/MotionPrimitives'
import { useAppReducedMotion, useMotionPreference } from '../../lib/motion-preference'

export function V2PageTransition<T extends string>({ motionKey, children, className }: {
  motionKey: T
  children: (displayedKey: T) => ReactNode
  className?: string
}) {
  const reducedMotion = useAppReducedMotion()
  const mode = useMotionPreference()?.motionMode ?? (reducedMotion ? 'off' : 'full')
  const controls = useAnimationControls()
  const [displayedKey, setDisplayedKey] = useState(motionKey)
  const [entering, setEntering] = useState<'native' | 'fallback' | null>(null)
  const currentKey = useRef(motionKey)
  const region = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    controls.set({ opacity: 1, y: 0 })
    const commit = () => { currentKey.current = motionKey; setDisplayedKey(motionKey) }
    if (currentKey.current === motionKey || mode === 'off') {
      if (currentKey.current !== motionKey) commit()
      setEntering(null)
      return
    }
    let cancelled = false
    const finish = () => { if (!cancelled) setEntering(null) }
    if (mode === 'full' && document.startViewTransition) {
      setEntering('native')
      const transition = document.startViewTransition(() => {
        if (cancelled) return
        flushSync(commit)
      })
      void transition.ready.then(() => {
        // Lazy tool sections may mount their loading indicator after the page commits.
        if (region.current?.querySelector('.v2-section-body:not([hidden]) .v2-section-loading-region')) transition.skipTransition()
      }, () => undefined)
      void transition.finished.then(finish, finish)
      return () => { cancelled = true; transition.skipTransition() }
    }
    setEntering('fallback')
    controls.set({ opacity: 0.72, y: mode === 'reduced' ? 0 : 6 })
    commit()
    void controls.start({ opacity: 1, y: 0, transition: { duration: mode === 'reduced' ? 0.12 : 0.22, ease: motionTokens.ease.enter } }).then(finish)
    return () => { cancelled = true; controls.stop() }
  }, [motionKey, mode, controls])

  return <motion.div ref={region} className={className} data-route-pending={displayedKey !== motionKey || undefined} data-page-entering={entering ?? undefined} initial={false} animate={controls}>{children(displayedKey)}</motion.div>
}

export default function V2Transition({ motionKey, children, className, layoutScroll = false }: {
  motionKey: string
  children: ReactNode
  className?: string
  layoutScroll?: boolean
}) {
  return (
    <motion.div layoutScroll={layoutScroll} className={`v2-transition ${className ?? ''}`}>
      <AnimatedPresenceRegion motionKey={motionKey} className="v2-transition-pane">
        {children}
      </AnimatedPresenceRegion>
    </motion.div>
  )
}
