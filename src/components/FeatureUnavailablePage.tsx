import { Link } from 'react-router-dom'
import type { SiteFeatureKey } from '../lib/site-features'
import { useSiteFeatures } from '../lib/site-feature-context'
import SessionLoader from './SessionLoader'
import ThemeSwitcher from './ThemeSwitcher'
import BrandLogo from './BrandLogo'
import { copy } from '../copy/index'

export function FeatureRoute({ feature, children }: { feature: SiteFeatureKey; children: React.ReactNode }) {
  const state = useSiteFeatures()
  if (state.status === 'loading') return <SessionLoader label={copy.features.loading} />
  if (state.status === 'error') return <FeatureUnavailablePage loadError onRetry={state.retry} />
  if (!state.features[feature]) return <FeatureUnavailablePage feature={feature} />
  return children
}

export default function FeatureUnavailablePage({
  feature = 'site',
  loadError = false,
  onRetry,
}: {
  feature?: SiteFeatureKey
  loadError?: boolean
  onRetry?: () => void
}) {
  const siteClosed = feature === 'site'
  const title = loadError
    ? copy.features.load_failed_title
    : siteClosed ? copy.features.site_closed_title : copy.features.closed_title
  const body = loadError
    ? copy.features.load_failed_body
    : siteClosed ? copy.features.site_closed_body : copy.features.closed_body
  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <BrandLogo size="md" />
          <ThemeSwitcher />
        </div>
        <section className="tool-panel mt-8 p-6 sm:p-8">
          <p className="tool-eyebrow">{loadError ? copy.features.load_failed_title : copy.features.feature_labels[feature]}</p>
          <h1 className="display-title mt-3 text-2xl text-ink-primary">{title}</h1>
          <p className="mt-4 text-sm leading-6 text-ink-secondary">{body}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {loadError && onRetry && <button type="button" onClick={onRetry} className="tool-primary-action">{copy.features.retry}</button>}
            <Link to="/" className="tool-secondary-action">{copy.features.back_home}</Link>
            <Link to="/account-safety" className="tool-secondary-action">{copy.features.account_safety}</Link>
          </div>
        </section>
      </div>
    </main>
  )
}
