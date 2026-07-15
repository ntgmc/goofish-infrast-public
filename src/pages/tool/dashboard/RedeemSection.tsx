import { useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../../../lib/types'
import { apiJson } from '../../../lib/api-client'
import SklandBindingDialog, { type SklandPayload } from '../../../components/SklandBindingDialog'
import { copy } from '../../../copy/index'


type AddAccountMode = 'cdk' | 'preview'

export default function RedeemSection({ onRedeemed }: { onRedeemed: (payload: AuthSuccessResponse) => void }) {
  const [mode, setMode] = useState<AddAccountMode>('cdk')
  const [cdk, setCdk] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimDialogOpen, setClaimDialogOpen] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'preview') {
      setError(null)
      setClaimDialogOpen(true)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>('/api/user/profiles/redeem', {
        method: 'POST',
        json: { cdk, display_name: displayName, note },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_RedeemSection_001,
      })
      setCdk('')
      setDisplayName('')
      setNote('')
      onRedeemed(data)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleClaimPayload = (payload: SklandPayload) => {
    if (!payload.user) return
    setCdk('')
    setDisplayName('')
    setNote('')
    setClaimDialogOpen(false)
    onRedeemed(payload)
  }

  return (
    <>
      <form onSubmit={submit} className="tool-panel max-w-2xl p-6">
        <h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_RedeemSection_002}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          {copy.dashboard.pages_tool_dashboard_RedeemSection_003}</p>

        <div className="tool-inset mt-5 inline-flex p-1" role="group" aria-label={copy.dashboard.pages_tool_dashboard_RedeemSection_004}>
          <button
            type="button"
            onClick={() => {
              setMode('cdk')
              setError(null)
            }}
            aria-pressed={mode === 'cdk'}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'cdk' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            {copy.dashboard.pages_tool_dashboard_RedeemSection_005}</button>
          <button
            type="button"
            onClick={() => {
              setMode('preview')
              setError(null)
            }}
            aria-pressed={mode === 'preview'}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'preview' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            {copy.dashboard.pages_tool_dashboard_RedeemSection_006}</button>
        </div>

        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}

        {mode === 'cdk' ? (
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
            <input value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="tool-field font-mono uppercase tracking-wide" required />
          </label>
        ) : (
          <div className="tool-alert tool-alert--warning mt-5">
            {copy.dashboard.pages_tool_dashboard_RedeemSection_007}</div>
        )}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_RedeemSection_008}</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} className="tool-field" placeholder={mode === 'preview' ? copy.dashboard.pages_tool_dashboard_RedeemSection_009 : copy.dashboard.pages_tool_dashboard_RedeemSection_010} />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_RedeemSection_011}</span>
          <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} className="tool-field resize-y" placeholder={copy.dashboard.pages_tool_dashboard_RedeemSection_012} />
        </label>
        <button type="submit" disabled={loading} className="tool-primary-action mt-5">
          {loading ? copy.dashboard.pages_tool_dashboard_RedeemSection_013 : mode === 'preview' ? copy.dashboard.pages_tool_dashboard_RedeemSection_014 : copy.dashboard.pages_tool_dashboard_RedeemSection_015}
        </button>
      </form>
      <SklandBindingDialog
        open={claimDialogOpen}
        profile={null}
        context="free_preview_claim"
        claimProfileMeta={{ displayName, note }}
        onOpenChange={setClaimDialogOpen}
        onPayload={handleClaimPayload}
      />
    </>
  )
}
