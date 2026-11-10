import { useEffect, useRef, useState } from 'react'
import { SuccessIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import './data-activity.css'

export function DataActivity({ label, description, skeleton }: {
  label: string
  description?: string
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
  return <div className="v2-data-activity" data-paused={paused || undefined}>
    <div className="v2-data-state" role="status" aria-label={label} aria-busy="true">
      <span className="v2-data-mark" aria-hidden="true" />
      <div className="v2-data-label"><strong>{label}</strong>{description && <p>{description}</p>}{slow && <p>{copy.common.dataActivity.slow}</p>}</div>
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
  return completed ? <p className="v2-data-complete" role="status"><SuccessIcon size={18} aria-hidden="true" />{copy.common.dataActivity.updated}</p> : null
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

export function DataSkeleton({ layout = 'cards' }: { layout?: 'cards' | 'list' | 'projects' }) {
  return <div className="v2-data-skeleton" data-layout={layout} aria-hidden="true">
    {Array.from({ length: layout === 'list' ? 3 : layout === 'projects' ? 2 : 4 }, (_, index) => <div className="v2-data-placeholder" key={index}>
      <i /><span /><span /><b />
    </div>)}
  </div>
}
