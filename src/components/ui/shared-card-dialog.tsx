import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { motion, useIsPresent } from 'motion/react'
import { CloseIcon } from '../icons'
import { Dialog, DialogClose } from './dialog'
import { motionTokens } from '../MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'
import './shared-card-dialog.css'

export default function SharedCardDialog({ layoutId, onClose, closeLabel, children, className = '' }: {
  layoutId: string
  onClose: () => void
  closeLabel: string
  children: ReactNode
  className?: string
}) {
  const reduced = useAppReducedMotion()
  const opener = useRef<HTMLElement | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const moving = useRef(false)
  const present = useIsPresent()
  useLayoutEffect(() => {
    const guard = (event: WheelEvent) => {
      if (event.ctrlKey) return
      if ((!reduced && (moving.current || !present)) || !surface.current?.contains(event.target as Node)) event.preventDefault()
    }
    // Keep wheel input contained while the surface moves between modal and card geometry.
    document.addEventListener('wheel', guard, { capture: true, passive: false })
    return () => document.removeEventListener('wheel', guard, true)
  }, [present, reduced])
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogPrimitive.Portal forceMount>
      <DialogPrimitive.Overlay forceMount asChild>
        <motion.div className="shared-card-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }} />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content forceMount asChild aria-modal="true"
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }) }
        }}>
        <motion.div ref={surface} layoutId={reduced ? undefined : layoutId}
          onLayoutAnimationStart={() => { moving.current = true }} onLayoutAnimationComplete={() => { moving.current = false }} className={`v2-dialog shared-card-dialog ${className}`}
          style={{ borderRadius: 8 }} initial={false} exit={{ opacity: reduced ? 0 : 1 }}
          transition={reduced ? { duration: 0 } : motionTokens.morph}>
          <DialogClose asChild><button type="button" className="v2-icon-button shared-card-close" aria-label={closeLabel}><CloseIcon size={20} aria-hidden="true" /></button></DialogClose>
          <div className="shared-card-scroll">{children}</div>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </Dialog>
}
