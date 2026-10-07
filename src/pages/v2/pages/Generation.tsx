import type { ReactNode } from 'react'
import { ArrowRight, Check, RefreshCw, Settings2, Users } from 'lucide-react'
import { copy, CURRENT_LOCALE } from '../../../copy'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import { formatResultHistorySummary, formatWorkspaceDate } from '../../../lib/workspace-history'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../../lib/workspace-limits'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import Link from '../../../components/InternalLink'
import type { V2Workflow } from '../WorkspaceSections'
import type { V2Section } from '../navigation'
import { Facts, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.optimize

export default function Generation({ workflow: w, progress: progressContent, disabledReason, onNavigate, onConfig }: { workflow: V2Workflow; progress?: ReactNode; disabledReason?: string | null; onNavigate: (section: V2Section) => void; onConfig: () => void }) {
  const { features } = useSiteFeatures()
  const busy = w.loading || w.licenseSyncing
  const disabled = busy || !w.configValidation.ok || w.resultIsCurrent || Boolean(disabledReason)
  const progress = w.progress?.mode === 'generate' ? w.progress : null
  const latest = w.latestWorkspaceResult
  const readyLabel = w.resultIsCurrent ? text.pages_tool_optimize_GenerateControlBar_001 : w.hasResult ? text.pages_tool_optimize_GenerateControlBar_002 : text.pages_tool_optimize_GenerateControlBar_003
  const busyLabel = w.licenseSyncing ? text.pages_tool_optimize_GenerateControlBar_004 : progress?.queueStatus === 'queued' ? text.pages_tool_optimize_GenerateControlBar_005 : progress?.completedAt ? text.pages_tool_optimize_GenerateControlBar_006 : text.pages_tool_optimize_GenerateControlBar_007
  const configLabel = w.userCanEditConfig ? `${SCHEDULE_MODE_LABELS[normalizeScheduleMode(w.activeConfig.schedule_mode)]} · ${w.activeConfig.layout} · ${w.activeConfig.desc}` : `${SCHEDULE_MODE_LABELS[normalizeScheduleMode(w.activeConfig.schedule_mode)]} · ${w.configPresetLabel}`
  return <div className="v2-generation-workspace">
    <div className="v2-generation-state"><span className="v2-status-dot" /><strong>{readyLabel}</strong>{w.configChanged && <span>{text.pages_tool_optimize_GenerateControlBar_009}</span>}</div>
    <div className="v2-generation-flow">
      <section className="v2-generation-preparation"><SectionTitle title={copy.v2.prepare} />
        <div className="v2-preparation-row"><span className="v2-step-number">01</span><Users size={20} aria-hidden="true" /><div><h3>{text.pages_tool_optimize_GenerateControlBar_015}</h3><strong>{w.mergedOperators.length}{text.pages_tool_optimize_GenerateControlBar_016}</strong></div><button className="v2-text-button" onClick={w.onReset}>{copy.v2.operators}<ArrowRight size={16} /></button></div>
        <div className="v2-preparation-row"><span className="v2-step-number">02</span><Settings2 size={20} aria-hidden="true" /><div><h3>{text.pages_tool_optimize_GenerateControlBar_017}</h3><strong>{configLabel}</strong><p>{w.configChanged ? text.pages_tool_optimize_GenerateControlBar_019 : text.pages_tool_optimize_GenerateControlBar_020}</p></div><button className="v2-text-button" onClick={onConfig}>{text.pages_tool_optimize_GenerateControlBar_032}<ArrowRight size={16} /></button></div>
        <Notice error>{!w.configValidation.ok && w.configValidation.message}</Notice>
        <Notice error>{w.inventoryError ?? w.priorityCouponError}{(w.inventoryError || w.priorityCouponError) && <button className="v2-text-button" disabled={w.inventoryLoading || w.priorityCouponLoading} onClick={() => { void w.refreshInventory(); void w.refreshRewardBalance() }}>{text.pages_tool_optimize_OptimizeWorkflowPage_006}</button>}</Notice>
      </section>
      <section className="v2-generation-execution"><SectionTitle title={copy.v2.execute} />
        <label className="v2-coupon-option"><input type="checkbox" checked={w.usePriorityCoupon} disabled={(w.priorityCouponBalance?.available ?? 0) < 1 || busy} onChange={(event) => w.setUsePriorityCoupon(event.target.checked)} /><span><strong>{text.pages_tool_optimize_GenerateControlBar_021}</strong><small>{text.pages_tool_optimize_GenerateControlBar_023}</small><small>{text.pages_tool_optimize_GenerateControlBar_024}{w.priorityCouponBalance?.available ?? 0}{w.priorityCouponBalance?.next_expiry_at ? ` · ${text.pages_tool_optimize_GenerateControlBar_026}${new Date(w.priorityCouponBalance.next_expiry_at).toLocaleDateString(CURRENT_LOCALE)}` : ''}</small></span></label>
        {!w.userCanUseUpgradeFeatures && (w.itemBalances.training_diagnosis_coupon ?? 0) > 0 && <label className="v2-coupon-option"><input type="checkbox" checked={w.useTrainingDiagnosisCoupon} disabled={busy} onChange={(event) => w.setUseTrainingDiagnosisCoupon(event.target.checked)} /><span><strong>{copy.inventory.training_coupon}</strong><small>{copy.inventory.training_coupon_help}</small><small>{copy.inventory.coupon_available}{w.itemBalances.training_diagnosis_coupon}</small></span></label>}
        {w.billingQuote && <Notice>{copy.metered.quote.summary(w.billingQuote.charge, w.billingQuote.available, w.billingQuote.tier, w.billingQuote.sufficient)}</Notice>}
        <Notice error>{w.billingQuoteError}{w.billingQuoteError && <button className="v2-text-button" onClick={() => void w.refreshBillingQuote()}>{copy.metered.quote.retry}</button>}</Notice>
        {w.billingQuote?.sufficient === false && <button className="v2-text-button" onClick={() => onNavigate('balance')}>{copy.metered.quote.go_to_balance}</button>}
        <Notice>{disabledReason}</Notice>
        <button className="v2-button v2-button-primary v2-generate-submit" disabled={disabled} onClick={() => void w.handleGenerate()}>{busy ? <RefreshCw size={18} className="v2-spin" /> : w.resultIsCurrent ? <Check size={18} /> : <ArrowRight size={18} />}{busy ? busyLabel : w.resultIsCurrent ? text.pages_tool_optimize_GenerateControlBar_028 : w.hasResult ? text.pages_tool_optimize_GenerateControlBar_029 : text.pages_tool_optimize_GenerateControlBar_030}</button>
        {w.resultIsCurrent && <p className="v2-muted">{text.pages_tool_optimize_GenerateControlBar_031}</p>}
      </section>
    </div>
    {progressContent && <div className="v2-generation-progress">{progressContent}</div>}
    <Notice error>{w.inlineError?.scope === 'generate' && <>{w.inlineError.message}<div className="v2-actions"><button className="v2-button v2-button-secondary" onClick={() => void w.handleGenerate()}>{copy.v2.retry}</button><button className="v2-text-button" onClick={w.onReset}>{copy.v2.operators}</button></div></>}</Notice>
    {w.isRestrictedPreview && <aside className="v2-generation-preview"><h2>{text.pages_tool_optimize_OverviewSection_024}</h2><Facts items={[[text.pages_tool_optimize_OverviewSection_026, text.pages_tool_optimize_OverviewSection_027], [text.pages_tool_optimize_OverviewSection_028, text.pages_tool_optimize_OverviewSection_029], [text.pages_tool_optimize_OverviewSection_030, text.pages_tool_optimize_OverviewSection_031]]} /><h3>{text.paid_preview.recompute}</h3><p>{text.paid_preview.recompute_detail}</p><div className="v2-actions"><button disabled className="v2-button v2-button-secondary">{text.paid_preview.recompute_action}</button>{features.pricing && <Link className="v2-text-button" to="/pricing">{text.paid_preview.compare}</Link>}</div></aside>}
    <section className="v2-generation-history"><SectionTitle title={text.pages_tool_optimize_OverviewSection_012} action={<button className="v2-text-button" onClick={() => onNavigate('plans')}>{text.pages_tool_optimize_OverviewSection_010}<ArrowRight size={16} /></button>} />
      {latest ? <><h3>{latest.name}</h3><p>{formatWorkspaceDate(latest.created_at)} · {formatResultHistorySummary(latest)}</p><div className="v2-actions"><button className="v2-button v2-button-secondary" onClick={() => void w.handleViewHistory(latest)}>{text.pages_tool_optimize_OverviewSection_018}</button>{features.maa_export && <button className="v2-text-button" disabled={w.workspaceBusyAction === `download:${latest.id}` || !latest.maa_exportable} onClick={() => void w.handleDownloadHistory(latest)}>{w.workspaceBusyAction === `download:${latest.id}` ? copy.inventory.export_downloading : text.pages_tool_optimize_OverviewSection_019}</button>}<button className="v2-text-button" disabled={w.loading || !latest.has_config} onClick={() => void w.handleUseHistoryConfig(latest)}>{text.pages_tool_optimize_OverviewSection_020}</button></div></> : <p>{text.pages_tool_optimize_OverviewSection_014}</p>}
      <Facts items={[[text.pages_tool_optimize_OverviewSection_003, `${w.savedConfigs.length}/${w.profileCapacity?.plan_slots.limit ?? WORKSPACE_SAVED_CONFIG_LIMIT}`], [text.pages_tool_optimize_OverviewSection_004, `${w.profileCapacity?.history_slots.used ?? w.resultHistory.length}/${w.profileCapacity?.history_slots.limit ?? WORKSPACE_RESULT_HISTORY_LIMIT}`]]} />
    </section>
  </div>
}
