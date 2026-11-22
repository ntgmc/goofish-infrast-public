import { Link } from 'react-router'
import { isPausableSiteFeature, type SiteFeatureKey } from '../lib/site-features'
import { useSiteFeatures } from '../lib/site-feature-context'
import SessionLoader from './SessionLoader'
import ThemeSwitcher from './ThemeSwitcher'
import BrandLogo from './BrandLogo'
import SklandIcon from './SklandIcon'
import { InfoIcon, NextIcon as ArrowRight, RefreshIcon, SecurityIcon, ServiceCongestedIcon as Hourglass } from './icons'
import { copy } from '../copy/index'
import './FeatureUnavailablePage.css'

export function FeatureRoute({ feature, children, renderPending }: {
  feature: SiteFeatureKey
  children: React.ReactNode
  renderPending?: (status: 'loading' | 'error', retry: () => void) => React.ReactNode
}) {
  const state = useSiteFeatures()
  if (state.status === 'loading') return renderPending?.('loading', state.retry) ?? <SessionLoader label={copy.features.loading} />
  if (state.status === 'error') return renderPending?.('error', state.retry) ?? <FeatureUnavailablePage loadError onRetry={state.retry} />
  if (!state.features[feature]) return <FeatureUnavailablePage feature={feature} pauseNotice={isPausableSiteFeature(feature) ? state.pauseNotices?.[feature] : undefined} />
  return children
}

export default function FeatureUnavailablePage({
  feature = 'site',
  loadError = false,
  onRetry,
  pauseNotice,
}: {
  feature?: SiteFeatureKey
  loadError?: boolean
  onRetry?: () => void
  pauseNotice?: string
}) {
  const siteClosed = feature === 'site'
  const title = loadError
    ? copy.features.load_failed_title
    : pauseNotice ? copy.features.paused_title : siteClosed ? copy.features.site_closed_title : copy.features.closed_title
  const body = loadError
    ? copy.features.load_failed_body
    : pauseNotice ?? (siteClosed ? copy.features.site_closed_body : copy.features.closed_body)
  const StatusIcon = loadError ? InfoIcon : Hourglass
  const statusLabel = pauseNotice ? copy.features.paused_title : copy.features.paused
  return (
    <main className="feature-unavailable-page" tabIndex={-1} data-route-focus>
      <div className="feature-unavailable-frame">
        <header className="feature-unavailable-header">
          <BrandLogo size="md" />
          <ThemeSwitcher />
        </header>
        <div className="feature-unavailable-main">
          <section className={`feature-unavailable-panel${loadError ? ' is-error' : ''}`} aria-labelledby="feature-unavailable-title">
            <div className="feature-unavailable-visual" aria-hidden="true">
              <div className="feature-unavailable-orbit feature-unavailable-orbit--outer" />
              <div className="feature-unavailable-orbit feature-unavailable-orbit--inner" />
              <div className="feature-unavailable-glyph"><StatusIcon size={34} strokeWidth={1.75} /></div>
              <span className="feature-unavailable-spark feature-unavailable-spark--one" />
              <span className="feature-unavailable-spark feature-unavailable-spark--two" />
              <span className="feature-unavailable-spark feature-unavailable-spark--three" />
            </div>
            <div className="feature-unavailable-content">
              <div className="feature-unavailable-meta">
                <p className="feature-unavailable-eyebrow">{feature === 'skland' && <SklandIcon className="feature-unavailable-skland-icon" />}{copy.features.feature_labels[feature]}</p>
                {!loadError && <span className="feature-unavailable-status"><span aria-hidden="true" />{statusLabel}</span>}
              </div>
              <h1 id="feature-unavailable-title" className="feature-unavailable-title">{title}</h1>
              <p className="feature-unavailable-body">{body}</p>
              <div className="feature-unavailable-actions">
                {loadError && onRetry && <button type="button" onClick={onRetry} className="tool-primary-action"><RefreshIcon aria-hidden="true" size={16} />{copy.features.retry}</button>}
                <Link to="/" className={loadError ? 'tool-secondary-action' : 'tool-primary-action'}>{copy.features.back_home}<ArrowRight aria-hidden="true" size={16} /></Link>
                <Link to="/account-safety" className="tool-secondary-action"><SecurityIcon aria-hidden="true" size={16} />{copy.features.account_safety}</Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
