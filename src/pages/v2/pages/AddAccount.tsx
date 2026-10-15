import { KeyRound } from 'lucide-react'
import { copy } from '../../../copy'
import type { AuthSuccessResponse } from '../../../lib/types'
import SklandBindingDialog from '../../../components/SklandBindingDialog'
import SklandIcon from '../../../components/SklandIcon'
import { useAccountRedemption } from '../../tool/dashboard/RedeemSection'
import { Field, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.dashboard

export default function AddAccount({ onAdded, onInventory, guided = false }: { onAdded: (payload: AuthSuccessResponse) => Promise<void>; onInventory: () => void; guided?: boolean }) {
  const model = useAccountRedemption({ onRedeemed: (payload) => void onAdded(payload), onInventoryRedeemed: onInventory, preferPreview: true, autoStartTour: false })
  const choices = [
    ...(model.features.free_preview ? [{ id: 'preview' as const, label: text.pages_tool_dashboard_RedeemSection_006, description: text.pages_tool_dashboard_RedeemSection_007, icon: SklandIcon }] : []),
    ...(model.features.cdk_redemption ? [{ id: 'cdk' as const, label: text.pages_tool_dashboard_RedeemSection_005, description: text.pages_tool_dashboard_RedeemSection_003, icon: KeyRound }] : []),
  ]
  const firstBinding = guided && model.features.free_preview
  const methods = <div className="v2-account-methods" role="group" aria-label={text.pages_tool_dashboard_RedeemSection_004}>{choices.map((choice) => <button type="button" key={choice.id} aria-label={choice.label} aria-pressed={model.mode === choice.id} onClick={() => { model.setMode(choice.id); model.setError(null) }}><choice.icon size={24} /><strong>{choice.label}</strong><span>{choice.description}</span></button>)}</div>
  const fields = <>
    <Field label={text.pages_tool_dashboard_RedeemSection_008} value={model.displayName} maxLength={40} onChange={(event) => model.setDisplayName(event.target.value)} placeholder={model.mode === 'preview' ? text.pages_tool_dashboard_RedeemSection_009 : text.pages_tool_dashboard_RedeemSection_010} />
    <label className="v2-field"><span>{text.pages_tool_dashboard_RedeemSection_011}</span><textarea className="v2-input" value={model.note} maxLength={500} rows={3} onChange={(event) => model.setNote(event.target.value)} placeholder={text.pages_tool_dashboard_RedeemSection_012} /></label>
  </>
  return <div className={firstBinding ? 'v2-first-account' : 'v2-add-account'}>
    {!firstBinding && methods}
    <form key={firstBinding ? 'guided' : model.mode} onSubmit={model.submit} className="v2-account-registration">
      <SectionTitle title={firstBinding && model.mode === 'preview' ? copy.v2.firstSchedule.import : choices.find((choice) => choice.id === model.mode)?.label ?? text.pages_tool_dashboard_RedeemSection_002}
        description={firstBinding && model.mode === 'preview' ? copy.v2.firstSchedule.importHelp : model.mode === 'preview' ? text.pages_tool_dashboard_RedeemSection_007 : text.pages_tool_dashboard_RedeemSection_003} />
      {firstBinding && <p className="v2-muted">{copy.v2.firstSchedule.accountHelp}</p>}
      <Notice error>{model.error}</Notice>
      {model.mode === 'cdk' && <Field label="CDK" value={model.cdk} maxLength={256} required autoComplete="off" onChange={(event) => model.setCdk(event.target.value)} />}
      {!firstBinding && fields}
      <button className="v2-button v2-button-primary" type="submit" disabled={model.loading}>{model.mode === 'preview' && <SklandIcon />}{model.loading ? text.pages_tool_dashboard_RedeemSection_013 : model.mode === 'preview' ? firstBinding ? copy.v2.firstSchedule.importAction : text.pages_tool_dashboard_RedeemSection_014 : text.pages_tool_dashboard_RedeemSection_015}</button>
      {firstBinding && <details className="v2-disclosure"><summary>{copy.v2.firstSchedule.accountOptions}</summary>{methods}{fields}</details>}
    </form>
    {model.features.free_preview && <SklandBindingDialog open={model.claimDialogOpen} profile={null} context="free_preview_claim" claimProfileMeta={{ displayName: model.displayName, note: model.note }} onOpenChange={model.setClaimDialogOpen} onPayload={model.handleClaimPayload} />}
    {model.declarationDialog}
  </div>
}
