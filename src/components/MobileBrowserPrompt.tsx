import { useState } from 'react'
import { DesktopIcon as Monitor } from './icons'
import { copy } from '../copy/index'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

const STORAGE_KEY = 'maatool:mobile-browser-prompt:dismissed'

export default function MobileBrowserPrompt() {
  const [open, setOpen] = useState(() => {
    if (typeof navigator === 'undefined' || !/Android.*Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent)) return false
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== 'true'
    } catch {
      return true
    }
  })

  const dismiss = () => {
    setOpen(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // Keep entry available when browser storage is disabled.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) dismiss() }}>
      <DialogContent className="max-w-sm text-center" onCloseAutoFocus={(event) => {
        event.preventDefault()
        document.querySelector<HTMLElement>('[data-route-focus]')?.focus({ preventScroll: true })
      }}>
        <span aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-600/10 text-brand-500">
          <Monitor size={24} />
        </span>
        <DialogTitle>{copy.common.mobileBrowserTitle}</DialogTitle>
        <DialogDescription>{copy.common.mobileBrowserDescription}</DialogDescription>
        <DialogClose asChild>
          <Button size="lg" className="mt-2 w-full">{copy.common.mobileBrowserContinue}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
