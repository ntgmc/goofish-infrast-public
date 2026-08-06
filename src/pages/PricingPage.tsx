import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import CompactHeaderMenu from '../components/CompactHeaderMenu'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy, CURRENT_LOCALE } from '../copy/index'
import { PUBLIC_PRICING_PLAN_IDS } from '../lib/public-content'
import { usePublicContent } from '../lib/public-content-context'
import { getMeteredBillingPolicy, getMeteredScheduleQuote } from '../lib/metered-billing'
import { useSiteFeatures } from '../lib/site-feature-context'

export default function PricingPage() {
  const { content } = usePublicContent()
  const pricing = content.pricing
  const plans = PUBLIC_PRICING_PLAN_IDS.map((id) => ({ id, ...pricing.plans[id] }))
  const featureState = useSiteFeatures()
  const metered = getMeteredBillingPolicy()
  const commercialTiers = metered.commercial.tiers.map((tier) => ({
    ...tier,
    chargePoints: getMeteredScheduleQuote('metered_commercial', tier.threshold_points).charge,
  }))
  const highestCommercialCharge = commercialTiers[0]!.chargePoints
  const lowestCommercialCharge = commercialTiers[commercialTiers.length - 1]!.chargePoints
  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-shell">
        <header className="public-nav">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3">
            <BrandLogo size="sm" className="sm:h-10 sm:w-10 sm:rounded-lg sm:p-1" />
            <span className="truncate text-sm font-semibold text-ink-primary">{copy.public.pages_PricingPage_001}</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label={copy.public.pages_PricingPage_001}>
            <div className="sm:hidden"><ThemeSwitcher iconOnly /></div>
            <div className="sm:hidden">
              <CompactHeaderMenu
                ariaLabel={copy.common.components_CompactHeaderMenu_002}
                triggerVariant="icon"
                items={[
                  { type: 'link', id: 'support', label: copy.public.pages_PricingPage_010, to: '/support' },
                  { type: 'link', id: 'home', label: copy.public.pages_PricingPage_011, to: '/' },
                ]}
              />
            </div>
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            <Link to="/support" className="tool-nav-link hidden items-center px-3 sm:inline-flex">{copy.public.pages_PricingPage_010}</Link>
            <Link to="/" className="tool-secondary-action hidden sm:inline-flex">{copy.public.pages_PricingPage_011}</Link>
          </nav>
        </header>

        <section className="border-b border-surface-4 py-12 sm:py-16">
          <p className="public-kicker">{pricing.eyebrow}</p>
          <h1 className="display-title mt-3 text-3xl text-ink-primary sm:text-4xl">{pricing.title}</h1>
          <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-7 text-ink-secondary">{pricing.intro}</p>
          <div className="mt-8 grid border-t border-surface-4 md:grid-cols-2">
            {plans.map((plan) => (
              <article key={plan.id} className="flex h-full flex-col border-b border-surface-3 py-6 md:border-r md:px-6 md:first:pl-0 md:last:border-r-0">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-semibold text-ink-primary">{plan.label}</h2>
                  <span className="tool-status tool-status--current">{plan.badge}</span>
                </div>
                <p className="mt-5 text-4xl font-semibold tracking-tight text-brand-400 tabular-nums">{plan.display_price}</p>
                <p className="mt-4 whitespace-pre-line text-sm leading-7 text-ink-secondary">{plan.summary}</p>
                <p className="mt-4 whitespace-pre-line border-t border-surface-3 pt-4 text-sm leading-6 text-ink-muted">{plan.account_scope}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-b border-surface-4 py-8" aria-labelledby="metered-pricing-title">
          <h2 id="metered-pricing-title" className="text-xl font-semibold text-ink-primary">{copy.metered.pricing.title}</h2>
          {featureState.status === 'loading' ? (
            <p className="mt-4 text-sm text-ink-secondary" role="status">{copy.metered.pricing.checking_availability}</p>
          ) : featureState.status === 'ready' && featureState.features.metered_billing ? (
            <>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <article className="tool-panel p-5"><h3 className="font-semibold text-ink-primary">{copy.metered.pricing.personal_title}</h3><p className="mt-3 text-3xl font-semibold text-brand-400">{copy.metered.pricing.personal_price(metered.personal.main_schedule_points)}</p><p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.metered.pricing.personal_description}</p></article>
                <article className="tool-panel p-5">
                  <h3 className="font-semibold text-ink-primary">{copy.metered.pricing.commercial_title}</h3>
                  <p className="mt-3 text-3xl font-semibold text-brand-400">
                    {copy.metered.pricing.commercial_price(formatPoints(lowestCommercialCharge), formatPoints(highestCommercialCharge))}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-ink-secondary">
                    {copy.metered.pricing.commercial_description(
                      formatPoints(commercialTiers[0]!.threshold_points),
                      formatCount(metered.commercial.default_active_profile_limit),
                      formatCount(metered.commercial.default_total_profile_limit),
                    )}
                  </p>
                </article>
              </div>
              <p className="mt-4 text-sm leading-7 text-ink-secondary">{copy.metered.pricing.capabilities}</p>

              <div className="mt-8 grid gap-8 lg:grid-cols-2">
                <section aria-labelledby="metered-billing-rules-title">
                  <h3 id="metered-billing-rules-title" className="text-base font-semibold text-ink-primary">{copy.metered.pricing.billing_title}</h3>
                  <ol className="mt-4 grid gap-3">
                    {copy.metered.pricing.billing_steps.map((step, index) => (
                      <li key={step.title} className="tool-inset flex gap-3 p-4">
                        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-400/30 bg-brand-400/10 text-xs font-semibold text-brand-400">{index + 1}</span>
                        <div>
                          <h4 className="text-sm font-semibold text-ink-primary">{step.title}</h4>
                          <p className="mt-1 text-sm leading-6 text-ink-secondary">{step.description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                <section aria-labelledby="commercial-rules-title">
                  <h3 id="commercial-rules-title" className="text-base font-semibold text-ink-primary">{copy.metered.pricing.commercial_rules_title}</h3>
                  <ul className="mt-4 grid gap-2 text-sm leading-6 text-ink-secondary">
                    <li>{copy.metered.pricing.commercial_unlock_rule(formatPoints(commercialTiers[0]!.threshold_points))}</li>
                    <li>{copy.metered.pricing.commercial_limits_rule(
                      formatCount(metered.commercial.default_active_profile_limit),
                      formatCount(metered.commercial.default_total_profile_limit),
                      formatCount(metered.commercial.max_running_jobs),
                      formatCount(metered.commercial.max_queued_jobs),
                      formatCount(metered.commercial.max_submissions_per_hour),
                    )}</li>
                    <li>{copy.metered.pricing.commercial_debt_rule}</li>
                    <li>{copy.metered.pricing.commercial_use_rule}</li>
                  </ul>

                  <div className="mt-4 overflow-x-auto">
                    <table aria-label={copy.metered.pricing.commercial_tier_table_label} className="w-full min-w-[560px] text-left text-sm">
                      <thead className="text-ink-muted">
                        <tr>
                          <th scope="col" className="p-3">{copy.metered.pricing.commercial_tier_level}</th>
                          <th scope="col" className="p-3">{copy.metered.pricing.commercial_tier_threshold}</th>
                          <th scope="col" className="p-3">{copy.metered.pricing.commercial_tier_discount}</th>
                          <th scope="col" className="p-3">{copy.metered.pricing.commercial_tier_charge}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-3 text-ink-secondary">
                        {commercialTiers.map((tier) => (
                          <tr key={tier.level}>
                            <th scope="row" className="p-3 font-medium text-ink-primary">Lv{tier.level}</th>
                            <td className="p-3 tabular-nums">{copy.metered.pricing.commercial_tier_points_value(formatPoints(tier.threshold_points))}</td>
                            <td className="p-3 tabular-nums">-{tier.discount_bps / 100}%</td>
                            <td className="p-3 tabular-nums">{copy.metered.pricing.commercial_tier_points_value(formatPoints(tier.chargePoints))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="tool-alert mt-4" role="note">
              <strong className="block text-sm text-ink-primary">{copy.metered.pricing.unavailable}</strong>
              {featureState.status === 'error' && <span className="mt-1 block text-sm text-ink-secondary">{copy.metered.pricing.availability_unavailable}</span>}
            </div>
          )}
        </section>

        <section className="border-b border-surface-4 py-8" aria-labelledby="pricing-policy-title">
          <h2 id="pricing-policy-title" className="text-xl font-semibold text-ink-primary">{pricing.policy_heading}</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-7 text-ink-secondary md:grid-cols-2">
            {pricing.disclosures.map((item, index) => <li key={`${index}-${item}`} className="whitespace-pre-line border-l-2 border-warning/55 pl-4">{item}</li>)}
          </ul>
        </section>

        <section className="border-b border-surface-4 py-8" aria-labelledby="pricing-comparison-title">
          <h2 id="pricing-comparison-title" className="text-xl font-semibold text-ink-primary">{pricing.comparison_heading}</h2>
          <div className="mt-4 overflow-x-auto">
            <table aria-label={pricing.comparison_heading} className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-ink-muted"><tr><th className="p-3">{copy.public.pages_PricingPage_008}</th>{plans.map((plan) => <th key={plan.id} className="p-3">{plan.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-surface-3 text-ink-secondary">
                {pricing.comparison_rows.map((row) => <tr key={row.id}><th className="p-3 font-medium text-ink-primary">{row.feature}</th><td className="whitespace-pre-line p-3">{row.free_preview}</td><td className="whitespace-pre-line p-3">{row.single_account_lifetime}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="py-8 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div><h2 className="text-lg font-semibold text-ink-primary">{pricing.support_heading}</h2><p className="mt-2 whitespace-pre-line text-sm leading-7 text-ink-secondary">{content.qq_group.name}（{content.qq_group.number}） · {pricing.support_body}</p></div>
          <SupportGroupLink className="tool-primary-action mt-5 inline-flex items-center justify-center sm:mt-0">{copy.public.pages_PricingPage_010}</SupportGroupLink>
        </section>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}

function formatPoints(value: string): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return new Intl.NumberFormat(CURRENT_LOCALE, { maximumFractionDigits: 2 }).format(amount)
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(CURRENT_LOCALE).format(value)
}
