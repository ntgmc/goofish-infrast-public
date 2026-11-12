import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { motion } from 'motion/react'
import { CloseIcon } from '../icons'
import { Dialog, DialogClose } from './dialog'
import { motionTokens } from '../MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'
import './shared-card-dialog.css'

export default function SharedCardDialog({ layoutId, onClose, closeLabel, children, className = '', stationaryContent = false }: {
  layoutId: string
  onClose: (surface: HTMLDivElement | null) => void
  closeLabel: string
  children: ReactNode
  className?: string
  stationaryContent?: boolean
}) {
  const reduced = useAppReducedMotion()
  const opener = useRef<HTMLElement | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const guard = (event: WheelEvent) => {
      if (event.ctrlKey) return
      if (!surface.current?.contains(event.target as Node)) event.preventDefault()
    }
    // Keep background scrolling contained without delaying interaction inside the dialog.
    document.addEventListener('wheel', guard, { capture: true, passive: false })
    return () => document.removeEventListener('wheel', guard, true)
  }, [])
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(surface.current) }}>
    <DialogPrimitive.Portal forceMount>
      <DialogPrimitive.Overlay forceMount asChild>
        <motion.div className="shared-card-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.2 }} />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content forceMount asChild aria-modal="true"
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }) }
        }}>
        <motion.div ref={surface} layoutId={reduced || stationaryContent ? undefined : layoutId}
          className={`v2-dialog shared-card-dialog ${className}`} data-stationary-content={stationaryContent || undefined}
          style={{ borderRadius: 8 }} initial={false}
          transition={reduced ? { duration: 0 } : motionTokens.morph}>
          {stationaryContent && <motion.div aria-hidden="true" className="shared-card-surface" layoutId={reduced ? undefined : layoutId} initial={false}
            style={{ borderRadius: 8 }} transition={reduced ? { duration: 0 } : motionTokens.morph} />}
          <DialogClose asChild><motion.button layout={reduced ? false : 'position'} type="button" className="v2-icon-button shared-card-close" aria-label={closeLabel} transition={motionTokens.morph}><CloseIcon size={20} aria-hidden="true" /></motion.button></DialogClose>
          <motion.div layout={reduced ? false : 'position'} layoutScroll className="shared-card-scroll" transition={motionTokens.morph}>{children}</motion.div>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </Dialog>
}
