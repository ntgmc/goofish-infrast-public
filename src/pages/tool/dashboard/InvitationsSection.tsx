import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../../lib/api-client'
import type { InvitationSummary, RewardBalance } from '../../../lib/types'
import { copy, CURRENT_LOCALE } from '../../../copy/index'


export default function InvitationsSection() {
  const [summary, setSummary] = useState<InvitationSummary | null>(null)
  const [balance, setBalance] = useState<RewardBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [invitation, rewards] = await Promise.all([
        apiJson<InvitationSummary>('/api/user/invitations'),
        apiJson<{ balances?: RewardBalance[] }>('/api/user/rewards'),
      ])
      setSummary(invitation)
      setBalance(rewards.balances?.find((item) => item.type === 'priority_compute_coupon') ?? null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const absoluteShareUrl = useMemo(() => {
    if (!summary?.share_url) return null
    return new URL(summary.share_url, window.location.origin).toString()
  }, [summary?.share_url])

  const generateCode = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await apiJson('/api/user/invitations/code', { method: 'POST', fallbackMessage: copy.dashboard.pages_tool_dashboard_InvitationsSection_001 })
      await load()
      setNotice(copy.dashboard.pages_tool_dashboard_InvitationsSection_002)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(`${label}${copy.dashboard.pages_tool_dashboard_InvitationsSection_003}`)
      setError(null)
    } catch {
      setError(copy.dashboard.pages_tool_dashboard_InvitationsSection_004)
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_005}</div>

  const inviterRule = summary?.settings.rewards.find((item) => item.recipient === 'inviter')
  const inviteeRule = summary?.settings.rewards.find((item) => item.recipient === 'invitee')

  return (
    <div className="space-y-5">
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="invitation-title">
        <p className="tool-eyebrow">{copy.dashboard.pages_tool_dashboard_InvitationsSection_006}</p>
        <h2 id="invitation-title" className="mt-2 text-xl font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_007}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
          {copy.dashboard.pages_tool_dashboard_InvitationsSection_008}</p>

        <div className="tool-inset mt-5 p-4 sm:p-5" aria-labelledby="priority-coupon-introduction-title">
          <h3 id="priority-coupon-introduction-title" className="text-sm font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_009}</h3>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {copy.dashboard.pages_tool_dashboard_InvitationsSection_010}</p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            {copy.dashboard.pages_tool_dashboard_InvitationsSection_011}</p>
        </div>

        {!summary?.settings.enabled ? (
          <div className="tool-alert tool-alert--warning mt-5" role="status">{copy.dashboard.pages_tool_dashboard_InvitationsSection_012}</div>
        ) : !summary.can_invite ? (
          <div className="tool-alert tool-alert--warning mt-5" role="status">{copy.dashboard.pages_tool_dashboard_InvitationsSection_013}</div>
        ) : summary.code && absoluteShareUrl ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <CopyField id="invitation-code" label={copy.dashboard.pages_tool_dashboard_InvitationsSection_014} value={summary.code} onCopy={() => void copyToClipboard(summary.code!, copy.dashboard.pages_tool_dashboard_InvitationsSection_015)} />
            <CopyField id="invitation-link" label={copy.dashboard.pages_tool_dashboard_InvitationsSection_016} value={absoluteShareUrl} onCopy={() => void copyToClipboard(absoluteShareUrl, copy.dashboard.pages_tool_dashboard_InvitationsSection_017)} />
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => void generateCode()} className="tool-primary-action mt-5">
            {busy ? copy.dashboard.pages_tool_dashboard_InvitationsSection_018 : copy.dashboard.pages_tool_dashboard_InvitationsSection_019}
          </button>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.dashboard.pages_tool_dashboard_InvitationsSection_020}>
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_021} value={summary?.stats.registered ?? 0} />
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_022} value={summary?.stats.activated ?? 0} />
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_023} value={`${summary?.stats.rewards_earned ?? 0}${copy.dashboard.pages_tool_dashboard_InvitationsSection_024}`} />
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_025} value={`${balance?.available ?? 0}${copy.dashboard.pages_tool_dashboard_InvitationsSection_026}`} />
      </section>

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="invitation-rules-title">
        <h2 id="invitation-rules-title" className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_027}</h2>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-ink-secondary">
          <li>{copy.dashboard.pages_tool_dashboard_InvitationsSection_028}{inviterRule?.quantity ?? 0} {copy.dashboard.pages_tool_dashboard_InvitationsSection_029}{inviteeRule?.quantity ?? 0} {copy.dashboard.pages_tool_dashboard_InvitationsSection_030}</li>
          <li>{copy.dashboard.pages_tool_dashboard_InvitationsSection_031}{summary?.settings.daily_inviter_reward_limit ?? 0} {copy.dashboard.pages_tool_dashboard_InvitationsSection_032}</li>
          <li>{formatValidity(inviterRule?.validity_days ?? 0)}{copy.dashboard.pages_tool_dashboard_InvitationsSection_033}</li>
          {balance?.next_expiry_at && <li>{copy.dashboard.pages_tool_dashboard_InvitationsSection_034}{new Date(balance.next_expiry_at).toLocaleString(CURRENT_LOCALE)}</li>}
        </ul>
      </section>
    </div>
  )
}

function CopyField({ id, label, value, onCopy }: { id: string; label: string; value: string; onCopy: () => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink-secondary">{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className="tool-field min-w-0 flex-1 font-mono" />
        <button type="button" onClick={onCopy} className="tool-secondary-action shrink-0">{copy.dashboard.pages_tool_dashboard_InvitationsSection_035}</button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="tool-panel p-5"><p className="text-xs font-medium text-ink-muted">{label}</p><p className="mt-2 text-2xl font-semibold text-ink-primary">{value}</p></div>
}

function formatValidity(days: number): string {
  return days > 0 ? `${copy.dashboard.pages_tool_dashboard_InvitationsSection_036}${days}${copy.dashboard.pages_tool_dashboard_InvitationsSection_037}` : copy.dashboard.pages_tool_dashboard_InvitationsSection_038
}
