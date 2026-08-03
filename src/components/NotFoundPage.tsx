import { Link, useLocation } from 'react-router'
import { copy } from '../copy/index'

export default function NotFoundPage() {
  const location = useLocation()

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <section className="tool-panel mx-auto max-w-2xl p-6 sm:p-10" aria-labelledby="not-found-title">
        <p className="tool-eyebrow">{copy.common.components_NotFoundPage_001}</p>
        <h1 id="not-found-title" className="display-title mt-3 text-3xl text-ink-primary">
          {copy.common.components_NotFoundPage_002}
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink-secondary">
          {copy.common.components_NotFoundPage_003}
        </p>
        <p className="mt-3 overflow-x-auto rounded-xl border border-line-soft bg-surface-1 px-4 py-3 font-mono text-sm text-ink-primary">
          {location.pathname}
        </p>
        <nav className="mt-6 flex flex-wrap gap-3" aria-label={copy.common.components_NotFoundPage_004}>
          <Link to="/" replace className="tool-primary-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            {copy.common.components_NotFoundPage_005}
          </Link>
          <Link to="/tool/profiles" replace className="tool-secondary-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            {copy.common.components_NotFoundPage_006}
          </Link>
        </nav>
      </section>
    </main>
  )
}
