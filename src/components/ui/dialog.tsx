import { CloseIcon as XIcon } from '../icons'
import { Dialog as DialogPrimitive } from 'radix-ui'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DialogSurfaceContext = React.createContext<string | undefined>(undefined)
const DialogSurfaceProvider = DialogSurfaceContext.Provider

function Dialog({
  modal = true,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Root>, 'modal'> & {
  modal?: true
}) {
  return <DialogPrimitive.Root data-slot="dialog" modal={modal} {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/50 duration-[var(--motion-enter)] ease-[var(--motion-ease-enter)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[var(--motion-exit)] data-[state=closed]:ease-[var(--motion-ease-exit)] motion-reduce:animate-none!',
        className,
      )}
      {...props}
    />
  )
}

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  allowOutsideDismiss?: boolean
} &
  (
    | { showCloseButton?: false; closeLabel?: never }
    | { showCloseButton: true; closeLabel: string }
  )

function DialogContent({
  className,
  children,
  showCloseButton = false,
  closeLabel,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onPointerDownOutside,
  allowOutsideDismiss = false,
  ref,
  ...props
}: DialogContentProps) {
  const surfaceClassName = React.useContext(DialogSurfaceContext)
  const opener = React.useRef<HTMLElement | null>(null)
  const content = React.useRef<HTMLDivElement | null>(null)
  const setContentRef = React.useCallback((node: HTMLDivElement | null) => {
    content.current = node
    if (typeof ref === 'function') return ref(node)
    if (ref) ref.current = node
  }, [ref])
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-modal="true"
        ref={setContentRef}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event)
          if (!allowOutsideDismiss && content.current?.querySelector('input:not([type="hidden"]):not([readonly]), textarea:not([readonly]), select, [contenteditable="true"]')) {
            event.preventDefault()
          }
        }}
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          onOpenAutoFocus?.(event)
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          const target = opener.current
          if (!event.defaultPrevented && target?.isConnected && !target.matches(':disabled') && !target.closest('[hidden], [inert]')) {
            event.preventDefault()
            target.focus({ preventScroll: true })
          }
        }}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-surface-3 bg-surface-1 p-5 text-sm text-ink-primary shadow-2xl outline-none duration-[var(--motion-enter)] ease-[var(--motion-ease-enter)] sm:p-6 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=closed]:duration-[var(--motion-exit)] data-[state=closed]:ease-[var(--motion-ease-exit)] motion-reduce:animate-none!',
          className,
          surfaceClassName,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
            >
              <XIcon aria-hidden="true" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-lg font-semibold leading-6', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm leading-6 text-ink-secondary *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-ink-primary',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogSurfaceProvider,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
}
