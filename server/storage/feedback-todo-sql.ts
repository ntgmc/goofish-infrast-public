export const FEEDBACK_TODO_SQL = {
  unassigned: "feedback.status in ('open', 'processing') and feedback.assignee is null",
  reply: `feedback.status in ('open', 'processing') and coalesce((
    select entry.actor from user_feedback_entries entry
    where entry.feedback_id = feedback.id and entry.message is not null
    order by entry.revision desc limit 1
  ), 'user') = 'user'`,
} as const
