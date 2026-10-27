import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { copy } from '../../copy'
import { routesCopy } from '../../copy/zh-CN/routes'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { sectionLabels, v2Path, v2SectionAvailable } from './navigation'
import { LoadingSpinner } from '../../components/SessionLoader'
import './V2LoadingScreen.css'

export function V2SectionLoading({ label = copy.common.pages_tool_AccountDashboard_015 }: { label?: string }) {
  return <div className="v2-section-loading-region" role="status" aria-label={label} aria-busy="true">
    <LoadingSpinner /><p>{label}</p>
  </div>
}

export default function V2LoadingScreen({ error, onRetry, retryLabel = routesCopy.v2.retry, children }: {
  error?: string | null
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}) {
  const { features } = useSiteFeatures()
  return (
    <main className="v2-app v2-loading-screen" tabIndex={-1} data-route-focus>
      <img className="v2-loading-brand" src="/assets/maatool-v2-icon.svg" width="64" height="64" alt={routesCopy.v2.brand} />
      <div className="v2-loading-status" role={error ? 'alert' : 'status'} aria-live="polite" aria-busy={!error}>
        {!error && <LoadingSpinner />}
        <p>{error ?? routesCopy.v2.loading}</p>
      </div>
      {error && onRetry && <button type="button" className="v2-loading-retry" onClick={onRetry}>{retryLabel}</button>}
      {error && <nav className="v2-loading-links" aria-label={routesCopy.labels.help}>
        {(['help', 'support', 'status'] as const).filter((section) => v2SectionAvailable(section, features)).map((section) => <Link key={section} className="v2-loading-retry" to={v2Path(section)}>{sectionLabels[section]}</Link>)}
      </nav>}
      {children}
    </main>
  )
}
