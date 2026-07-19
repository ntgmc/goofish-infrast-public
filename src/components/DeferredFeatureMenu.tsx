import { Link } from 'react-router-dom'
import { copy } from '../copy/index'

interface DeferredFeature {
  title: string
  description: string
  status: string
  href?: string
}
const deferredFeatures: DeferredFeature[] = [
  {
    title: copy.common.components_DeferredFeatureMenu_001,
    description: copy.common.components_DeferredFeatureMenu_002,
    status: copy.common.components_DeferredFeatureMenu_003,
    href: '/tools/depot-value',
  },
  {
    title: copy.common.components_DeferredFeatureMenu_004,
    description: copy.common.components_DeferredFeatureMenu_005,
    status: copy.common.components_DeferredFeatureMenu_006,
    href: '/tools/schedule-analysis',
  },
]

interface DeferredFeatureMenuProps {
  className?: string
}

export default function DeferredFeatureMenu({ className = '' }: DeferredFeatureMenuProps) {
  return (
    <details className={`group relative z-20 flex-shrink-0 ${className}`}>
      <summary className="tool-secondary-action flex min-h-11 cursor-pointer list-none gap-2 px-3 text-sm [&::-webkit-details-marker]:hidden">
        {copy.common.components_DeferredFeatureMenu_016}<svg
          className="h-4 w-4 transition-transform duration-150 group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="tool-panel absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
        <div className="tool-panel-header px-4 py-3">
          <p className="text-sm font-semibold text-ink-primary">{copy.common.components_DeferredFeatureMenu_017}</p>
          <p className="mt-1 text-xs text-ink-muted">{copy.common.components_DeferredFeatureMenu_018}</p>
        </div>
        <div className="divide-y divide-surface-3/70">
          {deferredFeatures.map((feature) => {
            const content = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-ink-primary">{feature.title}</p>
                  <span className={`tool-status ${feature.href ? 'tool-status--success' : ''}`}>
                    {feature.status}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">{feature.description}</p>
              </>
            )

            return feature.href ? (
              <Link
                key={feature.title}
                to={feature.href}
                className="block px-4 py-3 transition-colors duration-150 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45"
              >
                {content}
              </Link>
            ) : (
              <div key={feature.title} className="px-4 py-3">
                {content}
              </div>
            )
          })}
        </div>
      </div>
    </details>
  )
}
