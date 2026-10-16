import type { OperationsTodos } from '../../src/lib/operations-drilldown'
import { query } from './postgres'
import { FEEDBACK_TODO_SQL } from './feedback-todo-sql'

export async function getOperationsTodos(capabilities: readonly string[]): Promise<OperationsTodos> {
  const result = await query<Omit<OperationsTodos, 'generated_at'>>(`select
    case when $1::boolean then (select count(*)::integer from user_feedback feedback where ${FEEDBACK_TODO_SQL.unassigned}) end as feedback_unassigned,
    case when $1::boolean then (select count(*)::integer from user_feedback feedback where ${FEEDBACK_TODO_SQL.reply}) end as feedback_reply,
    case when $2::boolean then (select count(*)::integer from behavior_risk_cases where status = 'pending') end as risk_pending,
    case when $3::boolean then (select count(*)::integer from optimization_dead_letters where status = 'pending_review') end as abnormal_jobs`,
  [capabilities.includes('user_view'), capabilities.includes('risk_view'), capabilities.includes('optimization_view')])
  return { ...result.rows[0]!, generated_at: new Date().toISOString() }
}
