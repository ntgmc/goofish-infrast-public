import { Link } from 'react-router'
import { isPausableSiteFeature, type SiteFeatureKey } from '../lib/site-features'
import { useSiteFeatures } from '../lib/site-feature-context'
import SessionLoader from './SessionLoader'
import ThemeSwitcher from './ThemeSwitcher'
import SklandIcon from './SklandIcon'
import { InfoIcon, NextIcon as ArrowRight, PauseIcon, RefreshIcon, SecurityIcon } from './icons'
import { copy } from '../copy/index'
import { routesCopy } from '../copy/zh-CN/routes'
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
  const StatusIcon = loadError ? InfoIcon : PauseIcon
  return (
    <main className="v2-app feature-unavailable-page" tabIndex={-1} data-route-focus>
      <div className="feature-unavailable-frame">
        <header className="feature-unavailable-header">
          <Link to="/" className="feature-unavailable-brand">
            <img src="/assets/maatool-v2-icon.svg" width="36" height="36" alt="" />
            <span><strong>{routesCopy.v2.brand}</strong><small>{routesCopy.v2.brandDescription}</small></span>
          </Link>
          <ThemeSwitcher iconOnly />
        </header>
        <div className="feature-unavailable-main">
          <section className={`feature-unavailable-panel${loadError ? ' is-error' : ''}`} aria-labelledby="feature-unavailable-title">
            <div className="feature-unavailable-content">
              <div className="feature-unavailable-meta">
                <span className="feature-unavailable-icon" aria-hidden="true"><StatusIcon size={22} strokeWidth={1.75} /></span>
                <p className="feature-unavailable-eyebrow">{feature === 'skland' && <SklandIcon />}<span>{copy.features.feature_labels[feature]}</span></p>
              </div>
              <h1 id="feature-unavailable-title" className="feature-unavailable-title">{title}</h1>
              <p className="feature-unavailable-body">{body}</p>
              <div className="feature-unavailable-actions">
                {loadError && onRetry && <button type="button" onClick={onRetry} className="tool-primary-action"><RefreshIcon aria-hidden="true" size={16} /><span>{copy.features.retry}</span></button>}
                <Link to="/" className={loadError ? 'tool-secondary-action' : 'tool-primary-action'}><span>{copy.features.back_home}</span><ArrowRight aria-hidden="true" size={16} /></Link>
                <Link to="/account-safety" className="tool-secondary-action"><SecurityIcon aria-hidden="true" size={16} /><span>{copy.features.account_safety}</span></Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
