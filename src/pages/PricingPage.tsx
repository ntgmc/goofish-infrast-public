import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { PUBLIC_PRICING_PLAN_IDS } from '../lib/public-content'
import { usePublicContent } from '../lib/public-content-context'

export default function PricingPage() {
  const { content } = usePublicContent()
  const pricing = content.pricing
  const plans = PUBLIC_PRICING_PLAN_IDS.map((id) => ({ id, ...pricing.plans[id] }))
  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-shell">
        <header className="public-nav flex-wrap">
          <Link to="/" className="flex min-w-0 items-center gap-3 text-left">
            <BrandLogo size="md" />
            <span className="text-sm font-semibold text-ink-primary">{copy.public.pages_PricingPage_001}</span>
          </Link>
          <nav className="flex items-center gap-3" aria-label={copy.public.pages_PricingPage_001}>
            <ThemeSwitcher />
            <Link to="/support" className="tool-nav-link inline-flex items-center px-3">{copy.public.pages_PricingPage_010}</Link>
            <Link to="/" className="tool-secondary-action">{copy.public.pages_PricingPage_011}</Link>
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

        <section className="border-b border-surface-4 py-8" aria-labelledby="pricing-policy-title">
          <h2 id="pricing-policy-title" className="text-xl font-semibold text-ink-primary">{pricing.policy_heading}</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-7 text-ink-secondary md:grid-cols-2">
            {pricing.disclosures.map((item, index) => <li key={`${index}-${item}`} className="whitespace-pre-line border-l-2 border-warning/55 pl-4">{item}</li>)}
          </ul>
        </section>

        <section className="border-b border-surface-4 py-8" aria-labelledby="pricing-comparison-title">
          <h2 id="pricing-comparison-title" className="text-xl font-semibold text-ink-primary">{pricing.comparison_heading}</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
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
