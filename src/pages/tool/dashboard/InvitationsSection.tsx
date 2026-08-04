import { useCallback, useEffect, useMemo, useState } from 'react'
import { copy, CURRENT_LOCALE } from '../../../copy/index'
import { apiJson } from '../../../lib/api-client'
import { itemIconPath } from '../../../lib/inventory-contracts'
import type {
  InvitationRecordSummary,
  InvitationRewardPreviewItem,
  InvitationSummary,
  InviterRewardStatus,
} from '../../../lib/types'

export default function InvitationsSection() {
  const [summary, setSummary] = useState<InvitationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      setSummary(await apiJson<InvitationSummary>('/api/user/invitations'))
    } catch (caught) {
      if (!silent) setError((caught as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const hasPendingSettlement = summary?.records.some((record) => (
    record.status === 'activated' || record.status === 'processing' || record.status === 'failed'
  )) === true

  useEffect(() => {
    if (!hasPendingSettlement) return
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [hasPendingSettlement, load])

  const absoluteShareUrl = useMemo(() => {
    if (!summary?.share_url) return null
    return new URL(summary.share_url, window.location.origin).toString()
  }, [summary?.share_url])

  const generateCode = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await apiJson('/api/user/invitations/code', {
        method: 'POST',
        json: { action: 'ensure' },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_InvitationsSection_001,
      })
      await load()
      setNotice(copy.dashboard.pages_tool_dashboard_InvitationsSection_002)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const manageCode = async (action: 'rotate' | 'pause' | 'resume') => {
    if (action === 'rotate' && !window.confirm(copy.dashboard.pages_tool_dashboard_InvitationsSection_078)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await apiJson('/api/user/invitations/code', {
        method: 'POST',
        json: { action },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_InvitationsSection_079,
      })
      await load()
      setNotice(action === 'pause'
        ? copy.dashboard.pages_tool_dashboard_InvitationsSection_080
        : action === 'resume'
          ? copy.dashboard.pages_tool_dashboard_InvitationsSection_081
          : copy.dashboard.pages_tool_dashboard_InvitationsSection_082)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loadMore = async () => {
    if (!summary?.next_cursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await apiJson<InvitationSummary>(`/api/user/invitations?cursor=${encodeURIComponent(summary.next_cursor)}`)
      setSummary((current) => current ? {
        ...page,
        records: [...current.records, ...page.records.filter((record) => !current.records.some((existing) => existing.id === record.id))],
      } : page)
    } catch (caught) {
      setError((caught as Error).message || copy.dashboard.pages_tool_dashboard_InvitationsSection_074)
    } finally {
      setLoadingMore(false)
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

  if (loading && !summary) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.dashboard.pages_tool_dashboard_InvitationsSection_005}</div>

  return (
    <div className="space-y-5">
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}

      <section className="tool-panel overflow-hidden p-5 sm:p-6" aria-labelledby="invitation-title">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="tool-eyebrow">{copy.dashboard.pages_tool_dashboard_InvitationsSection_006}</p>
            <h2 id="invitation-title" className="mt-2 text-xl font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_007}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_040}</p>
          </div>
          <div className="flex max-w-md flex-col items-start gap-3 lg:items-end">
            <p className="text-xs leading-5 text-ink-muted">{copy.dashboard.pages_tool_dashboard_InvitationsSection_077}</p>
            <button type="button" disabled={loading} onClick={() => void load()} className="tool-secondary-action min-h-9 px-3 text-sm">
              {loading ? copy.dashboard.pages_tool_dashboard_InvitationsSection_083 : copy.dashboard.pages_tool_dashboard_InvitationsSection_084}
            </button>
          </div>
        </div>

        {!summary?.campaign_enabled ? (
          <div className="tool-alert tool-alert--warning mt-5" role="status">{copy.dashboard.pages_tool_dashboard_InvitationsSection_041}</div>
        ) : !summary.can_invite ? (
          <div className="tool-alert tool-alert--warning mt-5" role="status">{copy.dashboard.pages_tool_dashboard_InvitationsSection_013}</div>
        ) : summary.code ? (
          <div className="mt-5 space-y-4">
            {summary.code_status === 'paused' && <div className="tool-alert tool-alert--warning" role="status">{copy.dashboard.pages_tool_dashboard_InvitationsSection_085}</div>}
            <div className="grid gap-4 lg:grid-cols-2">
              <CopyField id="invitation-code" label={copy.dashboard.pages_tool_dashboard_InvitationsSection_014} value={summary.code} onCopy={() => void copyToClipboard(summary.code!, copy.dashboard.pages_tool_dashboard_InvitationsSection_015)} />
              {absoluteShareUrl && <CopyField id="invitation-link" label={copy.dashboard.pages_tool_dashboard_InvitationsSection_016} value={absoluteShareUrl} onCopy={() => void copyToClipboard(absoluteShareUrl, copy.dashboard.pages_tool_dashboard_InvitationsSection_017)} />}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void manageCode(summary.code_status === 'paused' ? 'resume' : 'pause')} className="tool-secondary-action min-h-9 px-3 text-sm">
                {summary.code_status === 'paused' ? copy.dashboard.pages_tool_dashboard_InvitationsSection_086 : copy.dashboard.pages_tool_dashboard_InvitationsSection_087}
              </button>
              <button type="button" disabled={busy} onClick={() => void manageCode('rotate')} className="tool-secondary-action min-h-9 px-3 text-sm">{copy.dashboard.pages_tool_dashboard_InvitationsSection_088}</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => void generateCode()} className="tool-primary-action mt-5">
            {busy ? copy.dashboard.pages_tool_dashboard_InvitationsSection_018 : copy.dashboard.pages_tool_dashboard_InvitationsSection_019}
          </button>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2" aria-labelledby="invitation-rewards-title">
        <h2 id="invitation-rewards-title" className="sr-only">{copy.dashboard.pages_tool_dashboard_InvitationsSection_039}</h2>
        <RewardGroup title={copy.dashboard.pages_tool_dashboard_InvitationsSection_042} rewards={summary?.reward_preview.inviter ?? []} />
        <RewardGroup title={copy.dashboard.pages_tool_dashboard_InvitationsSection_043} rewards={summary?.reward_preview.invitee ?? []} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.dashboard.pages_tool_dashboard_InvitationsSection_020}>
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_021} value={summary?.stats.registered ?? 0} />
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_022} value={summary?.stats.activated ?? 0} />
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_049} value={summary?.stats.rewarded_invitations ?? 0} />
        <Metric label={copy.dashboard.pages_tool_dashboard_InvitationsSection_050} value={`${summary?.daily_limit.used ?? 0} / ${summary?.daily_limit.limit ?? 0}`} />
      </section>

      {summary && <section className="tool-panel p-5 sm:p-6" aria-labelledby="daily-invitation-limit-title">
        <div className="flex items-center justify-between gap-4">
          <div><h2 id="daily-invitation-limit-title" className="text-base font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_050}</h2><p className="mt-1 text-xs text-ink-muted">{copy.dashboard.pages_tool_dashboard_InvitationsSection_051}{summary.daily_limit.remaining}{copy.dashboard.pages_tool_dashboard_InvitationsSection_052}{formatDate(summary.daily_limit.reset_at)}</p></div>
          <strong className="text-lg tabular-nums text-ink-primary">{summary.daily_limit.used}/{summary.daily_limit.limit}</strong>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true"><div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.min(100, summary.daily_limit.limit > 0 ? summary.daily_limit.used / summary.daily_limit.limit * 100 : 0)}%` }} /></div>
        {summary.daily_limit.remaining === 0 && <p className="mt-3 text-xs leading-5 text-warning-600">{copy.dashboard.pages_tool_dashboard_InvitationsSection_053}</p>}
      </section>}

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="invitation-records-title">
        <h2 id="invitation-records-title" className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_054}</h2>
        {(summary?.records.length ?? 0) === 0 ? (
          <p className="tool-inset mt-4 p-8 text-center text-sm text-ink-muted">{copy.dashboard.pages_tool_dashboard_InvitationsSection_055}</p>
        ) : <>
          <InvitationRecords records={summary?.records ?? []} />
          {summary?.next_cursor && <div className="mt-4 flex justify-center"><button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="tool-secondary-action">{loadingMore ? copy.dashboard.pages_tool_dashboard_InvitationsSection_073 : copy.dashboard.pages_tool_dashboard_InvitationsSection_072}</button></div>}
        </>}
      </section>
    </div>
  )
}

