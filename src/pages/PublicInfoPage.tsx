import BrandLogo from '../components/BrandLogo'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { Link } from 'react-router-dom'
import { copy } from '../copy/index'
import { productPolicies } from '../lib/product-catalog'


export type PublicInfoPageKind = 'faq' | 'support' | 'privacy' | 'terms' | 'disclaimer'

const EFFECTIVE_DATE = copy.public.pages_PublicInfoPage_001

const faqItems = [
  {
    id: 'requirements',
    question: copy.public.pages_PublicInfoPage_002,
    answer: copy.public.pages_PublicInfoPage_003,
  },
  {
    id: 'account-concepts',
    question: copy.public.pages_PublicInfoPage_081,
    answer: copy.public.pages_PublicInfoPage_082,
  },
  {
    id: 'game-password',
    question: copy.public.pages_PublicInfoPage_083,
    answer: copy.public.pages_PublicInfoPage_084,
  },
  {
    id: 'free-versus-lifetime',
    question: copy.public.pages_PublicInfoPage_085,
    answer: copy.public.pages_PublicInfoPage_086,
  },
  {
    id: 'cdk-account',
    question: copy.public.pages_PublicInfoPage_004,
    answer: copy.public.pages_PublicInfoPage_005,
  },
  {
    id: 'skland-data',
    question: copy.public.pages_PublicInfoPage_006,
    answer: copy.public.pages_PublicInfoPage_007,
  },
  {
    id: 'skland-save',
    question: copy.public.pages_PublicInfoPage_087,
    answer: copy.public.pages_PublicInfoPage_088,
  },
  {
    id: 'skland-refresh',
    question: copy.public.pages_PublicInfoPage_089,
    answer: copy.public.pages_PublicInfoPage_090,
  },
  {
    id: 'use-json',
    question: copy.public.pages_PublicInfoPage_008,
    answer: copy.public.pages_PublicInfoPage_009,
  },
  {
    id: 'json-unavailable',
    question: copy.public.pages_PublicInfoPage_091,
    answer: copy.public.pages_PublicInfoPage_092,
  },
  {
    id: 'schedule-modes',
    question: copy.public.pages_PublicInfoPage_093,
    answer: copy.public.pages_PublicInfoPage_094,
  },
  {
    id: 'result-differences',
    question: copy.public.pages_PublicInfoPage_010,
    answer: copy.public.pages_PublicInfoPage_011,
  },
  {
    id: 'depot-versus-schedule',
    question: copy.public.pages_PublicInfoPage_012,
    answer: copy.public.pages_PublicInfoPage_013,
  },
  {
    id: 'import-failure',
    question: copy.public.pages_PublicInfoPage_014,
    answer: copy.public.pages_PublicInfoPage_015,
  },
  {
    id: 'change-bound-account',
    question: copy.public.pages_PublicInfoPage_095,
    answer: copy.public.pages_PublicInfoPage_096,
  },
  {
    id: 'data-security',
    question: copy.public.pages_PublicInfoPage_097,
    answer: copy.public.pages_PublicInfoPage_098,
  },
  {
    id: 'delete-account',
    question: copy.public.pages_PublicInfoPage_016,
    answer: copy.public.pages_PublicInfoPage_017,
  },
  {
    id: 'support-info',
    question: copy.public.pages_PublicInfoPage_099,
    answer: copy.public.pages_PublicInfoPage_100,
  },
]

const legalContent: Record<Exclude<PublicInfoPageKind, 'faq' | 'support'>, Array<{ id: string; heading: string; paragraphs: string[] }>> = {
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
  const meta = pageMeta[page]

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-shell">
        <header className="public-nav flex-wrap">
          <Link to="/" className="flex min-w-0 items-center gap-3 text-left">
            <BrandLogo size="md" />
            <span>
              <span className="block text-sm font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_058}</span>
              <span className="block text-xs text-ink-muted">{copy.public.pages_PublicInfoPage_059}</span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center justify-end gap-2 text-sm font-medium" aria-label={copy.public.pages_PublicInfoPage_060}>
            <ThemeSwitcher />
            <Link to="/faq" className="tool-nav-link inline-flex items-center px-3">FAQ</Link>
            <Link to="/support" className="tool-nav-link inline-flex items-center px-3">{copy.public.pages_PublicInfoPage_061}</Link>
            <Link to="/" className="tool-secondary-action">{copy.public.pages_PublicInfoPage_062}</Link>
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
  return (
    <section aria-label={copy.public.pages_PublicInfoPage_064}>
      <div>
        {faqItems.map((item) => (
          <details key={item.id} className="group border-b border-surface-3 py-3 transition-colors has-[summary:focus-visible]:border-brand-500/55 has-[summary:focus-visible]:bg-surface-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 rounded-lg text-base font-semibold text-ink-primary focus-visible:outline-none">
              {item.question}
              <span className="text-xl leading-none text-brand-300 transition group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <p className="max-w-3xl pb-3 pt-2 text-sm leading-7 text-ink-secondary">{item.answer}</p>
          </details>
        ))}
      </div>
      <div className="public-prose-section">
        <h2 className="text-lg font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_065}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.pages_PublicInfoPage_066}</p>
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

function LegalContent({ sections }: { sections: Array<{ id: string; heading: string; paragraphs: string[] }> }) {
  return (
    <div>
      <div>
        {sections.map((section) => (
          <section key={section.id} className="public-prose-section">
            <h2 className="text-xl font-semibold text-ink-primary">{section.heading}</h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-ink-secondary">
              {section.paragraphs.map((paragraph, index) => <p key={`${section.id}-${index}`}>{paragraph}</p>)}
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
