import { useEffect, useState } from 'react'
import { CultivationIcon, PersonalDataIcon } from '../../../components/icons'
import SklandIcon from '../../../components/SklandIcon'
import { copy } from '../../../copy'
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

function DataSkeleton({ layout = 'cards' }: { layout?: 'cards' | 'list' | 'projects' }) {
  return <div className="v2-data-skeleton" data-layout={layout} aria-hidden="true">
    {Array.from({ length: layout === 'list' ? 3 : 4 }, (_, index) => <div className="v2-data-placeholder" key={index}>
      <i /><span /><span /><b />
    </div>)}
  </div>
}
