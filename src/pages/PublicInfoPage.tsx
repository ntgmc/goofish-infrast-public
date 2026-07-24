import BrandLogo from '../components/BrandLogo'
import CompactHeaderMenu from '../components/CompactHeaderMenu'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { Link } from 'react-router-dom'
import { copy } from '../copy/index'
import { productPolicies } from '../lib/product-catalog'
import { usePublicContent } from '../lib/public-content-context'
import { PERSONAL_USE_DECLARATION } from '../lib/personal-use-declaration'


export type PublicInfoPageKind = 'faq' | 'support' | 'privacy' | 'terms' | 'disclaimer'

const EFFECTIVE_DATE = copy.public.pages_PublicInfoPage_001

type LegalSection = {
  id: string
  heading: string
  paragraphs: readonly string[]
  items?: readonly string[]
}

const legalContent: Record<Exclude<PublicInfoPageKind, 'faq' | 'support'>, readonly LegalSection[]> = {
  privacy: [
    {
      id: 'processed-information',
      heading: copy.public.pages_PublicInfoPage_018,
      paragraphs: [
        copy.public.pages_PublicInfoPage_019,
        copy.public.pages_PublicInfoPage_020,
        copy.public.pages_PublicInfoPage_021,
      ],
    },
    {
      id: 'purpose-and-third-parties',
      heading: copy.public.pages_PublicInfoPage_022,
      paragraphs: [
        copy.public.pages_PublicInfoPage_023,
        copy.public.pages_PublicInfoPage_024,
      ],
    },
    {
      id: 'storage-security-rights',
      heading: copy.public.pages_PublicInfoPage_025,
      paragraphs: [
        copy.public.pages_PublicInfoPage_026,
        copy.public.pages_PublicInfoPage_027,
      ],
    },
    {
      id: 'personal-use-confirmation-records',
      heading: copy.personalUse.terms_personal_use_heading,
      paragraphs: [copy.personalUse.privacy_acceptance_notice],
    },
  ],
  terms: [
    {
      id: 'service-description',
      heading: copy.public.pages_PublicInfoPage_028,
      paragraphs: [
        copy.public.pages_PublicInfoPage_029,
        copy.public.pages_PublicInfoPage_030,
      ],
    },
    {
      id: 'user-obligations',
      heading: copy.public.pages_PublicInfoPage_031,
      paragraphs: [
        copy.public.pages_PublicInfoPage_032,
        copy.public.pages_PublicInfoPage_033,
      ],
    },
    {
      id: 'service-limitations',
      heading: copy.public.pages_PublicInfoPage_034,
      paragraphs: [
        copy.public.pages_PublicInfoPage_035,
        copy.public.pages_PublicInfoPage_036,
      ],
    },
    {
      id: 'personal-use-declaration',
      heading: copy.personalUse.terms_personal_use_heading,
      paragraphs: [copy.personalUse.terms_personal_use_intro],
    },
    ...PERSONAL_USE_DECLARATION.sections,
  ],
  disclaimer: [
    {
      id: 'reference-only',
      heading: copy.public.pages_PublicInfoPage_037,
      paragraphs: [
        copy.public.pages_PublicInfoPage_038,
        copy.public.pages_PublicInfoPage_039,
      ],
    },
    {
      id: 'third-parties-and-ip',
      heading: copy.public.pages_PublicInfoPage_040,
      paragraphs: [
        copy.public.pages_PublicInfoPage_041,
        copy.public.pages_PublicInfoPage_042,
      ],
    },
  ],
}

const pageMeta: Record<PublicInfoPageKind, { title: string; eyebrow: string; intro: string }> = {
  faq: { title: copy.public.pages_PublicInfoPage_043, eyebrow: copy.public.pages_PublicInfoPage_044, intro: copy.public.pages_PublicInfoPage_045 },
  support: { title: copy.public.pages_PublicInfoPage_046, eyebrow: copy.public.pages_PublicInfoPage_047, intro: copy.public.pages_PublicInfoPage_048 },
  privacy: { title: copy.public.pages_PublicInfoPage_049, eyebrow: copy.public.pages_PublicInfoPage_050, intro: copy.public.pages_PublicInfoPage_051 },
  terms: { title: copy.public.pages_PublicInfoPage_052, eyebrow: copy.public.pages_PublicInfoPage_053, intro: copy.public.pages_PublicInfoPage_054 },
  disclaimer: { title: copy.public.pages_PublicInfoPage_055, eyebrow: copy.public.pages_PublicInfoPage_056, intro: copy.public.pages_PublicInfoPage_057 },
}

