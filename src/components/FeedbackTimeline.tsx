import { copy, CURRENT_LOCALE } from '../copy'
import type { FeedbackDetail } from '../lib/feedback-contracts'
import FeedbackImage from './FeedbackImage'

function feedbackTime(value: string) {
  return new Intl.DateTimeFormat(CURRENT_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function FeedbackTimeline({ data, admin = false, loading, onOlder }: {
  data: FeedbackDetail; admin?: boolean; loading: boolean; onOlder: () => void
}) {
  const text = copy.feedback
  const statuses = admin ? text.adminStatuses : text.statuses
  return <section className="feedback-timeline" aria-label={text.history}>
    <h3 className="text-sm font-semibold">{text.history}</h3>
    {data.next_before_revision && <button type="button" className="tool-secondary-action mt-3" disabled={loading} onClick={onOlder}>{text.older}</button>}
    <ol className="feedback-conversation">
      <li className="feedback-message feedback-message--user">
        <div className="feedback-message-heading"><span>{text.message}</span><time dateTime={data.feedback.created_at}>{feedbackTime(data.feedback.created_at)}</time></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{data.feedback.message}</p>
        {data.feedback.has_image && <FeedbackImage src={`/api/${admin ? 'admin' : 'user'}/feedback?image_id=${data.feedback.id}`} />}
      </li>
      {data.entries.length === 0 && <li className="feedback-event">{text.noHistory}</li>}
      {data.entries.map((entry) => <li key={entry.revision} className={entry.message || (admin && entry.internal_note) ? `feedback-message feedback-message--${entry.actor}` : 'feedback-event'}>
      <div className="feedback-message-heading"><span>{entry.actor === 'user' ? text.userActor : entry.message ? text.adminActor : text.feedbackUpdated}{admin && entry.actor === 'admin' && entry.actor_username && ` · ${entry.actor_username}`}</span><time dateTime={entry.created_at}>{feedbackTime(entry.created_at)}</time></div>
      {entry.previous_status !== entry.status && <p className="mt-2 text-xs text-ink-secondary">{statuses[entry.previous_status]} → {statuses[entry.status]}</p>}
      {admin && entry.previous_assignee !== entry.assignee && <p className="mt-2 break-words text-xs text-ink-secondary">{text.assignmentUpdated}：{entry.assignee ?? text.unassigned}</p>}
      {entry.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{entry.message}</p>}
      {admin && entry.internal_note && <div className="mt-3 border-l-2 border-surface-3 pl-3"><p className="text-xs font-semibold text-ink-secondary">{text.internalOnly}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-7">{entry.internal_note}</p></div>}
    </li>)}</ol>
  </section>
}
