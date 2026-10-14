import { useState } from 'react'
import { Check, ArrowUpRight, ChevronDown } from 'lucide-react'
import { copy, CURRENT_LOCALE } from '../../../copy'
import { PUBLIC_PRICING_PLAN_IDS } from '../../../lib/public-content'
import { usePublicContent } from '../../../lib/public-content-context'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { METERED_BILLING_AVAILABLE } from '../../../lib/site-features'
import { getMeteredBillingPolicy, getMeteredScheduleQuote } from '../../../lib/metered-billing'
import { getSku, productPolicies } from '../../../lib/product-catalog'
import Link from '../../../components/InternalLink'
import { SupportGroupLink } from '../../../components/PublicFooter'
import { Notice, SectionTitle } from '../components/WorkspaceUI'

const text = copy.public
const planIds = PUBLIC_PRICING_PLAN_IDS.filter((id) => id !== 'free_preview')

export default function Pricing() {
  const { content } = usePublicContent()
  const { features } = useSiteFeatures()
  const pricing = content.pricing
  const [chosen, setChosen] = useState<(typeof planIds)[number]>('single_account_monthly')
  const plan = pricing.plans[chosen]
  const free = pricing.plans.free_preview
  const choice = text.pricing_choice
  const quota = productPolicies.free_preview
  const freeAvailable = features.free_preview && features.skland && features.schedule_generation
  const term = (label: string) => label.replace(/^单账号\s*/u, '').replace(/\s*CDK$/u, '')
  return <div className="v2-pricing-workspace">
    <p className="v2-lead">{choice.intro}</p>
    <div className="v2-pricing-paths">
      <article aria-labelledby="pricing-free-title">
        <div className="v2-pricing-path-heading"><h2 id="pricing-free-title">{choice.free_title}</h2><strong>{free.display_price}</strong></div>
        <p>{choice.free_description}</p>
        {freeAvailable ? <Link to="/tool/optimize/overview" className="v2-button v2-button-primary">{choice.free_action}</Link> : <button disabled className="v2-button v2-button-primary">{choice.free_unavailable}</button>}
        <p className="v2-muted">{free.account_scope}</p>
      </article>
      <article aria-labelledby="pricing-paid-title">
        <h2 id="pricing-paid-title">{choice.paid_title}</h2>
        <p>{choice.paid_description}</p>
        <a href="#pricing-terms" className="v2-button v2-button-secondary">{choice.paid_action}</a>
        <p className="v2-muted">{text.pages_PricingPage_016}</p>
      </article>
    </div>
    <section className="v2-pricing-highlights" aria-labelledby="pricing-highlights-title">
      <h2 id="pricing-highlights-title">{choice.highlights_title}</h2>
      <table className="v2-pricing-comparison" aria-labelledby="pricing-highlights-title">
        <thead><tr><th scope="col">{text.pages_PricingPage_008}</th><th scope="col">{choice.free_title}</th><th scope="col">{choice.paid_title}</th></tr></thead>
        <tbody>{choice.highlights(quota.submission_window_hours, quota.max_submissions_per_window).map((row) => <tr key={row.label}>
          <th scope="row">{row.label}</th><td data-label={choice.free_title}>{row.free}</td><td data-label={choice.paid_title}>{row.paid}</td>
        </tr>)}</tbody>
      </table>
      <p className="v2-muted">{choice.export_note}</p>
      {!features.maa_export && <Notice>{choice.export_unavailable}</Notice>}
    </section>
    <section id="pricing-terms" className="v2-pricing-selector" aria-label={choice.paid_action} tabIndex={-1}>
      <div>
        <SectionTitle title={copy.v2.planChoice} description={pricing.intro} />
        <div className="v2-term-choices" role="group" aria-label={copy.v2.planChoice}>{planIds.map((id) => <button type="button" key={id} aria-pressed={chosen === id} onClick={() => setChosen(id)}>
          <span><strong>{choice.term_labels[id]}</strong><small>{pricing.plans[id].display_price.split('/')[0].trim()}</small></span>
          {chosen === id && <Check size={18} aria-hidden="true" />}
        </button>)}</div>
      </div>
      <article className="v2-pricing-selected" aria-labelledby="pricing-selected-title">
        <h2 id="pricing-selected-title">{term(plan.label)}</h2>
        <strong className="v2-plan-price">{plan.display_price}</strong>
        {plan.discount_fold < 10 && <small>{text.pages_PricingPage_017(plan.original_price, plan.discount_fold)}</small>}
        <p>{getSku(chosen).audience}</p>
        <p>{plan.summary}</p>
        <p>{text.pricing_archive_gift(chosen === 'single_account_lifetime' ? 3 : 1)}</p>
        <p className="v2-muted">{plan.account_scope}</p>
        {plan.purchase_url ? <a href={plan.purchase_url} target="_blank" rel="noopener noreferrer" className="v2-button v2-button-primary">{text.pricing_purchase_labels[chosen]}<ArrowUpRight size={16} aria-hidden="true" /></a> : <button disabled className="v2-button v2-button-primary">{text.pricing_purchase_unavailable}</button>}
      </article>
    </section>
    <details className="v2-pricing-details">
      <summary><h2>{choice.full_comparison}</h2><ChevronDown size={20} aria-hidden="true" /></summary>
      <table className="v2-pricing-comparison" aria-label={pricing.comparison_heading}>
        <thead><tr><th scope="col">{text.pages_PricingPage_008}</th><th scope="col">{free.label}</th><th scope="col">{term(plan.label)}</th></tr></thead>
        <tbody>{pricing.comparison_rows.map((row) => <tr key={row.id}>
          <th scope="row">{row.feature}</th><td data-label={choice.free_title}>{row.free_preview}</td><td data-label={choice.term_labels[chosen]}>{row[chosen] ?? '—'}</td>
        </tr>)}</tbody>
      </table>
    </details>
    <section className="v2-pricing-upgrade"><SectionTitle title={text.pricing_upgrade_title} description={text.pricing_upgrade_description(pricing.lifetime_upgrade.service_fee)} /><p>{text.pricing_upgrade_process}</p><div className="v2-actions">{features.support && <Link to="/support" className="v2-button v2-button-secondary">{text.pricing_upgrade_contact}</Link>}{pricing.lifetime_upgrade.purchase_url ? <a href={pricing.lifetime_upgrade.purchase_url} target="_blank" rel="noopener noreferrer" className="v2-button v2-button-primary">{text.pricing_upgrade_purchase}</a> : <button disabled className="v2-button v2-button-primary">{text.pricing_upgrade_unavailable}</button>}</div></section>
    {METERED_BILLING_AVAILABLE && <MeteredPricing />}
    <section className="v2-pricing-policy"><SectionTitle title={pricing.policy_heading} /><ul>{pricing.disclosures.map((disclosure, index) => <li key={index}>{disclosure}</li>)}</ul></section>
    <section className="v2-pricing-support"><SectionTitle title={pricing.support_heading} description={`${content.qq_group.name}（${content.qq_group.number}） · ${pricing.support_body}`} /><SupportGroupLink className="v2-button v2-button-secondary">{text.pages_PricingPage_010}</SupportGroupLink></section>
  </div>
}