function RewardGroup({ title, rewards }: { title: string; rewards: InvitationRewardPreviewItem[] }) {
  return <article className="tool-panel p-5 sm:p-6"><h3 className="text-base font-semibold text-ink-primary">{title}</h3>{rewards.length === 0 ? <p className="tool-inset mt-4 p-6 text-center text-sm text-ink-muted">{copy.dashboard.pages_tool_dashboard_InvitationsSection_044}</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">{rewards.map((reward) => <div key={reward.item_code} className="tool-inset flex min-w-0 items-center gap-3 p-3"><img src={itemIconPath(reward.icon_key)} alt="" width={56} height={56} className="h-14 w-14 shrink-0 object-contain" /><div className="min-w-0"><strong className="block truncate text-sm text-ink-primary">{reward.name} ×{reward.quantity}</strong><span className="mt-1 block text-xs text-ink-muted">{formatExpiry(reward)}</span>{reward.gift_pack_version && <span className="mt-1 block text-xs text-ink-secondary">{copy.dashboard.pages_tool_dashboard_InvitationsSection_076}{reward.gift_pack_version.version}</span>}{!reward.available && <span className="mt-1 block text-xs font-medium text-warning-600">{copy.dashboard.pages_tool_dashboard_InvitationsSection_048}</span>}</div></div>)}</div>}</article>
}

function InvitationRecords({ records }: { records: InvitationRecordSummary[] }) {
  return <div className="mt-4">
    <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-surface-3 text-xs text-ink-muted"><th className="px-3 py-3 font-medium">{copy.dashboard.pages_tool_dashboard_InvitationsSection_056}</th><th className="px-3 py-3 font-medium">{copy.dashboard.pages_tool_dashboard_InvitationsSection_057}</th><th className="px-3 py-3 font-medium">{copy.dashboard.pages_tool_dashboard_InvitationsSection_058}</th><th className="px-3 py-3 font-medium">{copy.dashboard.pages_tool_dashboard_InvitationsSection_059}</th><th className="px-3 py-3 font-medium">{copy.dashboard.pages_tool_dashboard_InvitationsSection_060}</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-b border-surface-3/70 last:border-0"><td className="px-3 py-4 font-medium text-ink-primary">{record.invitee_label}</td><td className="px-3 py-4 text-ink-secondary">{formatDate(record.registered_at)}</td><td className="px-3 py-4 text-ink-secondary">{record.activated_at ? formatDate(record.activated_at) : copy.dashboard.pages_tool_dashboard_InvitationsSection_075}</td><td className="px-3 py-4"><StatusBadge label={progressLabel(record)} /></td><td className="px-3 py-4"><RewardStatus record={record} /></td></tr>)}</tbody></table></div>
    <div className="grid gap-3 md:hidden">{records.map((record) => <article key={record.id} className="tool-inset p-4"><div className="flex items-start justify-between gap-3"><strong className="text-sm text-ink-primary">{record.invitee_label}</strong><StatusBadge label={progressLabel(record)} /></div><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-ink-muted">{copy.dashboard.pages_tool_dashboard_InvitationsSection_057}</dt><dd className="mt-1 text-ink-secondary">{formatDate(record.registered_at)}</dd></div><div><dt className="text-ink-muted">{copy.dashboard.pages_tool_dashboard_InvitationsSection_058}</dt><dd className="mt-1 text-ink-secondary">{record.activated_at ? formatDate(record.activated_at) : copy.dashboard.pages_tool_dashboard_InvitationsSection_075}</dd></div></dl><div className="mt-3 border-t border-surface-3 pt-3"><RewardStatus record={record} /></div></article>)}</div>
  </div>
}

function RewardStatus({ record }: { record: InvitationRecordSummary }) {
  return <div><StatusBadge label={rewardStatusLabel(record.inviter_reward_status)} />{record.inviter_rewards.length > 0 && <p className="mt-1.5 text-xs text-ink-muted">{record.inviter_rewards.map((reward) => `${reward.name} ×${reward.quantity}`).join('、')}</p>}</div>
}

function StatusBadge({ label }: { label: string }) {
  return <span className="inline-flex rounded-full border border-surface-3 bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-secondary">{label}</span>
}

function CopyField({ id, label, value, onCopy }: { id: string; label: string; value: string; onCopy: () => void }) {
  return <div><label htmlFor={id} className="mb-2 block text-sm font-medium text-ink-secondary">{label}</label><div className="flex flex-col gap-2 sm:flex-row"><input id={id} readOnly value={value} className="tool-field min-w-0 flex-1 font-mono" /><button type="button" onClick={onCopy} className="tool-secondary-action shrink-0">{copy.dashboard.pages_tool_dashboard_InvitationsSection_035}</button></div></div>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="tool-panel p-5"><p className="text-xs font-medium text-ink-muted">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-ink-primary">{value}</p></div>
}

function formatExpiry(reward: InvitationRewardPreviewItem): string {
  return reward.expiry.mode === 'never' ? copy.dashboard.pages_tool_dashboard_InvitationsSection_045 : `${copy.dashboard.pages_tool_dashboard_InvitationsSection_046}${reward.expiry.days}${copy.dashboard.pages_tool_dashboard_InvitationsSection_047}`
}

function progressLabel(record: InvitationRecordSummary): string {
  if (record.status === 'registered') return copy.dashboard.pages_tool_dashboard_InvitationsSection_061
  if (record.status === 'activated' || record.status === 'processing' || record.status === 'failed') return copy.dashboard.pages_tool_dashboard_InvitationsSection_062
  if (record.status === 'dead_letter') return copy.dashboard.pages_tool_dashboard_InvitationsSection_089
  return copy.dashboard.pages_tool_dashboard_InvitationsSection_063
}

function rewardStatusLabel(status: InviterRewardStatus): string {
  const labels: Record<InviterRewardStatus, string> = {
    pending_activation: copy.dashboard.pages_tool_dashboard_InvitationsSection_064,
    pending_campaign_resume: copy.dashboard.pages_tool_dashboard_InvitationsSection_065,
    settlement_pending: copy.dashboard.pages_tool_dashboard_InvitationsSection_066,
    settlement_retry: copy.dashboard.pages_tool_dashboard_InvitationsSection_090,
    settlement_failed: copy.dashboard.pages_tool_dashboard_InvitationsSection_091,
    granted: copy.dashboard.pages_tool_dashboard_InvitationsSection_067,
    daily_limit_skipped: copy.dashboard.pages_tool_dashboard_InvitationsSection_068,
    inviter_ineligible: copy.dashboard.pages_tool_dashboard_InvitationsSection_069,
    not_configured: copy.dashboard.pages_tool_dashboard_InvitationsSection_070,
  }
  return labels[status]
}

function formatDate(value: string): string {
  return `${new Intl.DateTimeFormat(CURRENT_LOCALE, {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))}${copy.dashboard.pages_tool_dashboard_InvitationsSection_092}`
}
