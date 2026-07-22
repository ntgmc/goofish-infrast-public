import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { copy } from '../copy/index'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function PersonalUseDeclarationDialog({
  open,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean
  submitting: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setConfirmed(false)
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('input')?.focus()
    })
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = previousOverflow
      const returnFocusTarget = returnFocusRef.current
      window.requestAnimationFrame(() => {
        if (returnFocusTarget?.isConnected) returnFocusTarget.focus()
      })
    }
  }, [onClose, open, submitting])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-use-declaration-title"
        aria-describedby="personal-use-declaration-description"
        tabIndex={-1}
        className="tool-panel max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto p-5 shadow-2xl focus:outline-none sm:max-h-[calc(100dvh-4rem)] sm:p-6"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          if (focusable.length === 0) {
            event.preventDefault()
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-brand-500">
            <ShieldCheck size={18} strokeWidth={2.25} />
          </span>
          <div>
            <h2 id="personal-use-declaration-title" className="text-lg font-semibold text-ink-primary">{copy.personalUse.confirmation_title}</h2>
            <p id="personal-use-declaration-description" className="mt-3 text-sm leading-6 text-ink-secondary">{copy.personalUse.confirmation_intro}</p>
            <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy.personalUse.confirmation_commitment}</p>
            <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy.personalUse.confirmation_consequence}</p>
          </div>
        </div>

        <label className="tool-inset mt-5 flex cursor-pointer items-start gap-3 p-3 text-sm leading-6 text-ink-primary">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={submitting}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            className="mt-1 h-4 w-4 accent-brand-600"
          />
          <span>{copy.personalUse.confirmation_checkbox}</span>
        </label>

        <a href="/terms#personal-use-declaration" className="mt-4 inline-flex text-sm font-medium text-brand-500 underline underline-offset-4 hover:text-brand-400">
          {copy.personalUse.confirmation_view_terms}
        </a>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="tool-secondary-action" disabled={submitting} onClick={onClose}>{copy.personalUse.confirmation_cancel}</button>
          <button type="button" className="tool-primary-action" disabled={!confirmed || submitting} onClick={onConfirm}>
            {submitting ? copy.personalUse.confirmation_submitting : copy.personalUse.confirmation_continue}
          </button>
        </div>
      </div>
    </div>
  )
}
