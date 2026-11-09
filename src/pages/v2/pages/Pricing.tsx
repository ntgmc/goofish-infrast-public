import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SelectedIcon as Check, CloseIcon as X, ServiceCongestedIcon as Hourglass, NextIcon as ArrowRight, ExpandIcon as ChevronDown } from '../../../components/icons'
import { copy, CURRENT_LOCALE } from '../../../copy'
import { PUBLIC_PRICING_PLAN_IDS } from '../../../lib/public-content'
import { usePublicContent } from '../../../lib/public-content-context'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { METERED_BILLING_AVAILABLE } from '../../../lib/site-features'
import { getMeteredBillingPolicy, getMeteredScheduleQuote } from '../../../lib/metered-billing'
import { getSku } from '../../../lib/product-catalog'
import Link from '../../../components/InternalLink'
import { FeedbackLink } from '../../../components/PublicFooter'
import { Facts, Notice, SectionTitle } from '../components/WorkspaceUI'
import { RollingValue } from '../../../components/NumberMotion'
import { v2Path } from '../navigation'

const text = copy.public
const planIds = PUBLIC_PRICING_PLAN_IDS.filter((id) => id !== 'free_preview')

export default function Pricing() {
  const { content } = usePublicContent()
  const { features } = useSiteFeatures()
  const [params] = useSearchParams()
  const purchasePath = v2Path('purchase', params.get('profile_id'))
  const [selectedPlan, setSelectedPlan] = useState<(typeof planIds)[number]>('single_account_monthly')
  const [mobile, setMobile] = useState(() => Boolean(window.matchMedia?.('(max-width: 40rem)').matches))
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 40rem)')
    if (!query) return
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const pricing = content.pricing
  const free = pricing.plans.free_preview
  const choice = text.pricing_choice
  const freeAvailable = features.free_preview && features.skland && features.schedule_generation
  const redemptionAvailable = features.site && features.profiles && features.cdk_redemption
  const term = (label: string) => label.replace(/^单账号\s*/u, '').replace(/\s*CDK$/u, '')
  return <div className="v2-pricing-workspace">
    <div className="v2-pricing-intro">
      {mobile ? <div><h2>{choice.free_title} · {free.display_price}</h2><p>{choice.free_features} {free.summary}</p><p>{free.account_scope}</p></div> : <p className="v2-lead">{choice.intro}</p>}
      {freeAvailable ? <Link to="/tool/optimize/overview" className="v2-button v2-button-secondary">{choice.free_action}</Link> : <button disabled className="v2-button v2-button-secondary">{choice.free_unavailable}</button>}
    </div>
    {!features.maa_export && <Notice>{choice.export_unavailable}</Notice>}
    {mobile && <>
      <section className="v2-pricing-shared" aria-labelledby="pricing-shared-title">
        <h2 id="pricing-shared-title">{choice.shared_benefits}</h2>
        <ul className="v2-pricing-benefits">{text.pricing_cards.features.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
      </section>
      <fieldset className="v2-pricing-terms">
        <legend>{choice.choose_term}</legend>
        <div>{planIds.map((id) => <label key={id} data-selected={selectedPlan === id}>
          <input type="radio" name="pricing-term" value={id} checked={selectedPlan === id} onChange={() => setSelectedPlan(id)} />
          <span>{choice.term_labels[id]}<strong>{pricing.plans[id].display_price.split('/')[0]!.trim()}</strong></span>
        </label>)}</div>
      </fieldset>
    </>}
    <section className="v2-pricing-plans" aria-label={copy.v2.planChoice}>
      {(mobile ? [selectedPlan] : planIds).map((id) => {
        const plan = pricing.plans[id]
        const [amount, period] = plan.display_price.split('/')
        const archiveCount = id === 'single_account_lifetime' ? 3 : 1
        return <article key={mobile ? 'selected-plan' : id} className={`v2-pricing-plan${id === 'single_account_lifetime' ? ' v2-pricing-plan-featured' : ''}`} aria-labelledby={`${id}-title`}>
          <header>
            {!mobile && <span className="v2-pricing-badge">{plan.badge}</span>}
            <h2 id={`${id}-title`}>{term(plan.label)}</h2>
            <p className="v2-pricing-price">{mobile && <span>{choice.total_price}</span>}<strong><RollingValue value={amount.trim()} /></strong>{period && <span>／{period.trim()}</span>}</p>
            {plan.discount_fold < 10 && <small>{text.pages_PricingPage_017(plan.original_price, plan.discount_fold)}</small>}
            <p className="v2-pricing-audience">{getSku(id).audience}</p>
          </header>
          {mobile ? <p className="v2-pricing-gift">{text.pricing_archive_gift(archiveCount)}</p> : <ul className="v2-pricing-benefits">
            {[...text.pricing_cards.features, text.pricing_cards.archive_gift(archiveCount)].map((feature) => <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>)}
          </ul>}
          <div className="v2-pricing-plan-footer">
            {mobile ? <div className="v2-pricing-account-scope"><p id={`${id}-purchase-terms`}>{plan.account_scope}</p><p id={`${id}-activation`}>{text.pricing_redemption.activation}</p></div> : <details className="v2-pricing-plan-details">
              <summary>{text.pricing_cards.plan_details}<ChevronDown size={16} aria-hidden="true" /></summary>
              <p>{plan.summary}</p><p id={`${id}-purchase-terms`}>{plan.account_scope}</p><p>{text.pricing_archive_gift(archiveCount)}</p>
            </details>}
            {plan.purchase_url || plan.share_image_url || plan.qr_code_url ? <Link to={`${purchasePath}&offer=${id}`} aria-describedby={`${id}-purchase-terms ${mobile ? `${id}-activation` : 'pricing-purchase-terms'} pricing-purchase-flow`} className={`v2-button ${id === 'single_account_lifetime' ? 'v2-button-primary' : 'v2-button-secondary'}`}>{text.pricing_purchase_labels[id]}<ArrowRight size={16} aria-hidden="true" /></Link> : <button disabled className="v2-button v2-button-secondary">{text.pricing_purchase_unavailable}</button>}
          </div>
        </article>
      })}
    </section>
    <div className="v2-pricing-checkout">
      <div>{!mobile && <p id="pricing-purchase-terms">{text.pages_PricingPage_016} {text.pricing_redemption.activation}</p>}<p id="pricing-purchase-flow">{text.pricing_redemption.flow}</p></div>
      <div className="v2-actions">
        {(content.cdk_purchase.xianyu_url || content.cdk_purchase.share_image_url || content.cdk_purchase.qr_code_url) && <Link to={purchasePath} className="v2-button v2-button-secondary">{text.purchase.general_action}</Link>}
        {redemptionAvailable ? <Link to="/tool/redeem?mode=cdk" className="v2-button v2-button-secondary">{text.pricing_redemption.action}</Link> : <span className="v2-muted">{text.pricing_redemption.unavailable}</span>}
      </div>
    </div>
    <section className="v2-pricing-evidence" aria-label={text.pricing_evidence.title}>
      <div><h2>{text.pricing_evidence.title}</h2><p>{text.pricing_evidence.description}</p><Link to="/v2/benchmarks" className="v2-button v2-button-secondary">{text.pricing_evidence.action}</Link></div>
      <Facts items={[[text.pricing_evidence.execution_label, text.pricing_evidence.execution_value], [text.pricing_evidence.yield_label, text.pricing_evidence.yield_value]]} />
    </section>
    {!mobile && <section className="v2-pricing-free-start" aria-labelledby="pricing-free-title">
      <div><h2 id="pricing-free-title">{choice.free_title} · {free.display_price}</h2><p>{choice.free_features}</p></div>
      <div><p>{free.summary}</p><p className="v2-muted">{free.account_scope}</p></div>
    </section>}
    <details className="v2-pricing-details">
      <summary><h2>{choice.full_comparison}</h2><ChevronDown size={20} aria-hidden="true" /></summary>
      <table className="v2-pricing-comparison" aria-label={pricing.comparison_heading}>
        <thead><tr><th scope="col">{text.pages_PricingPage_008}</th><th scope="col">{choice.free_title}</th>{planIds.map((id) => <th scope="col" key={id}>{choice.term_labels[id]}</th>)}</tr></thead>
        <tbody>{pricing.comparison_rows.map((row) => <tr key={row.id}>
          <th scope="row">{row.feature}</th><td data-label={choice.free_title}><ComparisonValue value={row.free_preview} /></td>{planIds.map((id) => <td key={id} data-label={choice.term_labels[id]}><ComparisonValue value={row[id] ?? '—'} /></td>)}
        </tr>)}</tbody>
      </table>
      <p className="v2-muted">{choice.export_note}</p>
    </details>
    <details className="v2-pricing-details">
      <summary><h2>{text.pricing_cards.rules}</h2><ChevronDown size={20} aria-hidden="true" /></summary>
      <section className="v2-pricing-policy"><SectionTitle title={pricing.policy_heading} description={text.pricing_redemption.instructions} /><ul>{pricing.disclosures.map((disclosure, index) => <li key={index}>{disclosure}</li>)}</ul></section>
      <section className="v2-pricing-upgrade"><SectionTitle title={text.pricing_upgrade_title} description={text.pricing_upgrade_description(pricing.lifetime_upgrade.service_fee)} /><p>{text.pricing_upgrade_process}</p><div className="v2-actions">{features.support && <Link to="/support" className="v2-button v2-button-secondary">{text.pricing_upgrade_contact}</Link>}{pricing.lifetime_upgrade.purchase_url || pricing.lifetime_upgrade.share_image_url || pricing.lifetime_upgrade.qr_code_url ? <Link to={`${purchasePath}&offer=lifetime_upgrade`} className="v2-button v2-button-primary">{text.pricing_upgrade_purchase}</Link> : <button disabled className="v2-button v2-button-primary">{text.pricing_upgrade_unavailable}</button>}</div></section>
    </details>
    {METERED_BILLING_AVAILABLE && <MeteredPricing />}
    <section className="v2-pricing-support"><SectionTitle title={pricing.support_heading} description={pricing.support_body} /><FeedbackLink className="v2-button v2-button-secondary">{text.pages_PricingPage_010}</FeedbackLink></section>
  </div>
}

