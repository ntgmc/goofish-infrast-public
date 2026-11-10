import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '../lib/api-client'
import { markInventoryStale } from '../lib/inventory-refresh'
import { copy } from '../copy'
import type { QqBotVerification, QqBotVerificationAction } from '../lib/qqbot-verification-contracts'

const endpoint = '/api/user/qqbot/verification'
const text = copy.notifications.qqbotVerification
export default function QqBotVerificationPanel({ userId, groupId, campaignId = null, boundQq, disabled = false }: {
  userId: string; groupId?: string; campaignId?: string | null; boundQq?: string; disabled?: boolean
}) {
  const client = useQueryClient()
  const groupHintId = useId()
  const key = ['user', userId, null, 'qqbot-verification']
  const query = useQuery({ queryKey: key, enabled: Boolean(userId), staleTime: 0,
    queryFn: ({ signal }) => apiJson<{ verification: QqBotVerification | null }>(endpoint, { signal }),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const row = query.state.data?.verification
      const relevant = row && (!boundQq || row.qq_number === boundQq)
        && (groupId ? row.group_id === groupId && row.campaign_id === campaignId : row.campaign_id === null)
      return relevant && ['pending', 'verified'].includes(row.status) ? 3000 : false
    },
  })
  const [qq, setQq] = useState('')
  const [group, setGroup] = useState(groupId ?? '')
  const [code, setCode] = useState<{ id: string; value: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const notified = useRef<string | null>(null)
  const latest = query.data?.verification
  const row = latest && (!boundQq || latest.qq_number === boundQq)
    && (groupId ? latest.group_id === groupId && latest.campaign_id === campaignId : latest.campaign_id === null) ? latest : null
  const pending = row?.status === 'pending'
  const busy = saving || disabled
  const completed = row?.status === 'completed' && (groupId || code?.id === row.id)
  useEffect(() => {
    if (row?.status !== 'completed' || notified.current === row.id) return
    notified.current = row.id
    markInventoryStale()
    void client.invalidateQueries({ queryKey: ['user', userId, null, 'qqbot'], exact: true })
    void client.invalidateQueries({ queryKey: ['user', userId, null, 'qqbot-activities'] })
  }, [row?.status, row?.id, client, userId])

  async function submit(action: QqBotVerificationAction) {
    setSaving(true); setError(null); setCopied(false)
    try {
      const response = await apiJson<{ verification?: QqBotVerification; code?: string; status?: string }>(endpoint, { method: 'POST', json: action })
      if (response.code && response.verification) setCode({ id: response.verification.id, value: text.message(response.code) })
      await client.invalidateQueries({ queryKey: key, exact: true })
      if (response.status === 'completed') {
        markInventoryStale()
        await client.invalidateQueries({ queryKey: ['user', userId, null, 'qqbot-activities'] })
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : text.failed) }
    finally { setSaving(false) }
  }
  const refreshButton = <button type="button" className="tool-secondary-action" disabled={saving || query.isFetching} aria-busy={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>{text.refresh}</button>

  return <div className="qqbot-verification space-y-4">
    {(error || query.error) && <p className="tool-alert tool-alert--error" role="alert">{error ?? query.error?.message}</p>}
    {completed && <p className="tool-alert" role="status">{row.campaign_id ? text.received : text.bound}</p>}
    {row?.status === 'rejected' && <p className="tool-alert tool-alert--error" role="alert">{row.error_message ?? text.rejected}</p>}
    {row?.status === 'expired' && <p className="text-sm text-ink-secondary" role="status">{boundQq ? text.claimExpired : text.expired}</p>}
    {!boundQq && <>
      <p className="text-sm leading-6 text-ink-secondary">{text.introduction}</p>
      <label className="block text-sm text-ink-secondary">{text.qqLabel}<input className="tool-field mt-2" inputMode="numeric" autoComplete="off" pattern="[1-9][0-9]{4,11}" maxLength={12} value={row?.status === 'verified' ? row.qq_number : qq} disabled={busy || row?.status === 'verified'} onChange={(event) => setQq(event.target.value)} /></label>
      {!groupId && <div className="text-sm text-ink-secondary"><label className="block">{text.groupLabel}<input className="tool-field mt-2" aria-describedby={groupHintId} inputMode="numeric" autoComplete="off" pattern="[1-9][0-9]{0,19}" maxLength={20} value={row?.status === 'verified' ? row.group_id : group} disabled={busy || row?.status === 'verified'} onChange={(event) => setGroup(event.target.value)} /></label><p id={groupHintId} className="mt-1">{text.groupHelp}</p></div>}
      {pending && row.kind === 'message' && <div className="space-y-3" role="status">
        <p className="text-sm leading-6 text-ink-secondary">{text.sendHelp(row.qq_number, row.group_id)}</p>
        {code?.id === row.id ? <>
          <label className="block text-sm text-ink-secondary">{text.messageLabel}<input className="tool-field mt-2 font-mono" readOnly value={code.value} onFocus={(event) => event.currentTarget.select()} /></label>
          <button type="button" className="tool-secondary-action" onClick={() => { void navigator.clipboard.writeText(code.value).then(() => setCopied(true)).catch(() => setError(text.copyFailed)) }}>{copied ? text.copied : text.copy}</button>
        </> : <p className="text-sm text-ink-secondary">{text.regenerateHelp}</p>}
        <p className="text-sm text-ink-secondary">{text.waiting(new Date(row.expires_at).toLocaleString('zh-CN'))}</p>
      </div>}
      {row?.status === 'verified' ? <div className="space-y-3">
        <p className="text-sm text-ink-secondary" role="status">{text.verified(row.qq_number)}</p>
        <button type="button" className="tool-primary-action" disabled={busy} aria-busy={saving} onClick={() => void submit({ action: 'confirm', verification_id: row.id })}>{saving ? text.confirming : row.campaign_id ? text.confirmClaim : text.confirm}</button>
      </div> : <div className="flex flex-wrap gap-3">
        <button type="button" className="tool-primary-action" aria-busy={saving} disabled={busy || !/^[1-9][0-9]{4,11}$/.test(qq) || !/^[1-9][0-9]{0,19}$/.test(groupId ?? group)} onClick={() => void submit({ action: 'start', qq_number: qq, group_id: groupId ?? group, campaign_id: campaignId })}>{saving ? text.generating : pending ? text.regenerate : text.generate}</button>
        {pending && refreshButton}
      </div>}
    </>}
    {boundQq && campaignId && groupId && row?.status !== 'completed' && <>
      <p className="text-sm text-ink-secondary">{text.claimHelp(boundQq)}</p>
      {pending && <p role="status" className="text-sm text-ink-secondary">{text.checkingHelp}</p>}
      <div className="flex flex-wrap gap-3"><button type="button" className="tool-primary-action" disabled={busy || pending} aria-busy={saving || pending} onClick={() => void submit({ action: 'claim', group_id: groupId, campaign_id: campaignId })}>{pending ? text.checking : saving ? text.submitting : text.claim}</button>{pending && refreshButton}</div>
    </>}
    {query.error && !pending && refreshButton}
  </div>
}
