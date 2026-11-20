import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExpandIcon, GenerateIcon, LoadingIcon } from '../../components/icons'
import { useInternalHref } from '../../components/InternalLink'
import { copy } from '../../copy'
import { formatPoints } from '../../lib/balance-contracts'
import { askWorkspaceAssistant, readWorkspaceAssistant } from '../../lib/workspace-assistant-client'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { WORKSPACE_ASSISTANT_FEATURES } from '../../lib/site-features'
import type { WorkspaceAssistantReply, WorkspaceAssistantRequest } from '../../lib/workspace-assistant'
import { Notice } from './components/WorkspaceUI'
import './workspace-assistant.css'

const text = copy.v2.workspaceAssistant

type Props = {
  task: WorkspaceAssistantRequest['task']
  title: string
  userId: string
  profileId: string
  description: string
  example?: string
  fixedQuestion?: string
  visible?: boolean
  disabled?: boolean
  revision?: string
  renderControls?: (busy: boolean) => ReactNode
  buildRequest: (question: string) => WorkspaceAssistantRequest
  renderReply: (reply: WorkspaceAssistantReply) => ReactNode
}

export default function WorkspaceAssistant(props: Props) {
  const { features, pauseNotices } = useSiteFeatures()
  const feature = WORKSPACE_ASSISTANT_FEATURES[props.task]
  const pause = pauseNotices?.[feature]
  if (pause) {
    const badge = <span className="v2-feature-pause-badge">{copy.features.paused_title}</span>
    return props.fixedQuestion ? <section className="v2-workspace-assistant v2-assistant-inline"><header className="v2-assistant-heading"><AssistantTitle title={props.title} />{badge}</header><p className="v2-workspace-assistant-body">{pause}</p></section>
      : <details className="v2-workspace-assistant"><summary className="v2-assistant-heading"><AssistantTitle title={props.title} />{badge}<ExpandIcon className="v2-assistant-chevron" size={16} aria-hidden="true" /></summary><p className="v2-workspace-assistant-body">{pause}</p></details>
  }
  return features[feature] ? <AssistantPanel key={`${props.userId}:${props.profileId}:${props.task}`} {...props} /> : null
}

function AssistantTitle({ title, description }: { title: string; description?: string }) {
  return <><span className="v2-assistant-icon"><GenerateIcon size={18} aria-hidden="true" /></span><span className="v2-assistant-title"><strong>{title}</strong>{description && <small>{description}</small>}</span></>
}

function AssistantPanel({ task, title, userId, profileId, description, example, fixedQuestion, visible, disabled, revision, renderControls, buildRequest, renderReply }: Props) {
  const id = useId()
  const resolveHref = useInternalHref()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<{ reply: WorkspaceAssistantReply; revision?: string } | null>(null)
  const reply = response?.revision === revision ? response?.reply : null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const queryKey = ['user', userId, profileId, 'workspace-assistant', task] as const
  const availability = useQuery({ queryKey, enabled: fixedQuestion ? visible !== false : open, queryFn: ({ signal }) => readWorkspaceAssistant(profileId, task, signal) })
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
      const result = await askWorkspaceAssistant({ ...buildRequest(input), accepted_points: state.credits.charge ?? '0.00' }, controller.signal)
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
        void client.invalidateQueries({ predicate: ({ queryKey: key }) => key[0] === 'user' && key[1] === userId && ['workspace-assistant', 'schedule-explanation', 'balance'].includes(String(key[3])) })
      }
    }
  }

  const reason = state?.reason
  const showBalance = reason === 'balance' || reason === 'debt'
  const action = fixedQuestion ? text.summarize : text.ask
  const actionLabel = state?.credits.charge && state.credits.charge !== '0.00' ? copy.balance.paid_action(action, formatPoints(state.credits.charge)) : action
  const content = <div className="v2-workspace-assistant-body">
    {renderControls?.(busy)}
    <form className="v2-workspace-assistant-form" onSubmit={submit} aria-describedby={id}>
      {!fixedQuestion && <label className="v2-field"><span>{text.question}</span><textarea className="v2-input" rows={2} maxLength={300} required value={question} placeholder={example} disabled={busy} onChange={(event) => { setQuestion(event.currentTarget.value); setResponse(null); setError(null) }} /></label>}
      <div className="v2-assistant-footer">
        <div id={id} className="v2-workspace-assistant-status" aria-live="polite">
          {availability.isLoading ? <p>{text.loading}</p> : availability.isError ? <p>{text.failed}</p> : <>
            {reason && <p>{text.unavailable[reason]}</p>}
            {state?.credits.price && <p>{text.pointsAvailable(formatPoints(state.credits.available))}</p>}
            {state?.available && state.provider && <p className="v2-assistant-disclosure">{fixedQuestion ? text.summaryDisclosure(state.provider) : text.disclosure(state.provider)}</p>}
          </>}
          {(availability.isError || reason === 'busy' || reason === 'pricing_changed' || showBalance) && <div className="v2-assistant-recovery">
            <button type="button" className="v2-text-button" onClick={() => void availability.refetch()}>{copy.v2.retry}</button>
            {showBalance && <a className="v2-text-button" href={resolveHref('/tool/balance')}>{copy.balance.go_to_points}</a>}
          </div>}
        </div>
        <button type="submit" className={reply ? 'v2-button v2-button-secondary' : 'v2-button v2-button-primary'} disabled={disabled || busy || !input || !state?.available || availability.isError} aria-busy={busy}>
          {busy && <LoadingIcon size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy ? text.asking : actionLabel}
        </button>
      </div>
    </form>
    <Notice error>{error}</Notice>
    {reply && <div className="v2-workspace-assistant-result" aria-live="polite">{renderReply(reply)}</div>}
  </div>
  const heading = <AssistantTitle title={title} description={description} />
  return fixedQuestion ? <section className="v2-workspace-assistant v2-assistant-inline" aria-label={title}>
    <header className="v2-assistant-heading">{heading}</header>{content}
  </section> : <details className="v2-workspace-assistant" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="v2-assistant-heading">{heading}<ExpandIcon className="v2-assistant-chevron" size={16} aria-hidden="true" /></summary>{content}
  </details>
}
