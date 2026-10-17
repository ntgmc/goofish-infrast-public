export const FEEDBACK_TODO_SQL = {
  unassigned: "feedback.status in ('open', 'processing') and feedback.assignee is null",
  reply: `feedback.status in ('open', 'processing') and coalesce((
    select entry.actor from user_feedback_entries entry
    where entry.feedback_id = feedback.id and entry.message is not null
    order by entry.revision desc limit 1
  ), 'user') = 'user'`,
  supplement: `feedback.status in ('open', 'processing') and (
    select entry.actor from user_feedback_entries entry
    where entry.feedback_id = feedback.id and entry.message is not null
    order by entry.revision desc limit 1
  ) = 'user'`,
} as const

// Private notes and assignment changes must not reset a user's waiting time.
export const FEEDBACK_WAITING_SINCE_SQL = `case when (${FEEDBACK_TODO_SQL.reply}) then coalesce((
  select max(entry.created_at) from user_feedback_entries entry
  where entry.feedback_id = feedback.id and entry.actor = 'user' and entry.message is not null
), feedback.created_at) end`
