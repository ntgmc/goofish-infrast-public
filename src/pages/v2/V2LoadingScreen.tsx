import type { ReactNode } from 'react'
import { copy } from '../../copy'
import { useAppReducedMotion } from '../../lib/motion-preference'
import './V2LoadingScreen.css'

function V2LoadingSpinner() {
  const reduceMotion = useAppReducedMotion()
  return <svg className="v2-loading-spinner" viewBox="25 25 50 50" aria-hidden="true" data-reduced-motion={reduceMotion || undefined}>
    <circle r="20" cy="50" cx="50" />
  </svg>
}

export function V2SectionLoading({ label = copy.common.pages_tool_AccountDashboard_015 }: { label?: string }) {
  return <div className="v2-section-loading-region" role="status" aria-label={label} aria-busy="true">
    <V2LoadingSpinner /><p>{label}</p>
  </div>
}

export default function V2LoadingScreen({ error, onRetry, retryLabel = copy.v2.retry, children }: {
  error?: string | null
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}) {
  return (
    <main className="v2-app v2-loading-screen" tabIndex={-1} data-route-focus>
      <div className="v2-loading-status" role={error ? 'alert' : 'status'} aria-live="polite" aria-busy={!error}>
        {!error && <V2LoadingSpinner />}
        <p>{error ?? copy.v2.loading}</p>
      </div>
      {error && onRetry && <button type="button" className="v2-loading-retry" onClick={onRetry}>{retryLabel}</button>}
      {children}
    </main>
  )
}
