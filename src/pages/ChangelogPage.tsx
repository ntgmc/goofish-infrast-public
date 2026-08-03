import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import PublicFooter from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { CHANGELOG_RELEASES } from '../lib/changelog'
import type { ChangelogSection } from '../lib/changelog'

const GENERATED_SECTION_TITLES = {
  feature: copy.public.pages_ChangelogPage_021,
  fix: copy.public.pages_ChangelogPage_022,
  performance: copy.public.pages_ChangelogPage_023,
  security: copy.public.pages_ChangelogPage_024,
} as const

export default function ChangelogPage() {
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
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            <Link to="/" className="tool-secondary-action hidden sm:inline-flex">{copy.public.pages_PublicInfoPage_062}</Link>
          </nav>
        </header>

        <article className="public-document">
          <header className="public-document-header">
            <p className="public-kicker">{copy.public.pages_ChangelogPage_001}</p>
            <h1 className="display-title mt-3 text-3xl leading-tight text-ink-primary sm:text-4xl">{copy.public.pages_ChangelogPage_002}</h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-ink-secondary">{copy.public.pages_ChangelogPage_003}</p>
          </header>

          <div className="mt-10">
            {CHANGELOG_RELEASES.map((release) => (
              <article key={release.id} className="border-t border-surface-3 py-8 first:border-t-0 first:pt-0" aria-labelledby={`release-${release.id}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
                  <h2 id={`release-${release.id}`} className="text-xl font-semibold text-ink-primary">
                    {release.displayVersion}
                  </h2>
                  <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                    <time dateTime={release.releasedAt}>{copy.public.pages_ChangelogPage_006}{release.releasedAt}</time>
                    {release.targetSha && <code title={release.targetSha} className="font-mono text-xs">{copy.public.pages_ChangelogPage_018}{release.targetSha.slice(0, 7)}</code>}
                  </div>
                </div>

                {release.sections.length > 0 ? (
                  <div className="mt-6 divide-y divide-surface-3 border-y border-surface-3">
                    {release.sections.map((section) => (
                      <section key={section.id} className="py-5 first:pt-0 last:pb-0">
                        <h3 className="text-base font-semibold text-ink-primary">{resolveSectionTitle(section)}</h3>
                        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-ink-secondary marker:text-brand-300">
                          {section.items.map((item, itemIndex) => <li key={`${section.id}:${itemIndex}`}>{item}</li>)}
                        </ul>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="tool-inset mt-6 px-4 py-3 text-sm leading-6 text-ink-secondary">
                    {release.kind === 'baseline' ? copy.public.pages_ChangelogPage_019 : copy.public.pages_ChangelogPage_020}
                  </p>
                )}
              </article>
            ))}
          </div>
        </article>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}

function resolveSectionTitle(section: ChangelogSection): string {
  if (section.title) return section.title
  return section.kind === 'custom' ? section.id : GENERATED_SECTION_TITLES[section.kind]
}
