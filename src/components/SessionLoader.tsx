import { useAppReducedMotion } from '../lib/motion-preference'

export function LoadingSpinner() {
  const reduceMotion = useAppReducedMotion()
  return <svg className="page-loading-spinner" viewBox="25 25 50 50" aria-hidden="true" data-reduced-motion={reduceMotion || undefined}>
    <circle r="20" cy="50" cx="50" />
  </svg>
}

export function SectionLoader({ label }: { label: string }) {
  return <div className="tool-section-loader" role="status" aria-label={label} aria-busy="true">
    <LoadingSpinner /><p>{label}</p>
  </div>
}

type SessionLoaderProps = {
  label: string
}

export default function SessionLoader({ label }: SessionLoaderProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-6" tabIndex={-1} data-route-focus>
      <div className="motion-loader-enter flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
        <div className="session-loader" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
        <p className="text-sm font-medium text-ink-secondary">{label}</p>
      </div>
    </main>
  )
}
