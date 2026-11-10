import { useEffect, useRef, type ReactNode } from 'react'
import { NextIcon as ArrowRight, SuccessIcon as Check, LoadingIcon as RefreshCw, ConfigIcon as Settings2, OperatorsIcon as Users, GenerateIcon, ExpandIcon } from '../../../components/icons'
import { copy, CURRENT_LOCALE } from '../../../copy'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import { formatResultHistorySummary, formatWorkspaceDate } from '../../../lib/workspace-history'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../../lib/workspace-limits'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { getMaaExportNotice } from '../../tool/optimize/maa-export-notice'
import type { V2Workflow } from '../WorkspaceSections'
import type { V2Section } from '../navigation'
import GenerationProgressDemo from '../GenerationProgressDemo'
import { Facts, Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.optimize

export default function Generation({ workflow: w, progress: progressContent, disabledReason, preparationStep, onOperators, onNavigate, onConfig }: { workflow: V2Workflow; progress?: ReactNode; disabledReason?: string | null; preparationStep?: number; onOperators: () => void; onNavigate: (section: V2Section) => void; onConfig: () => void }) {
  const { features } = useSiteFeatures()
  const action = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = action.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      element.closest<HTMLElement>('.v2-main')?.style.setProperty('--v2-generation-action-height', `${element.getBoundingClientRect().height}px`)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [preparationStep])
  const exportNotice = getMaaExportNotice(w.activeConfig.schedule_mode, features.maa_export, w)
  const saving = w.configSyncStatus === 'pending' || w.configSyncStatus === 'saving'
  const error = w.inlineError?.scope === 'generate' ? w.inlineError : null
  const busy = w.loading || w.licenseSyncing || (error?.retry === 'save' && saving)
  const disabled = busy || !w.configValidation.ok || w.resultIsCurrent || Boolean(disabledReason)
  const progress = w.progress?.mode === 'generate' ? w.progress : null
  const latest = w.latestWorkspaceResult
  const readyLabel = w.resultIsCurrent ? text.pages_tool_optimize_GenerateControlBar_001 : w.hasResult ? text.pages_tool_optimize_GenerateControlBar_002 : text.pages_tool_optimize_GenerateControlBar_003
  const busyLabel = saving ? text.generation.saving : w.licenseSyncing ? text.pages_tool_optimize_GenerateControlBar_004 : progress?.queueStatus === 'queued' ? text.pages_tool_optimize_GenerateControlBar_005 : progress?.completedAt ? text.pages_tool_optimize_GenerateControlBar_006 : text.pages_tool_optimize_GenerateControlBar_007
  const hasCoupons = (w.priorityCouponBalance?.available ?? 0) > 0 || (!w.userCanUseUpgradeFeatures && (w.itemBalances.training_diagnosis_coupon ?? 0) > 0)
  const configLabel = w.userCanEditConfig ? `${SCHEDULE_MODE_LABELS[normalizeScheduleMode(w.activeConfig.schedule_mode)]} · ${w.activeConfig.layout} · ${w.activeConfig.desc}` : `${SCHEDULE_MODE_LABELS[normalizeScheduleMode(w.activeConfig.schedule_mode)]} · ${w.configPresetLabel}`
  if (preparationStep === 1 || preparationStep === 2) return <section className="v2-first-schedule-task">
    <SectionTitle title={preparationStep === 1 ? copy.v2.firstSchedule.import : copy.v2.firstSchedule.configTitle}
      description={preparationStep === 1 ? copy.v2.generationImport : copy.v2.firstSchedule.configHelp} />
    <Notice>{exportNotice}</Notice>
    {preparationStep === 2 && <Facts items={[[copy.v2.operators, copy.v2.owned(w.mergedOperators.filter((operator) => operator.own).length)], [copy.v2.facilities, configLabel]]} />}
    <button type="button" className="v2-button v2-button-primary" disabled={busy} onClick={preparationStep === 1 ? onOperators : onConfig}>
      {preparationStep === 1 ? <Users size={18} /> : <Settings2 size={18} />}{preparationStep === 1 ? copy.public.pages_LandingPage_001 : copy.v2.firstSchedule.configAction}
    </button>
  </section>
  return <div className="v2-generation-workspace">
    <div className="v2-generation-state"><span className="v2-status-dot" /><strong>{readyLabel}</strong>{w.configChanged && <span>{text.pages_tool_optimize_GenerateControlBar_009}</span>}</div>
    <div className="v2-generation-flow">
      <section className="v2-generation-preparation"><SectionTitle title={copy.v2.prepare} />
        <div className="v2-preparation-row"><Users size={20} aria-hidden="true" /><div><h3>{text.pages_tool_optimize_GenerateControlBar_015}</h3><strong>{w.mergedOperators.length}{text.pages_tool_optimize_GenerateControlBar_016}</strong></div><button className="v2-text-button" aria-label={copy.v2.operators} onClick={onOperators}>{copy.v2.operators}<ArrowRight size={16} /></button></div>
        <div className="v2-preparation-row"><Settings2 size={20} aria-hidden="true" /><div><h3>{text.pages_tool_optimize_GenerateControlBar_017}</h3><strong>{configLabel}</strong><p>{w.configChanged ? copy.v2.generationPage.configChanged : copy.v2.generationPage.configUnchanged}</p></div><button className="v2-text-button" aria-label={text.pages_tool_optimize_GenerateControlBar_032} onClick={onConfig}>{text.pages_tool_optimize_GenerateControlBar_032}<ArrowRight size={16} /></button></div>
        <Notice error>{!w.configValidation.ok && w.configValidation.message}</Notice>
        <Notice error>{w.inventoryError}{w.inventoryError && <button className="v2-text-button" disabled={w.inventoryLoading} onClick={() => void w.refreshInventory()}>{text.pages_tool_optimize_OptimizeWorkflowPage_006}</button>}</Notice>
      </section>
      <div className="v2-generation-execution">
        <p className="v2-generation-export-notice">{exportNotice}</p>
        <details className="v2-generation-options" open={(w.priorityCouponBalance?.available ?? 0) > 0 && !window.matchMedia?.('(max-width: 40rem)').matches}><summary>{copy.v2.generationPage.options}{w.priorityCouponBalance && !hasCoupons && <span>{copy.v2.generationPage.couponsEmpty}</span>}{(w.usePriorityCoupon || w.useTrainingDiagnosisCoupon) && <span>{copy.v2.generationPage.optionsSelected}</span>}<ExpandIcon size={16} aria-hidden="true" /></summary>
        <label className="v2-coupon-option"><input type="checkbox" checked={w.usePriorityCoupon} disabled={(w.priorityCouponBalance?.available ?? 0) < 1 || busy} onChange={(event) => w.setUsePriorityCoupon(event.target.checked)} /><span><strong>{text.pages_tool_optimize_GenerateControlBar_021}</strong><small>{text.pages_tool_optimize_GenerateControlBar_023}</small><small>{copy.v2.generationPage.priorityBalance(w.priorityCouponBalance?.available ?? 0)}{w.priorityCouponBalance?.next_expiry_at ? ` · ${copy.v2.generationPage.priorityExpiry(new Date(w.priorityCouponBalance.next_expiry_at).toLocaleDateString(CURRENT_LOCALE))}` : ''}</small></span></label>
        {!w.userCanUseUpgradeFeatures && (w.itemBalances.training_diagnosis_coupon ?? 0) > 0 && <label className="v2-coupon-option"><input type="checkbox" checked={w.useTrainingDiagnosisCoupon} disabled={busy} onChange={(event) => w.setUseTrainingDiagnosisCoupon(event.target.checked)} /><span><strong>{copy.inventory.training_coupon}</strong><small>{copy.inventory.training_coupon_help}</small><small>{copy.inventory.coupon_available}{w.itemBalances.training_diagnosis_coupon}</small></span></label>}
        </details>
        <Notice error>{w.billingQuoteError}{w.billingQuoteError && <button className="v2-text-button" onClick={() => void w.refreshBillingQuote()}>{copy.metered.quote.retry}</button>}</Notice>
        {w.billingQuote?.sufficient === false && <button className="v2-text-button" onClick={() => onNavigate('balance')}>{copy.metered.quote.go_to_balance}</button>}
        <Notice>{disabledReason}</Notice>
        <div ref={action} className="v2-generation-action">
        {w.billingQuote && <p className="v2-generation-quote">{copy.metered.quote.summary(w.billingQuote.charge, w.billingQuote.available, w.billingQuote.tier, w.billingQuote.sufficient)}</p>}
        <button className="v2-button v2-button-primary v2-generate-submit" disabled={disabled} aria-busy={busy} onClick={() => void w.handleGenerate()}>{busy ? <RefreshCw size={18} className="v2-spin" aria-hidden="true" /> : w.resultIsCurrent ? <Check size={18} /> : <GenerateIcon size={18} aria-hidden="true" />}{busy ? busyLabel : w.resultIsCurrent ? text.pages_tool_optimize_GenerateControlBar_028 : w.hasResult ? copy.v2.regenerate : copy.v2.execute}</button>
        </div>
        <GenerationProgressDemo />
        {w.resultIsCurrent && <p className="v2-muted">{text.pages_tool_optimize_GenerateControlBar_031}</p>}
        <Notice error>{error && <>{error.message}<div className="v2-actions"><button type="button" className="v2-button v2-button-secondary" disabled={busy || saving} onClick={() => error.retry === 'save' ? w.retryConfigSave() : void w.handleGenerate()}>{saving ? text.generation.saving : error.retry === 'save' ? text.generation.retry_save : copy.v2.generationPage.retry}</button>{error.retry !== 'save' && <button type="button" className="v2-text-button" onClick={onOperators}>{copy.v2.operators}</button>}</div></>}</Notice>
      </div>
    </div>
    {progressContent && <div className="v2-generation-progress">{progressContent}</div>}
    <section className="v2-generation-history"><SectionTitle title={text.pages_tool_optimize_OverviewSection_012} action={<button className="v2-text-button" onClick={() => onNavigate('plans')}>{copy.v2.history}<ArrowRight size={16} /></button>} />
      {latest ? <><h3>{latest.name}</h3><p>{formatWorkspaceDate(latest.created_at)} · {formatResultHistorySummary(latest)}</p><div className="v2-actions"><button className="v2-button v2-button-secondary" onClick={() => void w.handleViewHistory(latest)}>{text.pages_tool_optimize_OverviewSection_018}</button>{features.maa_export && <button className="v2-text-button" disabled={w.workspaceBusyAction === `download:${latest.id}` || !latest.maa_exportable} onClick={() => void w.handleDownloadHistory(latest)}>{w.workspaceBusyAction === `download:${latest.id}` ? copy.inventory.export_downloading : text.pages_tool_optimize_OverviewSection_019}</button>}<button className="v2-text-button" disabled={w.loading || !latest.has_config} onClick={() => void w.handleUseHistoryConfig(latest)}>{copy.v2.historyPage.useResultConfig}</button></div></> : <p>{copy.v2.generationPage.historyEmpty}</p>}
      <Facts items={[[copy.v2.savedConfigurations, `${w.savedConfigs.length}/${w.profileCapacity?.plan_slots.limit ?? WORKSPACE_SAVED_CONFIG_LIMIT}`], [copy.v2.savedResults, `${w.profileCapacity?.history_slots.used ?? w.resultHistory.length}/${w.profileCapacity?.history_slots.limit ?? WORKSPACE_RESULT_HISTORY_LIMIT}`]]} />
    </section>
  </div>
}
