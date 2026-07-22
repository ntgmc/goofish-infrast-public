import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
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
        <header className="public-nav flex-wrap">
          <Link to="/" className="flex min-w-0 items-center gap-3 text-left">
            <BrandLogo size="md" />
            <span className="text-sm font-semibold text-ink-primary">{thanks.title}</span>
          </Link>
          <nav className="flex items-center gap-3" aria-label={thanks.title}>
            <ThemeSwitcher />
            <Link to="/faq" className="tool-nav-link inline-flex items-center px-3">FAQ</Link>
            <Link to="/" className="tool-secondary-action">{copy.public.pages_PublicInfoPage_062}</Link>
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
                    <h3 className="text-base font-semibold text-ink-primary">
                      {entry.url ? (
                        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">{entry.name}</a>
                      ) : entry.name}
                    </h3>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-secondary">{entry.description}</p>
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
