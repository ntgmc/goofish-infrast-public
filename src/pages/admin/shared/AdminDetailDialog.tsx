import { useRef, type ReactNode } from 'react'
import { Dialog, DialogContent } from '../../../components/ui/dialog'

export function AdminDetailDialog({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        ref={dialogRef}
        aria-labelledby={labelledBy}
        className="block max-h-[calc(100dvh-2rem)] max-w-6xl border-0 bg-transparent p-0 sm:max-h-[calc(100dvh-4rem)]"
        onOpenAutoFocus={(event) => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
          event.preventDefault()
          const preferredTarget = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')
          ;(preferredTarget ?? dialogRef.current)?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
          returnFocusRef.current = null
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}
