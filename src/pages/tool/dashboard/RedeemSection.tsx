import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../../../lib/types'
import { apiJson } from '../../../lib/api-client'
import GuidedTour, { useFirstRunTour, type TourDefinition } from '../../../components/GuidedTour'
import SklandBindingDialog, { type SklandPayload } from '../../../components/SklandBindingDialog'
import { copy } from '../../../copy/index'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { usePersonalUseDeclaration } from '../../../hooks/usePersonalUseDeclaration'


type AddAccountMode = 'cdk' | 'preview'

type CdkRedeemResponse =
  | { redemption_type: 'profile'; auth: AuthSuccessResponse }
  | { redemption_type: 'inventory'; item: { code: string; name: string; quantity: 1; expires_at: string | null } }

export default function RedeemSection({ onRedeemed, onInventoryRedeemed, tourReplayToken = 0, autoStartTour = true }: { onRedeemed: (payload: AuthSuccessResponse) => void; onInventoryRedeemed?: (itemName: string) => void; tourReplayToken?: number; autoStartTour?: boolean }) {
  const { features } = useSiteFeatures()
  const [mode, setMode] = useState<AddAccountMode>(() => features.cdk_redemption ? 'cdk' : 'preview')
  const [cdk, setCdk] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimDialogOpen, setClaimDialogOpen] = useState(false)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const { guard: guardPersonalUseDeclaration, declarationDialog } = usePersonalUseDeclaration({
    enabled: true,
    onError: setError,
  })
  const redeemTour = useFirstRunTour({ id: 'dashboard-redeem', version: 1, autoStart: autoStartTour })
  const redeemTourDefinition = useMemo<TourDefinition>(() => ({
    id: 'dashboard-redeem',
    version: 1,
    steps: [
      { target: 'dashboard-redeem-mode', title: copy.dashboard.pages_tool_dashboard_RedeemSection_tour_001, body: copy.dashboard.pages_tool_dashboard_RedeemSection_tour_002 },
      ...(features.cdk_redemption ? [{ target: 'dashboard-redeem-cdk', title: copy.dashboard.pages_tool_dashboard_RedeemSection_tour_003, body: copy.dashboard.pages_tool_dashboard_RedeemSection_tour_004, onEnter: () => setMode('cdk' as const) }] : []),
      ...(features.free_preview ? [{ target: 'dashboard-redeem-preview', title: copy.dashboard.pages_tool_dashboard_RedeemSection_tour_005, body: copy.dashboard.pages_tool_dashboard_RedeemSection_tour_006, onEnter: () => setMode('preview' as const) }] : []),
    ],
  }), [features.cdk_redemption, features.free_preview])

  useEffect(() => {
    if (mode === 'cdk' && !features.cdk_redemption && features.free_preview) setMode('preview')
    if (mode === 'preview' && !features.free_preview && features.cdk_redemption) setMode('cdk')
  }, [features.cdk_redemption, features.free_preview, mode])

  useEffect(() => {
    if (tourReplayToken > 0) redeemTour.start()
  }, [redeemTour.start, tourReplayToken])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if ((mode === 'cdk' && !features.cdk_redemption) || (mode === 'preview' && !features.free_preview)) return
    if (mode === 'preview') {
      void guardPersonalUseDeclaration('free_preview_claim', () => {
        setError(null)
        setClaimDialogOpen(true)
      })
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<CdkRedeemResponse>('/api/user/cdk/redeem', {
        method: 'POST',
        json: { cdk, display_name: displayName, note, idempotency_key: idempotencyKeyRef.current },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_RedeemSection_001,
      })
      setCdk('')
      setDisplayName('')
      setNote('')
      idempotencyKeyRef.current = crypto.randomUUID()
      if (data.redemption_type === 'profile') onRedeemed(data.auth)
      else onInventoryRedeemed?.(data.item.name)
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
      <form onSubmit={submit} className="tool-panel max-w-2xl p-6" data-tour-target={mode === 'preview' ? 'dashboard-redeem-preview' : undefined}>
        <h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_RedeemSection_002}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          {copy.dashboard.pages_tool_dashboard_RedeemSection_003}</p>

        <div className="tool-inset mt-5 inline-flex p-1" role="group" aria-label={copy.dashboard.pages_tool_dashboard_RedeemSection_004} data-tour-target="dashboard-redeem-mode">
          {features.cdk_redemption && <button
            type="button"
            onClick={() => {
              setMode('cdk')
              setError(null)
            }}
            aria-pressed={mode === 'cdk'}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'cdk' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            {copy.dashboard.pages_tool_dashboard_RedeemSection_005}</button>}
          {features.free_preview && <button
            type="button"
            onClick={() => {
              setMode('preview')
              setError(null)
            }}
            aria-pressed={mode === 'preview'}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'preview' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            {copy.dashboard.pages_tool_dashboard_RedeemSection_006}</button>}
        </div>

        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}

        {mode === 'cdk' ? (
          <label className="mt-5 block" data-tour-target="dashboard-redeem-cdk">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
            <input aria-label="CDK" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} maxLength={256} className="tool-field font-mono uppercase tracking-wide" required />
            <span aria-hidden="true" className="mt-1 block text-xs text-ink-tertiary">{cdk.length}/256</span>
          </label>
        ) : (
          <div className="tool-alert tool-alert--warning mt-5">
            {copy.dashboard.pages_tool_dashboard_RedeemSection_007}</div>
        )}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_RedeemSection_008}</span>
          <input aria-label={copy.dashboard.pages_tool_dashboard_RedeemSection_008} value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} maxLength={40} className="tool-field" placeholder={mode === 'preview' ? copy.dashboard.pages_tool_dashboard_RedeemSection_009 : copy.dashboard.pages_tool_dashboard_RedeemSection_010} />
          <span aria-hidden="true" className="mt-1 block text-xs text-ink-tertiary">{displayName.length}/40</span>
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">{copy.dashboard.pages_tool_dashboard_RedeemSection_011}</span>
          <textarea aria-label={copy.dashboard.pages_tool_dashboard_RedeemSection_011} value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={500} rows={4} className="tool-field resize-y" placeholder={copy.dashboard.pages_tool_dashboard_RedeemSection_012} />
          <span aria-hidden="true" className="mt-1 block text-xs text-ink-tertiary">{note.length}/500</span>
        </label>
        <button type="submit" disabled={loading} className="tool-primary-action mt-5">
          {loading ? copy.dashboard.pages_tool_dashboard_RedeemSection_013 : mode === 'preview' ? copy.dashboard.pages_tool_dashboard_RedeemSection_014 : copy.dashboard.pages_tool_dashboard_RedeemSection_015}
        </button>
      </form>
      {features.free_preview && <SklandBindingDialog
        open={claimDialogOpen}
        profile={null}
        context="free_preview_claim"
        claimProfileMeta={{ displayName, note }}
        onOpenChange={setClaimDialogOpen}
        onPayload={handleClaimPayload}
      />}
      {declarationDialog}
      <GuidedTour definition={redeemTourDefinition} open={redeemTour.open} onFinish={redeemTour.finish} onSkip={redeemTour.skip} />
    </>
  )
}
