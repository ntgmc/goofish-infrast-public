import { useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { motionTokens } from '../MotionPrimitives'
import { Button } from './button'
import { cn } from '../../lib/utils'

type MotionDrawerContentProps = {
  open: boolean
  className?: string
  closeLabel: string
  children: ReactNode
}

export function MotionDrawerContent({ open, ...props }: MotionDrawerContentProps) {
  return (
    <DialogPrimitive.Portal forceMount>
      <AnimatePresence>
        {open && <DrawerSurface key="drawer" {...props} />}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  )
}

function DrawerSurface({ className, closeLabel, children }: Omit<MotionDrawerContentProps, 'open'>) {
  const reduceMotion = useReducedMotion()
  const isPresent = useIsPresent()
  const opener = useRef<HTMLElement | null>(null)
  const duration = reduceMotion ? motionTokens.duration.exit : motionTokens.duration.page

  return (
    <>
      <DialogPrimitive.Overlay forceMount asChild>
        <motion.div className="fixed inset-0 z-50 bg-black/50" aria-hidden="true"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: isPresent ? duration : motionTokens.duration.exit }} />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content forceMount asChild aria-modal="true"
        aria-hidden={isPresent ? undefined : true} inert={isPresent ? undefined : true}
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }}>
        <motion.div data-slot="dialog-content"
          className={cn('fixed inset-y-0 right-0 z-50 grid max-h-dvh w-full max-w-lg gap-5 overflow-y-auto overscroll-contain border border-surface-3 bg-surface-1 p-6 text-sm text-ink-primary shadow-2xl outline-none', className)}
          initial={{ opacity: 0, x: reduceMotion ? 0 : 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : 24 }}
          transition={{ duration: isPresent ? duration : motionTokens.duration.exit, ease: isPresent ? motionTokens.ease.enter : motionTokens.ease.exit }}
        >
          {children}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" className="absolute top-2 right-2">
              <XIcon aria-hidden="true" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </DialogPrimitive.Close>
        </motion.div>
      </DialogPrimitive.Content>
    </>
  )
}
