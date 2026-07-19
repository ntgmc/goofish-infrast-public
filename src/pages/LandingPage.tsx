import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import PublicFooter from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { ACTIVE_PURCHASE_CHANNEL } from '../lib/purchase'
import { copy } from '../copy/index'
import { useTheme } from '../lib/theme'
import { RevealItem, StaggeredReveal } from '../components/MotionPrimitives'


interface Props {
  onStart: () => void
}

const workflow = [
  {
    id: 'data-source',
    title: copy.public.pages_LandingPage_001,
    description: copy.public.pages_LandingPage_002,
  },
  {
    id: 'infrastructure-config',
    title: copy.public.pages_LandingPage_003,
    description: copy.public.pages_LandingPage_004,
  },
  {
    id: 'export-result',
    title: copy.public.pages_LandingPage_005,
    description: copy.public.pages_LandingPage_006,
  },
]

const metrics = [
  { id: 'total-efficiency', label: copy.public.pages_LandingPage_007, value: '4,169.00%', detail: copy.public.pages_LandingPage_008 },
  { id: 'manufacturing-output', label: copy.public.pages_LandingPage_009, value: copy.public.pages_LandingPage_010, detail: copy.public.pages_LandingPage_011 },
  { id: 'daily-output', label: copy.public.pages_LandingPage_012, value: copy.public.pages_LandingPage_013, detail: copy.public.pages_LandingPage_014 },
  { id: 'sanity-equivalent', label: copy.public.pages_LandingPage_015, value: copy.public.pages_LandingPage_016, detail: copy.public.pages_LandingPage_017 },
]

