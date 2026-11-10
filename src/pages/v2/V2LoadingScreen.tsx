import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { copy } from '../../copy'
import { routesCopy } from '../../copy/zh-CN/routes'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { sectionLabels, v2Path, v2SectionAvailable } from './navigation'
import { DataActivity } from './components/DataActivity'
import './V2LoadingScreen.css'

export function V2SectionLoading({ label = copy.common.pages_tool_AccountDashboard_015 }: { label?: string }) {
  return <div className="v2-section-loading-region"><DataActivity label={label} /></div>
}

export default function V2LoadingScreen({ error, onRetry, retryLabel = routesCopy.v2.retry, children }: {
  error?: string | null
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}) {
  const { features } = useSiteFeatures()
  const screen = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    // Startup gates share one timeline so remounts do not restart the light.
    for (const animation of screen.current?.getAnimations?.({ subtree: true }) ?? []) {
      if (animation instanceof CSSAnimation && animation.animationName === 'v2-loading-glide') animation.startTime = 0
    }
  }, [error])
  return (
    <main ref={screen} className="v2-app v2-loading-screen" tabIndex={-1} data-route-focus>
      <img className="v2-loading-brand" src="/assets/maatool-v2-icon.svg" width="64" height="64" alt={routesCopy.v2.brand} />
      {error ? <div className="v2-loading-status" role="alert"><p>{error}</p></div>
        : <DataActivity label={routesCopy.v2.loading} />}
      {error && onRetry && <button type="button" className="v2-loading-retry" onClick={onRetry}>{retryLabel}</button>}
      {error && <nav className="v2-loading-links" aria-label={routesCopy.labels.help}>
        {(['help', 'support', 'status'] as const).filter((section) => v2SectionAvailable(section, features)).map((section) => <Link key={section} className="v2-loading-retry" to={v2Path(section)}>{sectionLabels[section]}</Link>)}
      </nav>}
      {children}
    </main>
  )
}
