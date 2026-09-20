import { Link } from 'react-router'
import { useId, useState } from 'react'
import { copy } from '../../../copy'
import { productPolicies } from '../../../lib/product-catalog'

export default function PaidCapabilityPreview({ onOpen, showScenarioLab }: { onOpen: (target: 'config' | 'result' | 'lab') => void; showScenarioLab: boolean }) {
  const text = copy.optimize.paid_preview
  const [expanded, setExpanded] = useState<string | null>(null)
  const id = useId()
  return (
    <details open className="tool-panel p-5">
      <summary className="cursor-pointer font-medium text-ink-primary">{text.title}</summary>
      <p className="mt-3 text-sm leading-6 text-ink-secondary">{text.description}</p>
      <dl className="mt-4 divide-y divide-surface-3">
        {[
          { title: text.config, detail: text.config_detail, target: 'config' as const },
          { title: text.recompute, detail: text.recompute_detail, preview: text.recompute_preview },
          { title: text.exports, detail: text.exports_benefit, target: 'result' as const, trial: true },
          { title: text.analysis, detail: text.analysis_detail, target: 'result' as const },
          { title: text.lab, detail: text.lab_detail, target: showScenarioLab ? 'lab' as const : undefined, preview: text.lab_unavailable },
          { title: text.import, detail: text.import_detail, preview: text.import_preview },
        ].map(({ title, detail, target, preview, trial }, index) => (
          <div key={title} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-primary">{title}<span className="tool-status">{text.advanced}</span></dt>
              <dd className="mt-1 text-sm leading-6 text-ink-secondary">{detail}</dd>
              {trial && <dd className="mt-2 text-xs leading-5 text-ink-muted"><span className="font-medium">{text.trial_export}</span> · {text.trial_export_detail}</dd>}
              {!target && expanded === title && <dd id={`${id}-${index}`} className="tool-inset mt-3 space-y-3 p-3">
                <p className="text-sm leading-6 text-ink-secondary">{preview}</p>
                {title !== text.lab && <button type="button" disabled className="tool-secondary-action">{title} · {text.readonly_action}</button>}
              </dd>}
            </div>
            <button type="button" className="tool-secondary-action shrink-0" onClick={() => target ? onOpen(target) : setExpanded(expanded === title ? null : title)} aria-label={`${text.open}：${title}`} aria-expanded={target ? undefined : expanded === title} aria-controls={!target && expanded === title ? `${id}-${index}` : undefined}>{text.open}</button>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-6 text-ink-secondary">{text.conclusion}</p>
        <Link to="/pricing" className="tool-primary-action">{text.compare}</Link>
      </div>
    </details>
  )
}

export function LockedScenarioPreview() {
  const text = copy.optimize.paid_preview
  return (
    <section className="tool-panel space-y-4 p-5 sm:p-6" aria-label={text.lab}>
      <h2 className="text-lg font-semibold text-ink-primary">{text.lab_title}</h2>
      <p className="text-sm leading-6 text-ink-secondary">{text.lab_description}</p>
      <fieldset disabled className="tool-inset min-w-0 space-y-3 p-4">
        <legend className="text-sm text-ink-muted">{text.readonly}</legend>
        <label className="block text-sm">{text.baseline}<input className="tool-field mt-2" value={text.baseline} readOnly /></label>
        <label className="block text-sm">{text.alternative}<select className="tool-field mt-2"><option>{text.add}</option></select></label>
        <button type="button" className="tool-secondary-action">{text.run}</button>
      </fieldset>
      <p className="tool-inset p-4 text-sm text-ink-muted">{text.pending}</p>
      <p className="text-sm text-ink-secondary">{text.lab_detail}</p>
      <p className="text-sm text-ink-secondary">{text.quotas(productPolicies.metered_billing.scenario_quotas.month, productPolicies.metered_billing.scenario_quotas.half_year, productPolicies.metered_billing.scenario_quotas.year)}</p>
      <Link to="/pricing" className="inline-block text-sm text-brand-200 underline">{text.compare}</Link>
    </section>
  )
}

export function LockedResultPreview() {
  const text = copy.optimize.paid_preview
  return (
    <section className="tool-panel mt-4 space-y-4 p-5" aria-label={text.exports}>
      <h2 className="font-semibold text-ink-primary">{text.exports}</h2>
      <p className="text-sm leading-6 text-ink-secondary">{text.exports_detail}</p>
      <button type="button" disabled className="tool-secondary-action">{text.export_action}</button>
      <h3 className="font-medium text-ink-primary">{text.analysis}</h3>
      <p className="text-sm leading-6 text-ink-secondary">{text.analysis_detail}</p>
      <div className="tool-inset p-4 text-sm text-ink-muted"><p>{text.roi}</p><p className="mt-2">{text.result_pending}</p></div>
      <Link to="/pricing" className="inline-block text-sm text-brand-200 underline">{text.compare}</Link>
    </section>
  )
}