export default function LandingPage({ onStart }: Props) {
  const purchaseHref = ACTIVE_PURCHASE_CHANNEL?.href
  const { resolvedTheme } = useTheme()

  return (
    <main className="landing-shell min-h-screen" tabIndex={-1} data-route-focus>
      <section className="mx-auto w-full max-w-7xl px-5 pb-16 pt-5 sm:px-8 lg:px-10 lg:pb-24 lg:pt-7">
        <nav className="flex min-h-12 items-center justify-between gap-4 border-b border-surface-3 pb-5">
          <Link to="/" className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none">
            <BrandLogo size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink-primary">{copy.public.pages_LandingPage_018}</span>
              <span className="mt-0.5 block truncate text-xs text-ink-muted">{copy.public.pages_LandingPage_019}</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitcher />
            <Link to="/announcements" className="hidden min-h-11 items-center px-3 text-sm font-medium text-ink-secondary transition-colors hover:text-ink-primary sm:inline-flex">
              {copy.public.pages_LandingPage_020}</Link>
            <button type="button" onClick={onStart} className="tool-primary-action inline-flex items-center justify-center">
              {copy.public.pages_LandingPage_021}</button>
          </div>
        </nav>

        <StaggeredReveal className="grid gap-12 py-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(28rem,1.05fr)] lg:items-center lg:py-24">
          <RevealItem className="max-w-2xl">
            <p className="tool-eyebrow">{copy.public.pages_LandingPage_022}</p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-ink-primary sm:text-5xl lg:text-6xl">
              {copy.public.pages_LandingPage_023}</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8">
              {copy.public.pages_LandingPage_024}</p>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-muted">
              {copy.public.pages_LandingPage_025}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={onStart} className="tool-primary-action inline-flex items-center justify-center">
                {copy.public.pages_LandingPage_026}</button>
              <Link to="/tools/depot-value" className="tool-secondary-action inline-flex items-center justify-center">
                {copy.public.pages_LandingPage_027}</Link>
              {purchaseHref && (
                <a href={purchaseHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center px-3 text-sm font-medium text-ink-secondary transition-colors hover:text-ink-primary">
                  {copy.public.pages_LandingPage_028}</a>
              )}
            </div>

            <dl className="mt-10 grid gap-px overflow-hidden rounded-xl border border-surface-3 bg-surface-3 sm:grid-cols-3">
              <Fact label={copy.public.pages_LandingPage_029} value={copy.public.pages_LandingPage_030} />
              <Fact label={copy.public.pages_LandingPage_031} value={copy.public.pages_LandingPage_032} />
              <Fact label={copy.public.pages_LandingPage_033} value={copy.public.pages_LandingPage_034} />
            </dl>
          </RevealItem>

          <RevealItem><ProductPreview /></RevealItem>
        </StaggeredReveal>
      </section>

      <section className="border-y border-surface-3 bg-surface-1/55 px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1fr)]">
          <div>
            <p className="tool-eyebrow">{copy.public.pages_LandingPage_035}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-ink-primary sm:text-4xl">
              {copy.public.pages_LandingPage_036}</h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-ink-secondary">
              {copy.public.pages_LandingPage_037}</p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-xl border border-surface-3 bg-surface-3 md:grid-cols-3">
            {workflow.map(({ id, ...item }, index) => <WorkflowStep key={id} index={index + 1} {...item} />)}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:px-10 lg:py-24">
        <figure className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
          <picture>
            <img
              src={`/assets/previews/optimize-result-${resolvedTheme}.png`}
              alt={copy.public.pages_LandingPage_038}
              className="block aspect-[16/10] w-full object-cover object-top"
              loading="lazy"
            />
          </picture>
          <figcaption className="border-t border-surface-3 px-4 py-3 text-xs leading-5 text-ink-muted sm:px-5">
            {copy.public.pages_LandingPage_039}</figcaption>
        </figure>

        <div className="lg:py-4">
          <p className="tool-eyebrow">{copy.public.pages_LandingPage_040}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-ink-primary sm:text-4xl">
            {copy.public.pages_LandingPage_041}</h2>
          <p className="mt-4 text-base leading-7 text-ink-secondary">
            {copy.public.pages_LandingPage_042}</p>
          <StaggeredReveal className="mt-8 grid gap-3 sm:grid-cols-2">
            {metrics.map(({ id, ...metric }) => <RevealItem key={id}><MetricTile {...metric} /></RevealItem>)}
          </StaggeredReveal>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-10 lg:pb-24">
        <div className="mx-auto grid max-w-7xl gap-6 rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="tool-eyebrow">{copy.public.pages_LandingPage_043}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink-primary sm:text-3xl">
              {copy.public.pages_LandingPage_044}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-secondary">
              {copy.public.pages_LandingPage_045}</p>
          </div>
          <button type="button" onClick={onStart} className="tool-primary-action inline-flex items-center justify-center whitespace-nowrap">
            {copy.public.pages_LandingPage_046}</button>
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}

function ProductPreview() {
  const { resolvedTheme } = useTheme()

  return (
    <section className="landing-preview overflow-hidden" aria-label={copy.public.pages_LandingPage_047}>
      <div className="landing-preview-window flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-primary">{copy.public.pages_LandingPage_048}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{copy.public.pages_LandingPage_049}</p>
        </div>
        <span className="tool-status tool-status--success shrink-0">{copy.public.pages_LandingPage_050}</span>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">
        <div className="tool-inset overflow-hidden">
          <picture>
            <img
              src={`/assets/previews/upload-entry-${resolvedTheme}.png`}
              alt={copy.public.pages_LandingPage_051}
              className="block aspect-[16/9] w-full object-cover object-top"
            />
          </picture>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="tool-inset p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-primary">{copy.public.pages_LandingPage_052}</p>
              <span className="text-xs font-semibold text-success">{copy.public.pages_LandingPage_053}</span>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-ink-secondary">
              <PreviewStep label={copy.public.pages_LandingPage_054} />
              <PreviewStep label={copy.public.pages_LandingPage_055} />
              <PreviewStep label={copy.public.pages_LandingPage_056} current />
            </ol>
          </div>
          <div className="tool-inset flex min-w-48 flex-col justify-between p-4">
            <div>
              <p className="text-xs font-medium text-ink-muted">{copy.public.pages_LandingPage_057}</p>
              <p className="mt-2 text-sm font-semibold text-ink-primary">{copy.public.pages_LandingPage_058}</p>
              <p className="mt-2 text-xs leading-5 text-ink-muted">{copy.public.pages_LandingPage_059}</p>
            </div>
            <span className="mt-4 inline-flex items-center text-xs font-semibold text-brand-300">{copy.public.pages_LandingPage_060}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 px-4 py-4">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}

function WorkflowStep({ index, title, description }: { index: number; title: string; description: string }) {
  return (
    <li className="bg-surface-1 p-5 sm:p-6">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-brand-500/40 bg-brand-500/10 text-sm font-semibold text-brand-200">
        {index}
      </span>
      <h3 className="mt-5 text-base font-semibold text-ink-primary">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{description}</p>
    </li>
  )
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="landing-preview-metric p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold tracking-[-0.02em] text-ink-primary">{value}</p>
      <p className="mt-2 text-xs leading-5 text-ink-muted">{detail}</p>
    </div>
  )
}

function PreviewStep({ label, current = false }: { label: string; current?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${current ? 'border-brand-400 bg-brand-500/15 text-brand-200' : 'border-success/45 bg-success/10 text-success'}`} aria-hidden="true">
        {current ? '3' : '✓'}
      </span>
      <span>{label}</span>
    </li>
  )
}
