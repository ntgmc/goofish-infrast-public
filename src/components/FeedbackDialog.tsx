import { useId, useRef, useState, type FormEvent } from 'react'
import { MessageSquare } from 'lucide-react'
import { copy } from '../copy'
import { apiJson, getApiErrorMessage } from '../lib/api-client'
import { FEEDBACK_CATEGORIES, FEEDBACK_IMAGE_TYPES, FEEDBACK_MESSAGE_MAX_LENGTH, type FeedbackCategory } from '../lib/feedback-contracts'
import { prepareFeedbackImage } from '../lib/feedback-image'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export default function FeedbackButton({ iconOnly = false, className = 'tool-secondary-action' }: { iconOnly?: boolean; className?: string }) {
  const text = copy.feedback
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FeedbackCategory>('schedule')
  const [message, setMessage] = useState('')
  const [attachment, setAttachment] = useState<Awaited<ReturnType<typeof prepareFeedbackImage>> | null>(null)
  const [processing, setProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [inputRevision, setInputRevision] = useState(0)
  const busy = processing || submitting

  async function selectImage(file?: File) {
    if (!file) return
    setError(null)
    setProcessing(true)
    try { setAttachment(await prepareFeedbackImage(file)) }
    catch (caught) { setError(getApiErrorMessage(caught, text.imageProcessingFailed)) }
    finally { setProcessing(false); setInputRevision((current) => current + 1) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!message.trim()) { setError(text.messageRequired); return }
    setSubmitting(true)
    setError(null)
    try {
      await apiJson('/api/user/feedback', { method: 'POST', json: { category, message: message.trim(), ...(attachment ? { image: attachment.image } : {}) }, fallbackMessage: text.submitFailed })
      setSuccess(true)
      setMessage('')
      setAttachment(null)
      setInputRevision((current) => current + 1)
    } catch (caught) { setError(getApiErrorMessage(caught, text.submitFailed)) }
    finally { setSubmitting(false) }
  }

  return <>
    <button ref={trigger} type="button" className={className} aria-label={text.title} title={iconOnly ? text.title : undefined} onClick={() => { setSuccess(false); setError(null); setOpen(true) }}>
      <MessageSquare size={18} aria-hidden="true" />{!iconOnly && text.title}
    </button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }} {...(busy ? { showCloseButton: false as const } : { showCloseButton: true as const, closeLabel: text.close })}>
        <DialogTitle>{text.title}</DialogTitle><DialogDescription>{text.description}</DialogDescription>
        {success ? <><p role="status" className="text-ink-secondary">{text.submitted}</p><button type="button" className="tool-primary-action" onClick={() => setOpen(false)}>{text.close}</button></> : <form onSubmit={submit} className="grid min-w-0 gap-4">
          <label className="grid gap-2"><span>{text.category}</span><select className="tool-field w-full" value={category} disabled={busy} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>{FEEDBACK_CATEGORIES.map((value) => <option key={value} value={value}>{text.categories[value]}</option>)}</select></label>
          <label className="grid gap-2"><span>{text.message}</span><textarea className="tool-field w-full resize-y" rows={5} required maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} value={message} disabled={busy} placeholder={text.placeholder} aria-describedby={`${id}-message-hint`} onChange={(event) => setMessage(event.target.value)} /></label>
          <p id={`${id}-message-hint`} className="text-xs text-ink-muted">{text.messageHint} {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}</p>
          <label className="grid min-w-0 gap-2"><span>{text.image}</span><input key={inputRevision} type="file" accept={FEEDBACK_IMAGE_TYPES.join(',')} disabled={busy} aria-describedby={`${id}-image-hint`} className="tool-field min-w-0 w-full" onChange={(event) => void selectImage(event.target.files?.[0])} /></label>
          <p id={`${id}-image-hint`} className="text-xs leading-5 text-ink-muted">{text.imageHint}</p>
          {processing && <p role="status">{text.processingImage}</p>}
          {attachment && <div className="grid min-w-0 gap-2"><img src={`data:${attachment.image.type};base64,${attachment.image.base64}`} alt={text.imagePreview} className="max-h-48 max-w-full justify-self-start rounded object-contain" /><p role="status" className="text-xs text-ink-muted">{attachment.compressed ? text.imageCompressed : text.imageReady} · {Math.ceil(attachment.bytes / 1024)} KB</p><button type="button" className="tool-secondary-action justify-self-start" disabled={busy} onClick={() => setAttachment(null)}>{text.removeImage}</button></div>}
          {error && <p role="alert" className="tool-alert tool-alert--error">{error}</p>}
          <button type="submit" className="tool-primary-action w-full" disabled={busy || !message.trim()}>{submitting ? text.submitting : text.submit}</button>
        </form>}
      </DialogContent>
    </Dialog>
  </>
}
