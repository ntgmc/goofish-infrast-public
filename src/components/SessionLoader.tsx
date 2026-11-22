import { useAppReducedMotion } from '../lib/motion-preference'
import V2LoadingScreen from '../pages/v2/V2LoadingScreen'

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
  return <V2LoadingScreen label={label} />
}
