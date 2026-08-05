import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { copy } from '../copy/index'
import type { PublicPersonalUseDeclaration } from '../lib/personal-use-declaration'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

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
  const checkboxRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) setConfirmed(false)
  }, [declaration?.contentHash, declaration?.id, open])

  if (!declaration) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting) onClose() }}>
      <DialogContent
        aria-labelledby="personal-use-declaration-title"
        aria-describedby="personal-use-declaration-description"
        className="block max-h-[calc(100dvh-2rem)] max-w-xl sm:max-h-[calc(100dvh-4rem)]"
        onOpenAutoFocus={(event) => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
          event.preventDefault()
          checkboxRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
          returnFocusRef.current = null
        }}
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (submitting) event.preventDefault()
        }}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-brand-500">
            <ShieldCheck size={18} strokeWidth={2.25} />
          </span>
          <div>
            <DialogTitle id="personal-use-declaration-title" className="text-ink-primary">{copy.personalUse.confirmation_title}</DialogTitle>
            <p className="mt-1 text-xs font-medium text-ink-muted">
              {declaration.title} · {declaration.version} · {copy.personalUse.confirmation_effective_date}{declaration.effectiveDate}
            </p>
            <DialogDescription id="personal-use-declaration-description" className="mt-3">{copy.personalUse.confirmation_intro}</DialogDescription>
            <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy.personalUse.confirmation_commitment}</p>
            <p className="mt-3 text-sm leading-6 text-ink-secondary">{copy.personalUse.confirmation_consequence}</p>
          </div>
        </div>

        <label className="tool-inset mt-5 flex cursor-pointer items-start gap-3 p-3 text-sm leading-6 text-ink-primary">
          <input
            ref={checkboxRef}
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
      </DialogContent>
    </Dialog>
  )
}
