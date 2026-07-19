import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { listPublicSkus, productPolicies } from '../lib/product-catalog'

export default function PricingPage() {
  const skus = listPublicSkus()
  const support = productPolicies.support
  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-6xl">
        <header className="tool-page-header flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="tool-nav-link flex items-center gap-3 px-3 text-left">
            <BrandLogo size="md" />
            <span className="text-sm font-semibold text-ink-primary">{copy.public.pages_PricingPage_001}</span>
          </Link>
          <nav className="flex items-center gap-3" aria-label={copy.public.pages_PricingPage_001}>
            <ThemeSwitcher />
            <Link to="/support" className="tool-nav-link inline-flex items-center px-3">{copy.public.pages_PricingPage_010}</Link>
            <Link to="/" className="tool-secondary-action">{copy.public.pages_PricingPage_011}</Link>
          </nav>
        </header>

        <section className="tool-panel mt-6 overflow-hidden p-6 sm:mt-8 sm:p-8">
          <p className="tool-eyebrow">{copy.public.pages_PricingPage_002}</p>
          <h1 className="mt-3 text-3xl font-semibold text-ink-primary sm:text-4xl">{copy.public.pages_PricingPage_001}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-secondary">{copy.public.pages_PricingPage_003}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {skus.map((sku) => (
              <article key={sku.id} className="tool-inset flex h-full flex-col p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-semibold text-ink-primary">{sku.label}</h2>
                  <span className="tool-status tool-status--current">{sku.price?.billing === 'free' ? copy.public.pages_PricingPage_005 : copy.public.pages_PricingPage_004}</span>
                </div>
                <p className="mt-5 text-4xl font-semibold tracking-tight text-brand-300">{sku.display_price}</p>
                <p className="mt-4 text-sm leading-7 text-ink-secondary">{sku.summary}</p>
                <p className="mt-4 border-t border-surface-3 pt-4 text-sm leading-6 text-ink-muted">{sku.account_scope}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="tool-alert tool-alert--warning mt-6 p-5 sm:p-6" aria-labelledby="pricing-policy-title">
          <h2 id="pricing-policy-title" className="text-xl font-semibold text-ink-primary">{copy.public.pages_PricingPage_006}</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-7 text-ink-secondary md:grid-cols-2">
            {productPolicies.public_disclosures.map((item) => <li key={item} className="rounded-lg bg-surface-1/65 px-4 py-3">{item}</li>)}
          </ul>
        </section>

        <section className="tool-panel mt-6 overflow-hidden p-5 sm:p-6" aria-labelledby="pricing-comparison-title">
          <h2 id="pricing-comparison-title" className="text-xl font-semibold text-ink-primary">{copy.public.pages_PricingPage_007}</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-ink-muted"><tr><th className="p-3">{copy.public.pages_PricingPage_008}</th>{skus.map((sku) => <th key={sku.id} className="p-3">{sku.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-surface-3 text-ink-secondary">
                {productPolicies.public_feature_comparison.map((row) => <tr key={row.feature}><th className="p-3 font-medium text-ink-primary">{row.feature}</th><td className="p-3">{row.free_preview}</td><td className="p-3">{row.single_account_lifetime}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tool-inset mt-6 p-5 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-6">
          <div><h2 className="text-lg font-semibold text-ink-primary">{copy.public.pages_PricingPage_009}</h2><p className="mt-2 text-sm leading-7 text-ink-secondary">{support.channel} · {support.sla_statement}</p></div>
          <SupportGroupLink className="tool-primary-action mt-5 inline-flex items-center justify-center sm:mt-0">{copy.public.pages_PricingPage_010}</SupportGroupLink>
        </section>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}
