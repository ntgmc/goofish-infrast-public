import { useEffect, useRef, useState } from 'react'
import { CultivationIcon, PersonalDataIcon, SuccessIcon } from '../../../components/icons'
import SklandIcon from '../../../components/SklandIcon'
import { copy } from '../../../copy'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import './data-activity.css'

type DataActivityKind = 'data' | 'sync' | 'cultivation'

export function DataActivity({ label, description, kind = 'data', skeleton }: {
  label: string
  description?: string
  kind?: DataActivityKind
  skeleton?: 'cards' | 'list' | 'projects'
}) {
  const [slow, setSlow] = useState(false)
  const [paused, setPaused] = useState(() => document.hidden)
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000)
    const visibility = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  const Icon = kind === 'sync' ? SklandIcon : kind === 'cultivation' ? CultivationIcon : PersonalDataIcon
  return <div className="v2-data-activity" data-paused={paused || undefined}>
    <div className="v2-data-state" role="status" aria-label={label} aria-busy="true">
      <div className="v2-data-mark" aria-hidden="true">
        <span><Icon size={24} /></span>
        <svg viewBox="0 0 84 48" fill="none" aria-hidden="true">
          <path className="v2-data-wire" d="M32 24H44Q50 24 50 18V12Q50 8 56 8H68M44 24H68M44 24Q50 24 50 30V36Q50 40 56 40H68" />
          <path className="v2-data-flow" d="M32 24H44Q50 24 50 18V12Q50 8 56 8H68M32 24H68M32 24H44Q50 24 50 30V36Q50 40 56 40H68" />
          {[8, 24, 40].map((y) => <rect key={y} x="69" y={y - 4} width="10" height="8" rx="2" />)}
        </svg>
      </div>
      <div className="v2-data-label"><strong>{label}</strong>{description && <p>{description}</p>}{slow && <p>{copy.v2.dataActivity.slow}</p>}</div>
    </div>
    {skeleton && <DataSkeleton layout={skeleton} />}
  </div>
}

export function DataRefresh({ pending, revision, error, ...activity }: {
  pending: boolean
  revision: unknown
  error?: boolean
} & Parameters<typeof DataActivity>[0]) {
  const wasPending = useRef(pending)
  const startingRevision = useRef(revision)
  const [completed, setCompleted] = useState(false)
  useEffect(() => {
    if (pending && !wasPending.current) startingRevision.current = revision
    const finished = wasPending.current && !pending && !error && revision != null && revision !== startingRevision.current
    wasPending.current = pending
    setCompleted(finished)
    if (!finished) return
    const timer = window.setTimeout(() => setCompleted(false), 1200)
    return () => window.clearTimeout(timer)
  }, [pending, revision, error])
  if (pending) return <DataActivity {...activity} />
  return completed ? <p className="v2-data-complete" role="status"><SuccessIcon size={18} aria-hidden="true" />{copy.v2.dataActivity.updated}</p> : null
}

export function useDataUpdate(revision: unknown) {
  const target = useRef<HTMLDivElement>(null)
  const previous = useRef(revision)
  const reduced = useAppReducedMotion()
  useEffect(() => {
    const changed = previous.current !== revision
    previous.current = revision
    const element = target.current
    if (!changed || !element || reduced || document.hidden || typeof element.animate !== 'function') return
    const animation = element.animate([{ outlineColor: 'var(--color-v2-accent)' }, { outlineColor: 'transparent' }], { duration: 600, easing: 'ease-out' })
    return () => animation.cancel()
  }, [revision, reduced])
  return target
}

function DataSkeleton({ layout = 'cards' }: { layout?: 'cards' | 'list' | 'projects' }) {
  return <div className="v2-data-skeleton" data-layout={layout} aria-hidden="true">
    {Array.from({ length: layout === 'list' ? 3 : 4 }, (_, index) => <div className="v2-data-placeholder" key={index}>
      <i /><span /><span /><b />
    </div>)}
  </div>
}
