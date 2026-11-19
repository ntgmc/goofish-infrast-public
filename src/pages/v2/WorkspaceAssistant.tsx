import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GenerateIcon } from '../../components/icons'
import { copy } from '../../copy'
import { askWorkspaceAssistant, readWorkspaceAssistant } from '../../lib/workspace-assistant-client'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { WorkspaceAssistantReply, WorkspaceAssistantRequest } from '../../lib/workspace-assistant'
import { Notice } from './components/WorkspaceUI'
import './workspace-assistant.css'

const text = copy.v2.workspaceAssistant

type Props = {
  title: string
  userId: string
  profileId: string
  description: string
  example?: string
  fixedQuestion?: string
  disabled?: boolean
  revision?: string
  renderControls?: (busy: boolean) => ReactNode
  buildRequest: (question: string) => WorkspaceAssistantRequest
  renderReply: (reply: WorkspaceAssistantReply) => ReactNode
}

export default function WorkspaceAssistant(props: Props) {
  const { features } = useSiteFeatures()
  return features.ai_schedule_explanation ? <AssistantPanel key={`${props.userId}:${props.profileId}`} {...props} /> : null
}

function AssistantPanel({ title, userId, profileId, description, example, fixedQuestion, disabled, revision, renderControls, buildRequest, renderReply }: Props) {
  const id = useId()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<{ reply: WorkspaceAssistantReply; revision?: string } | null>(null)
  const reply = response?.revision === revision ? response?.reply : null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const queryKey = ['user', userId, profileId, 'workspace-assistant'] as const
  const availability = useQuery({ queryKey, enabled: open, queryFn: ({ signal }) => readWorkspaceAssistant(profileId, signal) })
  const state = availability.data
  const input = fixedQuestion ?? question.trim()
  useEffect(() => () => request.current?.abort(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state?.available || !input || disabled || request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(null)
    setResponse(null)
    try {
      const result = await askWorkspaceAssistant(buildRequest(input), controller.signal)
      if (!controller.signal.aborted) {
        if (result.reply) setResponse({ reply: result.reply, revision })
        client.setQueryData(queryKey, result.state)
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : text.failed)
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setBusy(false)
        void client.invalidateQueries({ predicate: ({ queryKey: key }) => key[0] === 'user' && key[1] === userId && ['workspace-assistant', 'schedule-explanation'].includes(String(key[3])) })
      }
    }
  }

  return <details className="v2-workspace-assistant" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><GenerateIcon size={18} aria-hidden="true" />{title}</summary>
    <div className="v2-workspace-assistant-body">
      <p className="v2-muted">{description}</p>
      {renderControls?.(busy)}
      <form className="v2-workspace-assistant-form" onSubmit={submit} aria-describedby={id}>
        {!fixedQuestion && <label className="v2-field"><span>{text.question}</span><textarea className="v2-input" rows={2} maxLength={300} required value={question} placeholder={example} disabled={busy} onChange={(event) => { setQuestion(event.currentTarget.value); setResponse(null); setError(null) }} /></label>}
        <div id={id} className="v2-workspace-assistant-status" aria-live="polite">
          {availability.isLoading && text.loading}
          {availability.isError && <>{text.failed} <button type="button" className="v2-text-button" onClick={() => void availability.refetch()}>{copy.v2.retry}</button></>}
          {state && <><p>{text.quota(state.quota.remaining, state.quota.limit)}</p>{state.available && state.provider && <p>{text.disclosure(state.provider)}</p>}{state.reason && <p>{text.unavailable[state.reason]}{state.reason === 'busy' && <button type="button" className="v2-text-button" onClick={() => void availability.refetch()}>{copy.v2.retry}</button>}</p>}</>}
        </div>
        <button type="submit" className="v2-button v2-button-secondary" disabled={disabled || busy || !input || !state?.available || availability.isError} aria-busy={busy}>{busy ? text.asking : fixedQuestion ? text.summarize : text.ask}</button>
      </form>
      <Notice error>{error}</Notice>
      {reply && <div className="v2-workspace-assistant-result" aria-live="polite">{renderReply(reply)}</div>}
    </div>
  </details>
}
