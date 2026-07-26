import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import CompactHeaderMenu from '../components/CompactHeaderMenu'
import PublicFooter from '../components/PublicFooter'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import { usePublicContent } from '../lib/public-content-context'

export default function ThanksPage() {
  const { content } = usePublicContent()
  const thanks = content.thanks

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-shell">
        <header className="public-nav">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3">
            <BrandLogo size="sm" className="sm:h-10 sm:w-10 sm:rounded-lg sm:p-1" />
            <span className="truncate text-sm font-semibold text-ink-primary">{thanks.title}</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label={thanks.title}>
            <div className="sm:hidden"><ThemeSwitcher iconOnly /></div>
            <div className="sm:hidden">
              <CompactHeaderMenu
                ariaLabel={copy.common.components_CompactHeaderMenu_002}
                triggerVariant="icon"
                items={[
                  { type: 'link', id: 'faq', label: 'FAQ', to: '/faq' },
                  { type: 'link', id: 'home', label: copy.public.pages_PublicInfoPage_062, to: '/' },
                ]}
              />
            </div>
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            <Link to="/faq" className="tool-nav-link hidden items-center px-3 sm:inline-flex">FAQ</Link>
            <Link to="/" className="tool-secondary-action hidden sm:inline-flex">{copy.public.pages_PublicInfoPage_062}</Link>
          </nav>
        </header>

        <article className="public-document">
          <header className="public-document-header">
            <p className="public-kicker">{thanks.eyebrow}</p>
            <h1 className="display-title mt-3 text-3xl leading-tight text-ink-primary sm:text-4xl">{thanks.title}</h1>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-base leading-8 text-ink-secondary">{thanks.intro}</p>
          </header>

          {thanks.sections.map((section) => (
            <section key={section.id} className="public-prose-section" aria-labelledby={`thanks-${section.id}`}>
              <h2 id={`thanks-${section.id}`} className="text-xl font-semibold text-ink-primary">{section.heading}</h2>
              <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-ink-secondary">{section.intro}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {section.entries.map((entry) => (
                  <article key={entry.id} className="tool-inset p-5">
                    <div className="flex items-start gap-4">
                      {entry.avatar_url && (
                        <img
                          src={entry.avatar_url}
                          alt={copy.publicContent.thanks_github_avatar_alt.replace('{name}', entry.name)}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="h-14 w-14 shrink-0 rounded-full border border-surface-3 bg-surface-2 object-cover shadow-sm"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words text-base font-semibold text-ink-primary">
                          {entry.url ? (
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">{entry.name}</a>
                          ) : entry.name}
                        </h3>
                        {entry.description && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-secondary">{entry.description}</p>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </article>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}
