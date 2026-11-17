import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CloseIcon } from '../../components/icons'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { copy } from '../../copy'
import { apiJson, apiStream } from '../../lib/api-client'
import { readScheduleExplanationResponse, scheduleExplanationStateSchema } from '../../lib/schedule-explanation'
import type { OptimizeResult } from '../../lib/types'
import './schedule-explanation.css'

const text = copy.scheduleExplanation

export default function ScheduleExplanation({ userId, profileId, resultId, sample, result }: {
  userId?: string; profileId?: string; resultId?: string; sample: boolean; result: OptimizeResult
}) {
  if (sample) return <ExplanationWindow sample>
    <h3>{text.sampleTitle}</h3>
    <p>{text.sample((result.daily_production?.trading?.LMD ?? 0).toLocaleString('zh-CN'),
      ((result.daily_production?.manufacturing?.['Battle Record'] ?? 0) * 1000).toLocaleString('zh-CN'))}</p>
    <p className="v2-muted">{text.sampleAction}</p>
  </ExplanationWindow>
  return userId && profileId && resultId ? <PersonalExplanation key={`${userId}:${profileId}:${resultId}`} userId={userId} profileId={profileId} resultId={resultId} /> : null
}

function PersonalExplanation({ userId, profileId, resultId }: { userId: string; profileId: string; resultId: string }) {
  const client = useQueryClient()
  const active = useRef(true)
  const streamAbort = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState('')
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
    onMutate: () => { setDraft(''); return client.cancelQueries({ queryKey: key }) },
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
    <div className="v2-explanation-heading"><p className="v2-muted">{text.description}</p>
      {!state?.explanation && state?.available && <button className="v2-button v2-button-secondary" type="button" disabled={pending} onClick={() => mutation.mutate()}>{pending ? text.generating : text.generate}</button>}
    </div>
    {state?.explanation ? <><ExplanationMarkdown>{state.explanation.text}</ExplanationMarkdown><p className="v2-muted">{text.saved} {text.estimate}</p></> : <>
      {draft && <ExplanationMarkdown>{draft}</ExplanationMarkdown>}
      {(query.isPending || pending || state?.reason) && <p role="status">{query.isPending ? text.loading : pending ? draft ? text.streaming : text.pending : state?.reason ? text.reason[state.reason] : ''}</p>}
      {state && <p className="v2-muted">{text.quota(state.quota.remaining, state.quota.limit, state.quota.kind === 'monthly')}
        {state.quota.resets_at && <> {text.reset(new Date(state.quota.resets_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</>}</p>}
      {state?.available && state.provider && <p className="v2-muted">{text.disclosure(state.provider)}</p>}
    </>}
    {error && <p role="alert" className="v2-explanation-error">{error.message} <button type="button" className="v2-text-button" onClick={() => { mutation.reset(); void query.refetch({ cancelRefetch: false }) }}>{text.retry}</button></p>}
  </ExplanationWindow>
}

function ExplanationMarkdown({ children }: { children: string }) {
  return <div className="v2-explanation-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed
    allowedElements={['p', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br']}
    components={{ a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : children }}>{children}</ReactMarkdown></div>
}

function ExplanationWindow({ children, sample = false, busy = false }: { children: ReactNode; sample?: boolean; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ right: number; bottom: number } | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
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
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !container) return
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
    if (dragged.current) moveTo(start.right + x, start.bottom + y)
  }
  const dragHandlers = {
    onPointerDown: startDrag, onPointerMove: drag,
    onLostPointerCapture: () => { pointer.current = null },
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
    <div ref={setContainer} className="v2-dialog v2-explanation-float" style={position ?? undefined}>
      <DialogContent portalContainer={container} id={id} className="v2-dialog v2-explanation-window" aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }) }}>
        <header className="v2-explanation-titlebar">
          <DialogTitle className="sr-only">{text.title}</DialogTitle>
          <button type="button" className="v2-explanation-drag" aria-label={text.moveHint} {...dragHandlers}>
            <img src="/webp96/char_002_amiya.webp" alt="" width={36} height={36} draggable={false} /><span>{text.title}</span>{sample && <small>{text.sampleTitle}</small>}</button>
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