function MeteredPricing() {
  const featureState = useSiteFeatures()
  const policy = getMeteredBillingPolicy()
  const tiers = policy.commercial.tiers.map((tier) => ({ ...tier, charge: getMeteredScheduleQuote('metered_commercial', tier.threshold_points).charge }))
  const text = copy.metered.pricing
  const format = (value: string | number) => Number(value).toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 2 })
  return <section className="v2-metered-pricing"><SectionTitle title={text.title} />{featureState.status !== 'ready' || !featureState.features.metered_billing ? <Notice>{featureState.status === 'loading' ? text.checking_availability : text.unavailable}{featureState.status === 'error' && ` · ${text.availability_unavailable}`}</Notice> : <><div className="v2-pricing-free"><div><h3>{text.personal_title}</h3><strong>{text.personal_price(policy.personal.main_schedule_points)}</strong></div><p>{text.personal_description}</p></div><div className="v2-pricing-free"><div><h3>{text.commercial_title}</h3><strong>{text.commercial_price(format(tiers[tiers.length - 1]!.charge), format(tiers[0]!.charge))}</strong></div><p>{text.commercial_description(format(tiers[0]!.threshold_points), format(policy.commercial.default_active_profile_limit), format(policy.commercial.default_total_profile_limit))}</p></div><p>{text.capabilities}</p><h3>{text.billing_title}</h3><ol className="v2-support-steps">{text.billing_steps.map((step, index) => <li key={step.title}><span className="v2-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol><h3>{text.commercial_rules_title}</h3><ul className="v2-prose-list"><li>{text.commercial_unlock_rule(format(tiers[0]!.threshold_points))}</li><li>{text.commercial_limits_rule(format(policy.commercial.default_active_profile_limit), format(policy.commercial.default_total_profile_limit), format(policy.commercial.max_running_jobs), format(policy.commercial.max_queued_jobs), format(policy.commercial.max_submissions_per_hour))}</li><li>{text.commercial_debt_rule}</li><li>{text.commercial_use_rule}</li></ul><div className="v2-tier-list" aria-label={text.commercial_tier_table_label}>{tiers.map((tier) => <article key={tier.level}><h4>Lv{tier.level}</h4><dl><div><dt>{text.commercial_tier_threshold}</dt><dd>{text.commercial_tier_points_value(format(tier.threshold_points))}</dd></div><div><dt>{text.commercial_tier_discount}</dt><dd>-{tier.discount_bps / 100}%</dd></div><div><dt>{text.commercial_tier_charge}</dt><dd>{text.commercial_tier_points_value(format(tier.charge))}</dd></div></dl></article>)}</div></>}</section>
}
