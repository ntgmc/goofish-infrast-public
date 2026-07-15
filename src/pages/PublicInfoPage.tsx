import BrandLogo from '../components/BrandLogo'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import { Link } from 'react-router-dom'
import { copy } from '../copy/index'


export type PublicInfoPageKind = 'faq' | 'support' | 'privacy' | 'terms' | 'disclaimer'

const EFFECTIVE_DATE = copy.public.pages_PublicInfoPage_001

const faqItems = [
  {
    id: 'requirements',
    question: copy.public.pages_PublicInfoPage_002,
    answer: copy.public.pages_PublicInfoPage_003,
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
    id: 'use-json',
    question: copy.public.pages_PublicInfoPage_008,
    answer: copy.public.pages_PublicInfoPage_009,
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
    id: 'delete-account',
    question: copy.public.pages_PublicInfoPage_016,
    answer: copy.public.pages_PublicInfoPage_017,
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
      <div className="tool-page-frame max-w-5xl">
        <header className="tool-page-header flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="tool-nav-link flex items-center gap-3 px-3 text-left">
            <BrandLogo size="md" />
            <span>
              <span className="block text-sm font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_058}</span>
              <span className="block text-xs text-ink-muted">{copy.public.pages_PublicInfoPage_059}</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium" aria-label={copy.public.pages_PublicInfoPage_060}>
            <Link to="/faq" className="tool-nav-link inline-flex items-center px-3">FAQ</Link>
            <Link to="/support" className="tool-nav-link inline-flex items-center px-3">{copy.public.pages_PublicInfoPage_061}</Link>
            <Link to="/" className="tool-secondary-action">{copy.public.pages_PublicInfoPage_062}</Link>
          </nav>
        </header>

        <section className="tool-panel mt-6 p-6 sm:mt-8 sm:p-8">
          <p className="tool-eyebrow">{meta.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-ink-primary sm:text-4xl">{meta.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-secondary">{meta.intro}</p>
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && (
            <p className="tool-status mt-4">{copy.public.pages_PublicInfoPage_063}{EFFECTIVE_DATE}</p>
          )}
        </section>

        <div className="mt-6">
          {page === 'faq' && <FaqContent />}
          {page === 'support' && <SupportContent />}
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && <LegalContent sections={legalContent[page]} />}
        </div>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}

function FaqContent() {
  return (
    <section className="tool-panel p-5 sm:p-6" aria-label={copy.public.pages_PublicInfoPage_064}>
      <div className="space-y-3">
        {faqItems.map((item) => (
          <details key={item.id} className="tool-inset group px-4 py-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 rounded-lg text-base font-semibold text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500/45">
              {item.question}
              <span className="text-xl leading-none text-brand-300 transition group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <p className="max-w-3xl pb-3 pt-2 text-sm leading-7 text-ink-secondary">{item.answer}</p>
          </details>
        ))}
      </div>
      <div className="tool-inset mt-6 p-5">
        <h2 className="text-lg font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_065}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.pages_PublicInfoPage_066}</p>
        <SupportGroupLink className="tool-primary-action mt-4" />
      </div>
    </section>
  )
}

function SupportContent() {
  return (
    <section className="space-y-6">
      <div className="tool-panel p-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_067}</h2>
          <p className="mt-3 text-sm leading-7 text-ink-secondary">{copy.public.pages_PublicInfoPage_068}</p>
        </div>
        <SupportGroupLink className="tool-primary-action mt-6 sm:mt-0" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="tool-inset p-5">
          <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_069}</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            <li>{copy.public.pages_PublicInfoPage_070}</li>
            <li>{copy.public.pages_PublicInfoPage_071}</li>
            <li>{copy.public.pages_PublicInfoPage_072}</li>
          </ul>
        </div>
        <div className="tool-alert tool-alert--warning p-5">
          <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_073}</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            <li>{copy.public.pages_PublicInfoPage_074}</li>
            <li>{copy.public.pages_PublicInfoPage_075}</li>
            <li>{copy.public.pages_PublicInfoPage_076}</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function LegalContent({ sections }: { sections: Array<{ id: string; heading: string; paragraphs: string[] }> }) {
  return (
    <article className="max-w-3xl space-y-4">
      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.id} className="tool-panel p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-ink-primary">{section.heading}</h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-ink-secondary">
              {section.paragraphs.map((paragraph, index) => <p key={`${section.id}-${index}`}>{paragraph}</p>)}
            </div>
          </section>
        ))}
      </div>
      <section className="tool-inset p-5">
        <h2 className="text-base font-semibold text-ink-primary">{copy.public.pages_PublicInfoPage_077}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.pages_PublicInfoPage_078}</p>
        <SupportGroupLink className="tool-secondary-action mt-4" />
      </section>
    </article>
  )
}
