import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { SuccessIcon as Check, AddImageIcon as ImagePlus, FeedbackIcon as MessageSquare, RemoveIcon as X } from './icons'
import { copy } from '../copy'
import { apiJson, getApiErrorMessage } from '../lib/api-client'
import { FEEDBACK_CATEGORIES, FEEDBACK_IMAGE_TYPES, FEEDBACK_MESSAGE_MAX_LENGTH, type FeedbackCategory } from '../lib/feedback-contracts'
import { prepareFeedbackImage } from '../lib/feedback-image'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Tabs } from './ui/tabs'
import FeedbackHistory from './FeedbackHistory'
import FeedbackImage from './FeedbackImage'
import './FeedbackDialog.css'

export default function FeedbackButton({ iconOnly = false, className = 'tool-secondary-action', profileId }: { iconOnly?: boolean; className?: string; profileId?: string }) {
  const text = copy.feedback
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const categoryInput = useRef<HTMLSelectElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageButton = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const errorNotice = useRef<HTMLParagraphElement>(null)
  const successClose = useRef<HTMLButtonElement>(null)
  const focusAfterImage = useRef(false)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FeedbackCategory>('schedule')
  const [message, setMessage] = useState('')
  const [attachProfile, setAttachProfile] = useState(false)
  const [resultId, setResultId] = useState('')
  const [jobId, setJobId] = useState('')
  const [attachment, setAttachment] = useState<(Awaited<ReturnType<typeof prepareFeedbackImage>> & { name: string }) | null>(null)
  const [processing, setProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [view, setView] = useState<'new' | 'history'>('new')
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const busy = processing || submitting || historyBusy

  useEffect(() => {
    const button = trigger.current
    function openHistory(event?: Event) {
      const requestedId = event instanceof CustomEvent ? event.detail as string : new URLSearchParams(window.location.search).get('feedback')
      if (!requestedId || requestedId !== 'new' && !/^[0-9a-f-]{36}$/i.test(requestedId)) return
      setFeedbackId(requestedId === 'new' ? null : requestedId)
      setView(requestedId === 'new' ? 'new' : 'history')
      setOpen(true)
    }
    button?.addEventListener('goofish:open-feedback', openHistory)
    if (document.querySelector('.feedback-trigger') === button) openHistory()
    return () => button?.removeEventListener('goofish:open-feedback', openHistory)
  }, [])

  useEffect(() => {
    if (!open) return
    if (busy) form.current?.focus()
    else if (success) successClose.current?.focus()
    else if (error) errorNotice.current?.focus()
    else if (focusAfterImage.current) imageButton.current?.focus()
    if (!busy) focusAfterImage.current = false
  }, [open, busy, success, error])

  async function selectImage(file?: File) {
    if (!file || busy) return
    setError(null)
    setProcessing(true)
    focusAfterImage.current = true
    try { setAttachment({ ...await prepareFeedbackImage(file), name: file.name }) }
    catch (caught) { setError(getApiErrorMessage(caught, text.imageProcessingFailed)) }
    finally { setProcessing(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!message.trim()) { setError(text.messageRequired); return }
    setSubmitting(true)
    setError(null)
    try {
      const context = { ...(attachProfile && profileId ? { profile_id: profileId } : {}), ...(resultId.trim() ? { result_id: resultId.trim() } : {}), ...(jobId.trim() ? { job_id: jobId.trim() } : {}) }
      const created = await apiJson<{ id: string }>('/api/user/feedback', { method: 'POST', json: { category, message: message.trim(), ...(Object.keys(context).length ? { context } : {}), ...(attachment ? { image: attachment.image } : {}) }, fallbackMessage: text.submitFailed })
      setFeedbackId(created.id)
      setSuccess(true)
      setMessage('')
      setAttachment(null)
      setAttachProfile(false); setResultId(''); setJobId('')
    } catch (caught) { setError(getApiErrorMessage(caught, text.submitFailed)) }
    finally { setSubmitting(false) }
  }

  return <>
    <button ref={trigger} type="button" className={`${className} feedback-trigger${iconOnly ? ' feedback-trigger-icon' : ''}`} aria-label={text.title}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-dialog` : undefined} title={iconOnly ? text.title : undefined}
      onClick={() => { setSuccess(false); setError(null); setView('new'); setOpen(true) }}>
      <MessageSquare size={18} aria-hidden="true" />{!iconOnly && <span>{text.title}</span>}
    </button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
      <DialogContent id={`${id}-dialog`} className="feedback-dialog"
        onOpenAutoFocus={(event) => { if (view === 'new') { event.preventDefault(); categoryInput.current?.focus() } }}
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}
        {...(busy ? { showCloseButton: false as const } : { showCloseButton: true as const, closeLabel: text.close })}>
        <DialogTitle>{text.title}</DialogTitle><DialogDescription>{text.description}</DialogDescription>
        <Tabs.Root value={view} onValueChange={(value) => { if (value === 'history') setFeedbackId(null); setView(value as typeof view) }}>
          <Tabs.List className="feedback-tabs" aria-label={text.title}>
            <Tabs.Trigger value="new" className="feedback-tab" disabled={busy}>{text.newFeedback}</Tabs.Trigger>
            <Tabs.Trigger value="history" className="feedback-tab" disabled={busy}>{text.myFeedback}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="history" className="feedback-tab-panel"><FeedbackHistory key={feedbackId ?? 'list'} initialId={feedbackId} onBusyChange={setHistoryBusy} /></Tabs.Content>
          <Tabs.Content value="new" className="feedback-tab-panel">
        {success ? <>
          <p role="status" className="feedback-success"><Check size={20} aria-hidden="true" />{text.submitted}</p>
          <button ref={successClose} type="button" className="feedback-action feedback-action-primary" onClick={() => setOpen(false)}>{text.close}</button>
          <button type="button" className="feedback-action" onClick={() => setView('history')}>{text.viewSubmitted}</button>
        </> : <form ref={form} tabIndex={-1} aria-busy={busy} onSubmit={submit} className="feedback-form">
          <label className="feedback-label"><span>{text.category}</span><select ref={categoryInput} className="tool-field feedback-field" value={category} disabled={busy} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>{FEEDBACK_CATEGORIES.map((value) => <option key={value} value={value}>{text.categories[value]}</option>)}</select></label>
          <div>
            <div className="feedback-label"><label htmlFor={`${id}-message`}>{text.message}</label><textarea id={`${id}-message`} className="tool-field feedback-field" rows={5} required maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} value={message} disabled={busy} placeholder={text.placeholder} aria-describedby={`${id}-message-hint`} onChange={(event) => setMessage(event.target.value)} /></div>
            <div className="feedback-message-meta"><p id={`${id}-message-hint`}>{text.messageHint}</p><span className="feedback-count" aria-label={`${text.characterCount} ${message.length}/${FEEDBACK_MESSAGE_MAX_LENGTH}`}>{message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}</span></div>
          </div>
          <fieldset className="grid min-w-0 gap-3"><legend className="mb-2 text-sm font-semibold">{text.context}</legend>
            {profileId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attachProfile} disabled={busy} onChange={(event) => setAttachProfile(event.target.checked)} />{text.attachProfile}</label>}
            <label className="feedback-label"><span>{text.resultId}</span><input className="tool-field feedback-field" maxLength={120} value={resultId} disabled={busy} onChange={(event) => setResultId(event.target.value)} /></label>
            <label className="feedback-label"><span>{text.jobId}</span><input className="tool-field feedback-field" maxLength={120} value={jobId} disabled={busy} onChange={(event) => setJobId(event.target.value)} /></label>
            <p className="feedback-hint">{text.contextHint}</p>
          </fieldset>
          <div className="feedback-label">
            <span id={`${id}-image-label`}>{text.image}</span>
            <input ref={fileInput} type="file" hidden accept={FEEDBACK_IMAGE_TYPES.join(',')} disabled={busy} aria-label={text.image}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void selectImage(file) }} />
            <div className="feedback-image-picker">
              <button ref={imageButton} type="button" className="feedback-action" disabled={busy} aria-describedby={`${id}-image-hint ${id}-image-name`}
                onClick={() => fileInput.current?.click()}><ImagePlus size={18} aria-hidden="true" />{attachment ? text.replaceImage : text.chooseImage}</button>
              <span id={`${id}-image-name`} className="feedback-image-name" title={attachment?.name}>{attachment?.name ?? text.noImage}</span>
            </div>
            <p id={`${id}-image-hint`} className="feedback-hint">{text.imageHint}</p>
            {processing && <p role="status" className="feedback-hint">{text.processingImage}</p>}
            {attachment && <div className="feedback-image-preview">
              <FeedbackImage src={`data:${attachment.image.type};base64,${attachment.image.base64}`} />
              <div className="feedback-image-meta"><p role="status" className="feedback-hint">{attachment.compressed ? text.imageCompressed : text.imageReady} · {Math.ceil(attachment.bytes / 1024)} KB</p>
                <button type="button" className="feedback-action" disabled={busy} onClick={() => { setAttachment(null); imageButton.current?.focus() }}><X size={16} aria-hidden="true" />{text.removeImage}</button>
              </div>
            </div>}
          </div>
          {error && <p ref={errorNotice} tabIndex={-1} role="alert" className="tool-alert tool-alert--error">{error}</p>}
          <button type="submit" className="feedback-action feedback-action-primary" disabled={busy || !message.trim()}>{submitting ? text.submitting : text.submit}</button>
        </form>}
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  </>
}