function ComparisonValue({ value }: { value: string }) {
  const marker = /^([✅❌⏳])\s*/u.exec(value)
  if (!marker) return value
  const Icon = marker[1] === '✅' ? Check : marker[1] === '❌' ? X : Hourglass
  return <><Icon size={16} strokeWidth={2.5} aria-hidden="true" className="v2-pricing-status" data-marker={marker[1]} /> {value.slice(marker[0].length)}</>
}

function MeteredPricing() {
  const featureState = useSiteFeatures()
  const policy = getMeteredBillingPolicy()
  const tiers = policy.commercial.tiers.map((tier) => ({ ...tier, charge: getMeteredScheduleQuote('metered_commercial', tier.threshold_points).charge }))
  const text = copy.metered.pricing
  const format = (value: string | number) => Number(value).toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 2 })
  return <section className="v2-metered-pricing"><SectionTitle title={text.title} />{featureState.status !== 'ready' || !featureState.features.metered_billing ? <Notice>{featureState.status === 'loading' ? text.checking_availability : text.unavailable}{featureState.status === 'error' && ` · ${text.availability_unavailable}`}</Notice> : <><div className="v2-pricing-free"><div><h3>{text.personal_title}</h3><strong>{text.personal_price(policy.personal.main_schedule_points)}</strong></div><p>{text.personal_description}</p></div><div className="v2-pricing-free"><div><h3>{text.commercial_title}</h3><strong>{text.commercial_price(format(tiers[tiers.length - 1]!.charge), format(tiers[0]!.charge))}</strong></div><p>{text.commercial_description(format(tiers[0]!.threshold_points), format(policy.commercial.default_active_profile_limit), format(policy.commercial.default_total_profile_limit))}</p></div><p>{text.capabilities}</p><h3>{text.billing_title}</h3><ol className="v2-support-steps">{text.billing_steps.map((step, index) => <li key={step.title}><span className="v2-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol><h3>{text.commercial_rules_title}</h3><ul className="v2-prose-list"><li>{text.commercial_unlock_rule(format(tiers[0]!.threshold_points))}</li><li>{text.commercial_limits_rule(format(policy.commercial.default_active_profile_limit), format(policy.commercial.default_total_profile_limit), format(policy.commercial.max_running_jobs), format(policy.commercial.max_queued_jobs), format(policy.commercial.max_submissions_per_hour))}</li><li>{text.commercial_debt_rule}</li><li>{text.commercial_use_rule}</li></ul><div className="v2-tier-list" aria-label={text.commercial_tier_table_label}>{tiers.map((tier) => <article key={tier.level}><h4>Lv{tier.level}</h4><dl><div><dt>{text.commercial_tier_threshold}</dt><dd>{text.commercial_tier_points_value(format(tier.threshold_points))}</dd></div><div><dt>{text.commercial_tier_discount}</dt><dd>-{tier.discount_bps / 100}%</dd></div><div><dt>{text.commercial_tier_charge}</dt><dd>{text.commercial_tier_points_value(format(tier.charge))}</dd></div></dl></article>)}</div></>}</section>
}
