import BrandLogo from '../components/BrandLogo'
import CompactHeaderMenu from '../components/CompactHeaderMenu'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Link } from 'react-router'
import { copy } from '../copy/index'
import { productPolicies } from '../lib/product-catalog'
import { usePublicContent } from '../lib/public-content-context'
import { PERSONAL_USE_DECLARATION } from '../lib/personal-use-declaration'
import { useSiteFeatures } from '../lib/site-feature-context'


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
      id: 'behavior-risk-controls',
      heading: copy.public.pages_PublicInfoPage_101,
      paragraphs: [
        copy.public.pages_PublicInfoPage_102,
        copy.public.pages_PublicInfoPage_103,
        copy.public.pages_PublicInfoPage_104,
        copy.public.pages_PublicInfoPage_105,
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

export default function PublicInfoPage({ page, embedded = false }: { page: PublicInfoPageKind; embedded?: boolean }) {
  const PageRoot = embedded ? 'section' : 'main'
  const { features } = useSiteFeatures()
  const { content } = usePublicContent()
  const meta = page === 'faq'
    ? { title: content.faq.title, eyebrow: content.faq.eyebrow, intro: content.faq.intro }
    : pageMeta[page]

  return (
    <PageRoot className={embedded ? 'v2-embedded-tool' : 'tool-page'} tabIndex={-1} data-route-focus>
      <div className={embedded ? undefined : 'public-shell'}>
        {!embedded && <header className="public-nav">
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
                  ...(features.faq ? [{ type: 'link' as const, id: 'faq', label: 'FAQ', to: '/faq', current: page === 'faq' }] : []),
                  ...(features.support ? [{ type: 'link' as const, id: 'support', label: copy.public.pages_PublicInfoPage_061, to: '/support', current: page === 'support' }] : []),
                  { type: 'link', id: 'home', label: copy.public.pages_PublicInfoPage_062, to: '/' },
                ]}
              />
            </div>
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            {features.faq && <Link to="/faq" className="tool-nav-link hidden items-center px-3 sm:inline-flex">FAQ</Link>}
            {features.support && <Link to="/support" className="tool-nav-link hidden items-center px-3 sm:inline-flex">{copy.public.pages_PublicInfoPage_061}</Link>}
            <Link to="/" className="tool-secondary-action hidden sm:inline-flex">{copy.public.pages_PublicInfoPage_062}</Link>
          </nav>
        </header>}

        <article className={embedded ? 'v2-document' : 'public-document'}>
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
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && <LegalContent sections={legalContent[page]} withContents={embedded} />}
        </div>
        </article>
      </div>
      {!embedded && <PublicFooter variant="tool" className="mt-10" />}
    </PageRoot>
  )
}

function FaqContent() {
  const { content } = usePublicContent()
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const items = content.faq.items.filter((item) => {
    const text = `${item.question}\n${item.answer}`.toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
  return (
    <section className="document-faq" aria-label={copy.public.pages_PublicInfoPage_064}>
      <div className="document-faq-search mb-4 pt-6">
        <label htmlFor="faq-search" className="mb-2 block text-sm font-medium text-ink-primary">{copy.public.faq_search_label}</label>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input ref={searchInput} id="faq-search" type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={copy.public.faq_search_placeholder} aria-describedby="faq-search-results" className="tool-field pl-10" />
          </div>
          {search && <button type="button" className="tool-secondary-action shrink-0" onClick={() => { setSearch(''); searchInput.current?.focus() }}>{copy.public.faq_search_clear}</button>}
        </div>
        <p id="faq-search-results" role="status" className="mt-2 text-sm text-ink-muted">
          {terms.length > 0 ? copy.public.faq_search_results(items.length) : copy.public.faq_total(items.length)}
        </p>
      </div>
      {items.length === 0 && <div className="border-y border-surface-3 py-8">
        <p className="font-medium text-ink-primary">{copy.public.faq_search_empty}</p>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.faq_search_empty_hint}</p>
      </div>}
      <div className="document-faq-results">
        {items.map((item) => (
          <details key={item.id} open={terms.length > 0 || undefined} className="group border-b border-surface-3 py-3 transition-colors has-[summary:focus-visible]:border-brand-500/55 has-[summary:focus-visible]:bg-surface-1">
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
    <section className="document-support">
      <div className="document-support-contact public-prose-section sm:flex sm:items-center sm:justify-between sm:gap-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_067}</h2>
          <p className="mt-3 text-sm leading-7 text-ink-secondary">{copy.public.pages_PublicInfoPage_068}</p>
        </div>
        <SupportGroupLink className="tool-primary-action mt-6 sm:mt-0" />
      </div>
      <div className="document-support-guidance grid border-b border-surface-3 sm:grid-cols-2">
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
      <div className="document-support-requests public-prose-section">
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

function LegalContent({ sections, withContents = false }: { sections: readonly LegalSection[]; withContents?: boolean }) {
  return (
    <div className={withContents ? 'v2-document-layout' : undefined}>
      {withContents && <nav className="v2-document-contents" aria-label={copy.v2.contents}>
        <strong>{copy.v2.contents}</strong>
        {sections.map((section) => <a key={section.id} href={`#${section.id}`} title={section.heading}>{section.heading}</a>)}
      </nav>}
      <div className={withContents ? 'v2-document-reading' : undefined}>
        {sections.map((section) => (
          <section key={section.id} id={section.id} tabIndex={withContents ? -1 : undefined} className="public-prose-section">
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
      <section className="public-prose-section">
        <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_077}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.pages_PublicInfoPage_078}</p>
        <SupportGroupLink className="tool-secondary-action mt-4" />
      </section>
      </div>
    </div>
  )
}
