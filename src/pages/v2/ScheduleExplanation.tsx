import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { animate } from 'motion/react'
import { CloseIcon, GenerateIcon } from '../../components/icons'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { copy } from '../../copy'
import { apiJson, apiStream } from '../../lib/api-client'
import { readScheduleExplanationResponse, scheduleExplanationStateSchema } from '../../lib/schedule-explanation'
import type { OptimizeResult } from '../../lib/types'
import { useAppReducedMotion } from '../../lib/motion-preference'
import ExplanationMarkdown from './ExplanationMarkdown'
import './schedule-explanation.css'

const text = copy.scheduleExplanation

export default function ScheduleExplanation({ userId, profileId, resultId, sample, result }: {
  userId?: string; profileId?: string; resultId?: string; sample: boolean; result: OptimizeResult
}) {
  if (sample) return <ExplanationWindow sample>
    <div className="v2-explanation-body"><h3>{text.sampleTitle}</h3>
      <p>{text.sample((result.daily_production?.trading?.LMD ?? 0).toLocaleString('zh-CN'),
        ((result.daily_production?.manufacturing?.['Battle Record'] ?? 0) * 1000).toLocaleString('zh-CN'))}</p></div>
    <p className="v2-explanation-note">{text.sampleAction}</p>
  </ExplanationWindow>
  return userId && profileId && resultId ? <PersonalExplanation key={`${userId}:${profileId}:${resultId}`} userId={userId} profileId={profileId} resultId={resultId} /> : null
}