export default function PublicInfoPage({ page }: { page: PublicInfoPageKind }) {
  const { content } = usePublicContent()
  const meta = page === 'faq'
    ? { title: content.faq.title, eyebrow: content.faq.eyebrow, intro: content.faq.intro }
    : pageMeta[page]

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-shell">
        <header className="public-nav">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3">
            <BrandLogo size="sm" className="sm:h-10 sm:w-10 sm:rounded-lg sm:p-1" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_058}</span>
              <span className="hidden truncate text-xs text-ink-muted sm:block">{copy.public.pages_PublicInfoPage_059}</span>
            </span>
          </Link>
          <nav className="flex shrink-0 items-center justify-end gap-2 text-sm font-medium" aria-label={copy.public.pages_PublicInfoPage_060}>
            <div className="sm:hidden"><ThemeSwitcher iconOnly /></div>
            <div className="sm:hidden">
              <CompactHeaderMenu
                ariaLabel={copy.common.components_CompactHeaderMenu_002}
                triggerVariant="icon"
                items={[
                  { type: 'link', id: 'faq', label: 'FAQ', to: '/faq', current: page === 'faq' },
                  { type: 'link', id: 'support', label: copy.public.pages_PublicInfoPage_061, to: '/support', current: page === 'support' },
                  { type: 'link', id: 'home', label: copy.public.pages_PublicInfoPage_062, to: '/' },
                ]}
              />
            </div>
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            <Link to="/faq" className="tool-nav-link hidden items-center px-3 sm:inline-flex">FAQ</Link>
            <Link to="/support" className="tool-nav-link hidden items-center px-3 sm:inline-flex">{copy.public.pages_PublicInfoPage_061}</Link>
            <Link to="/" className="tool-secondary-action hidden sm:inline-flex">{copy.public.pages_PublicInfoPage_062}</Link>
          </nav>
        </header>

        <article className="public-document">
        <header className="public-document-header">
          <p className="public-kicker">{meta.eyebrow}</p>
          <h1 className="display-title mt-3 text-3xl leading-tight text-ink-primary sm:text-4xl">{meta.title}</h1>
          <p className="mt-4 text-base leading-8 text-ink-secondary">{meta.intro}</p>
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && (
            <p className="tool-status mt-4">{copy.public.pages_PublicInfoPage_063}{EFFECTIVE_DATE}</p>
          )}
        </header>

        <div>
          {page === 'faq' && <FaqContent />}
          {page === 'support' && <SupportContent />}
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && <LegalContent sections={legalContent[page]} />}
        </div>
        </article>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}

function FaqContent() {
  const { content } = usePublicContent()
  return (
    <section aria-label={copy.public.pages_PublicInfoPage_064}>
      <div>
        {content.faq.items.map((item) => (
          <details key={item.id} className="group border-b border-surface-3 py-3 transition-colors has-[summary:focus-visible]:border-brand-500/55 has-[summary:focus-visible]:bg-surface-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 rounded-lg text-base font-semibold text-ink-primary focus-visible:outline-none">
              {item.question}
              <span className="text-xl leading-none text-brand-300 transition group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <div className="max-w-3xl pb-3 pt-2">
              <p className="whitespace-pre-line text-sm leading-7 text-ink-secondary">{item.answer}</p>
              {item.action === 'qq_group' && <SupportGroupLink className="tool-secondary-action mt-3" />}
            </div>
          </details>
        ))}
      </div>
      <div className="public-prose-section">
        <h2 className="text-lg font-semibold text-ink-primary">{content.faq.cta_heading}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-secondary">{content.faq.cta_body}</p>
        <SupportGroupLink className="tool-primary-action mt-4" />
      </div>
    </section>
  )
}

function SupportContent() {
  return (
    <section>
      <div className="public-prose-section sm:flex sm:items-center sm:justify-between sm:gap-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_067}</h2>
          <p className="mt-3 text-sm leading-7 text-ink-secondary">{copy.public.pages_PublicInfoPage_068}</p>
        </div>
        <SupportGroupLink className="tool-primary-action mt-6 sm:mt-0" />
      </div>
      <div className="grid border-b border-surface-3 sm:grid-cols-2">
        <div className="py-6 sm:pr-6">
          <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_069}</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            <li>{copy.public.pages_PublicInfoPage_070}</li>
            <li>{copy.public.pages_PublicInfoPage_071}</li>
            <li>{copy.public.pages_PublicInfoPage_072}</li>
          </ul>
        </div>
        <div className="border-t border-surface-3 py-6 sm:border-l sm:border-t-0 sm:pl-6">
          <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_073}</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            <li>{copy.public.pages_PublicInfoPage_074}</li>
            <li>{copy.public.pages_PublicInfoPage_075}</li>
            <li>{copy.public.pages_PublicInfoPage_076}</li>
          </ul>
        </div>
      </div>
      <div className="public-prose-section">
        <h2 className="text-xl font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_079}</h2>
        <p className="mt-3 text-sm leading-7 text-ink-secondary">{copy.public.pages_PublicInfoPage_080}</p>
        <div className="mt-4 grid border-y border-surface-3 sm:grid-cols-2">
          <div className="py-4 sm:pr-4"><ul className="space-y-2 text-sm leading-6 text-ink-secondary">{productPolicies.support.required_information.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div className="border-t border-surface-3 py-4 sm:border-l sm:border-t-0 sm:pl-4"><ul className="space-y-2 text-sm leading-6 text-ink-secondary">{productPolicies.support.forbidden_information.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
        <p className="mt-4 text-sm leading-7 text-ink-secondary">{productPolicies.support.sla_statement}</p>
      </div>
    </section>
  )
}

function LegalContent({ sections }: { sections: readonly LegalSection[] }) {
  return (
    <div>
      <div>
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="public-prose-section">
            <h2 className="text-xl font-semibold text-ink-primary">{section.heading}</h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-ink-secondary">
              {section.paragraphs.map((paragraph, index) => <p key={`${section.id}-${index}`}>{paragraph}</p>)}
              {section.items && section.items.length > 0 && (
                <ul className="list-disc space-y-2 pl-5">
                  {section.items.map((item, index) => <li key={`${section.id}-item-${index}`}>{item}</li>)}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="public-prose-section">
        <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_077}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.pages_PublicInfoPage_078}</p>
        <SupportGroupLink className="tool-secondary-action mt-4" />
      </section>
    </div>
  )
}
