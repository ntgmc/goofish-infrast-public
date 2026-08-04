import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { copy } from '../copy/index'
import type { PublicPersonalUseDeclaration } from '../lib/personal-use-declaration'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function PersonalUseDeclarationDialog({
  open,
  submitting,
  declaration,
  onClose,
  onConfirm,
}: {
  open: boolean
  submitting: boolean
  declaration: PublicPersonalUseDeclaration | null
  onClose: () => void
  onConfirm: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const submittingRef = useRef(submitting)
  submittingRef.current = submitting

  useEffect(() => {
    if (open) setConfirmed(false)
  }, [declaration?.contentHash, declaration?.id, open])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('input')?.focus()
    })
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) onClose()
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
  }, [onClose, open])

  if (!open || !declaration) return null

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
            <p className="mt-1 text-xs font-medium text-ink-muted">
              {declaration.title} · {declaration.version} · {copy.personalUse.confirmation_effective_date}{declaration.effectiveDate}
            </p>
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

        <details className="tool-inset mt-4 p-3 text-sm text-ink-secondary">
          <summary className="cursor-pointer font-medium text-brand-500 underline underline-offset-4 hover:text-brand-400">
            {copy.personalUse.confirmation_view_terms}
          </summary>
          <div className="mt-4 space-y-4">
            {declaration.sections.map((section) => (
              <section key={section.id} aria-labelledby={`dialog-${section.id}`}>
                <h3 id={`dialog-${section.id}`} className="font-semibold text-ink-primary">{section.heading}</h3>
                {section.paragraphs.map((paragraph) => <p key={paragraph} className="mt-2 leading-6">{paragraph}</p>)}
                {section.items.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </details>

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