function PersonalExplanation({ userId, profileId, resultId }: { userId: string; profileId: string; resultId: string }) {
  const client = useQueryClient()
  const active = useRef(true)
  const streamAbort = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState('')
  const revealed = useRef(0)
  useEffect(() => { active.current = true; return () => { active.current = false; streamAbort.current?.abort() } }, [])
  const key = ['user', userId, profileId, 'schedule-explanation', resultId]
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiJson<unknown>(`/api/user/schedule-explanation?${new URLSearchParams({ profile_id: profileId, result_id: resultId })}`, { signal, fallbackMessage: text.failed }).then(parseState),
    refetchInterval: (query) => query.state.data?.pending ? 2500 : false,
  })
  const mutation = useMutation({
    mutationFn: () => {
      streamAbort.current = new AbortController()
      return apiStream('/api/user/schedule-explanation', {
        method: 'POST', json: { profile_id: profileId, result_id: resultId }, headers: { Accept: 'text/event-stream' },
        signal: streamAbort.current.signal, timeoutMs: 105000, fallbackMessage: text.failed,
      }, (response) => readScheduleExplanationResponse(response, (delta) => { if (active.current) setDraft((value) => value + delta) }))
    },
    retry: false,
    onMutate: () => { setDraft(''); revealed.current = 0; return client.cancelQueries({ queryKey: key }) },
    onSuccess: async (data) => {
      if (!active.current || !client.getQueryState(key)) return
      setDraft('')
      client.setQueryData(key, data)
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'user' && query.queryKey[1] === userId && query.queryKey[3] === 'schedule-explanation' })
    },
    onError: () => { if (active.current) { setDraft(''); void query.refetch({ cancelRefetch: false }) } },
    onSettled: () => { streamAbort.current = null },
  })
  const state = query.data
  const pending = mutation.isPending || state?.pending
  const error = (state?.explanation ? null : mutation.error) ?? query.error
  return <ExplanationWindow busy={Boolean(pending)}>
    {state?.explanation ? <>
      <ExplanationMarkdown>{state.explanation.text}</ExplanationMarkdown>
      <div className="v2-explanation-notes"><p>{text.saved}</p><p>{text.estimate}</p></div>
    </> : <>
      {(query.isPending || pending || state?.reason) && <p role="status" className="v2-explanation-status" data-writing={Boolean(pending) || undefined}>
        {pending && <span className="v2-explanation-ink-dots" aria-hidden="true"><i /><i /><i /></span>}
        {query.isPending ? text.loading : pending ? draft ? text.streaming : text.pending : state?.reason ? text.reason[state.reason] : ''}</p>}
      {draft && <ExplanationMarkdown revealed={revealed}>{draft}</ExplanationMarkdown>}
      {!pending && <>
        <div className="v2-explanation-heading"><p>{text.description}</p>
          {state?.available && <button className="v2-explanation-generate" type="button" onClick={() => mutation.mutate()}><GenerateIcon size={16} aria-hidden="true" />{text.generate}</button>}
        </div>
        {state && <div className="v2-explanation-notes"><p>{text.quota(state.quota.remaining, state.quota.limit, state.quota.kind === 'monthly')}</p>
          {state.quota.resets_at && <p>{text.reset(new Date(state.quota.resets_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>}
          {state.available && state.provider && <p>{text.disclosure(state.provider)}</p>}</div>}
      </>}
    </>}
    {error && <div role="alert" className="v2-explanation-error"><p>{error.message}</p><button type="button" className="v2-text-button" onClick={() => { mutation.reset(); void query.refetch({ cancelRefetch: false }) }}>{text.retry}</button></div>}
  </ExplanationWindow>
}

function ExplanationWindow({ children, sample = false, busy = false }: { children: ReactNode; sample?: boolean; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ right: number; bottom: number } | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const feedback = useRef<ReturnType<typeof animate> | null>(null)
  const reducedMotion = useAppReducedMotion()
  const [dragging, setDragging] = useState(false)
  const pointer = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null)
  const dragged = useRef(false)
  const id = useId()
  const moveTo = useCallback((right: number, bottom: number) => {
    const rect = container?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(0, document.querySelector('.v2-main')?.getBoundingClientRect().left ?? 0)
    const next = {
      right: Math.max(8, Math.min(right, document.documentElement.getBoundingClientRect().width - left - rect.width - 8)),
      bottom: Math.max(8, Math.min(bottom, window.innerHeight - rect.height - 8)),
    }
    setPosition((current) => current?.right === next.right && current?.bottom === next.bottom ? current : next)
  }, [container])
  useEffect(() => {
    if (!container) return
    const keepVisible = () => {
      const rect = container.getBoundingClientRect()
      moveTo(document.documentElement.getBoundingClientRect().width - rect.right, window.innerHeight - rect.bottom)
    }
    const observer = new ResizeObserver(keepVisible)
    observer.observe(container)
    const workspace = document.querySelector('.v2-main')
    if (workspace) observer.observe(workspace)
    window.addEventListener('resize', keepVisible)
    return () => { observer.disconnect(); window.removeEventListener('resize', keepVisible) }
  }, [container, moveTo])
  useEffect(() => {
    if (open && panel.current && !reducedMotion) {
      feedback.current = animate(panel.current, { opacity: [0, 1], scale: [.97, 1], y: [8, 0] },
        { type: 'spring', stiffness: 440, damping: 25, mass: .7 })
    }
    return () => { feedback.current?.complete(); feedback.current?.stop() }
  }, [open, reducedMotion])
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !container) return
    feedback.current?.complete()
    const rect = container.getBoundingClientRect()
    pointer.current = { x: event.clientX, y: event.clientY, right: document.documentElement.getBoundingClientRect().width - rect.right, bottom: window.innerHeight - rect.bottom }
    dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function drag(event: PointerEvent<HTMLButtonElement>) {
    const start = pointer.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const x = start.x - event.clientX, y = start.y - event.clientY
    if (Math.hypot(x, y) > 4) dragged.current = true
    if (dragged.current) { setDragging(true); moveTo(start.right + x, start.bottom + y) }
  }
  function endDrag() {
    if (!pointer.current) return
    pointer.current = null
    setDragging(false)
    if (dragged.current && container && !reducedMotion) {
      // Keep text at its native scale; only the portrait responds to release.
      feedback.current = animate(container.querySelectorAll('.v2-explanation-avatar > img'), { scale: [.997, 1] },
        { type: 'spring', stiffness: 640, damping: 32, mass: .55, restDelta: .00005, restSpeed: .001 })
    }
  }
  const dragHandlers = {
    onPointerDown: startDrag, onPointerMove: drag,
    onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const steps: Record<string, [number, number]> = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, 24], ArrowDown: [0, -24] }
      const step = steps[event.key], rect = container?.getBoundingClientRect()
      if (step && rect) {
        event.preventDefault()
        moveTo(document.documentElement.getBoundingClientRect().width - rect.right + step[0], window.innerHeight - rect.bottom + step[1])
      }
    },
  }
  return createPortal(<Dialog modal={false} open={open} onOpenChange={setOpen}>
    <div ref={setContainer} className="v2-dialog v2-explanation-float" style={position ?? undefined} data-dragging={dragging || undefined}>
      <DialogContent ref={panel} portalContainer={container} id={id} className="v2-dialog v2-explanation-window" aria-describedby={undefined}
        onOpenAutoFocus={(event) => { event.preventDefault(); panel.current?.focus({ preventScroll: true }) }}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }) }}>
        <header className="v2-explanation-titlebar">
          <DialogTitle className="sr-only">{text.title}</DialogTitle>
          <button type="button" className="v2-explanation-drag" aria-label={text.moveHint} {...dragHandlers}>
            <img src="/webp96/char_002_amiya.webp" alt="" width={36} height={36} draggable={false} /><span className="v2-explanation-identity"><span>{text.title}</span><small>{sample ? text.sampleTitle : text.context}</small></span></button>
          <DialogClose className="v2-icon-button" aria-label={text.close}><CloseIcon size={20} aria-hidden="true" /></DialogClose>
        </header>
        <div className="v2-explanation-content" aria-busy={busy}>{children}</div>
      </DialogContent>
      <button ref={trigger} type="button" className="v2-explanation-launcher" aria-label={text.title} aria-description={text.moveHint} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
        {...dragHandlers} onClick={(event) => { if (!dragged.current || event.detail === 0) setOpen(!open) }}>
        <span className="v2-explanation-invitation">{open ? text.collapse : text.launcher}</span>
        <span className="v2-explanation-avatar"><img src="/webp96/char_002_amiya.webp" alt="" width={64} height={64} draggable={false} /><span className="v2-explanation-badge" aria-hidden="true">AI</span>
          {busy && <span className="v2-explanation-dot" aria-hidden="true" />}</span>
      </button>
    </div>
  </Dialog>, document.body)
}

function parseState(value: unknown) {
  const parsed = scheduleExplanationStateSchema.safeParse(value)
  if (!parsed.success) throw new Error(text.failed)
  return parsed.data
}
