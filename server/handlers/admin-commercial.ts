import { authenticateAdminRequest, requireRootAdminPassword } from './admin-auth'
import { jsonResponse } from './license-utils'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { getBalanceSummary } from '../storage/balance-store'
import { getCommercialLimits, MeteredProfileError, updateCommercialAccount } from '../storage/metered-profile-store'
import { getUserById } from '../storage/user-store'
import { query } from '../storage/postgres'
import { getMeteredBillingPolicy } from '../../src/lib/metered-billing'

const commercialPolicy = getMeteredBillingPolicy().commercial

export default async function adminCommercialHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const auth = await authenticateAdminRequest(req, req.method === 'GET'
      ? 'sensitive_data_view'
      : { capability: 'user_manage', requireRecentLogin: true })
    if (!auth.ok) return auth.response
    if (req.method === 'GET') {
      const url = new URL(req.url)
      if (url.searchParams.get('summary') === '1') return jsonResponse(await commercialOperationalSummary())
      const userId = url.searchParams.get('user_id')?.trim() ?? ''
      if (!userId || !(await getUserById(userId))) return jsonResponse({ error: '用户不存在。', code: 'user_not_found' }, 404)
      return jsonResponse({ balance: await getBalanceSummary(userId), limits: await getCommercialLimits(userId) })
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
    const body = await getValidatedJson(req, requestSchemas.adminCommercial)
    const approval = await requireRootAdminPassword(req, body.root_password)
    if (!approval.ok) return approval.response
    return jsonResponse({ limits: await updateCommercialAccount({
      userId: body.user_id,
      activeLimit: body.active_profile_limit,
      totalLimit: body.total_profile_limit,
      suspended: body.suspended,
      reason: body.reason,
      expectedRevision: body.expected_revision,
      actorUsername: auth.username,
      approvedBy: approval.username,
      requestId: body.idempotency_key,
    }) })
  } catch (error) {
    if (error instanceof MeteredProfileError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('admin commercial error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function commercialOperationalSummary() {
  const [level1, level2, level3, level4] = commercialPolicy.tiers.map((tier) => tier.threshold_points)
  const [reservations, profiles, accounts, jobs, settledByTier, billingEvents, eligibleAccounts, activations, reconciliationCases] = await Promise.all([
    query<{ status: string; count: string; amount: string }>(`select status, count(*)::text as count, coalesce(sum(amount), 0)::text as amount from user_balance_reservations group by status`),
    query<{ state: string; count: string }>(`select case when archived_at is null then 'active' else 'archived' end as state, count(*)::text as count from user_game_accounts where kind = 'metered_commercial' group by state`),
    query<{ level: string; count: string; debt: string }>(`select case
        when lifetime_credited - qualification_reversed >= $4::numeric then '4'
        when lifetime_credited - qualification_reversed >= $3::numeric then '3'
        when lifetime_credited - qualification_reversed >= $2::numeric then '2'
        when lifetime_credited - qualification_reversed >= $1::numeric then '1'
        else '0' end as level, count(*)::text as count, coalesce(sum(debt), 0)::text as debt
      from user_balance_accounts group by level`, [level1, level2, level3, level4]),
    query<{ status: string; count: string }>(`select job.status, count(*)::text as count from optimize_jobs job where job.billing_json is not null group by job.status`),
    query<{ billing_kind: string; level: string; count: string; amount: string }>(`select billing_kind, coalesce(tier, 0)::text as level,
        count(*)::text as count, coalesce(sum(amount), 0)::text as amount
      from user_balance_reservations where status = 'consumed'
      group by billing_kind, tier order by billing_kind, tier nulls first`),
    query<{ reason_code: string; count: string }>(`select record_json->>'reason_code' as reason_code, count(*)::text as count
      from usage_events where event = 'metered_billing' group by record_json->>'reason_code'`),
    query<{ count: string }>(`select count(*)::text as count
      from user_balance_accounts account
      left join commercial_account_limits limits on limits.user_id = account.user_id
      where account.lifetime_credited - account.qualification_reversed >= $1::numeric
        and account.debt = 0 and limits.suspended_at is null`, [level1]),
    query<{ count: string }>(`select count(distinct user_id)::text as count from (
        select user_id, sum(delta) over (
          partition by user_id order by created_at, id rows between unbounded preceding and current row
        ) as cumulative_credited
        from user_balance_qualification_ledger
      ) qualification_history where cumulative_credited >= $1::numeric`, [level1]),
    query<{
      id: string
      kind: string
      user_id: string | null
      job_id: string | null
      reservation_id: string | null
      detail_json: unknown
      first_seen_at: string
      last_seen_at: string
      total: string
    }>(`select id, kind, user_id, job_id, reservation_id, detail_json,
              first_seen_at, last_seen_at, count(*) over()::text as total
         from billing_reconciliation_cases
        where status = 'pending_review'
        order by last_seen_at desc, id desc limit 100`),
  ])
  const terminalJobs = jobs.rows.filter((row) => ['succeeded', 'failed', 'cancelled', 'dead_lettered'].includes(row.status))
  const totalJobs = terminalJobs.reduce((sum, row) => sum + Number(row.count), 0)
  const succeededJobs = Number(jobs.rows.find((row) => row.status === 'succeeded')?.count ?? 0)
  return {
    reservations: reservations.rows,
    profiles: profiles.rows,
    commercial_levels: accounts.rows,
    commercial_eligible_accounts: Number(eligibleAccounts.rows[0]?.count ?? 0),
    commercial_activations: Number(activations.rows[0]?.count ?? 0),
    settled_by_tier: settledByTier.rows,
    billing_events: billingEvents.rows,
    reconciliation_anomalies: Number(reconciliationCases.rows[0]?.total ?? 0),
    reconciliation_cases: reconciliationCases.rows.map(({ total: _total, ...reconciliationCase }) => reconciliationCase),
    metered_jobs: jobs.rows,
    metered_job_success_rate: totalJobs > 0 ? succeededJobs / totalJobs : 0,
  }
}
