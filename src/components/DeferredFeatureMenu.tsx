import { MoreHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { copy } from '../copy/index'
import { useSiteFeatures } from '../lib/site-feature-context'
import type { SiteFeatureKey } from '../lib/site-features'

interface DeferredFeature {
  title: string
  description: string
  status: string
  href?: string
  feature: SiteFeatureKey
}
const deferredFeatures: DeferredFeature[] = [
  {
    title: copy.common.components_DeferredFeatureMenu_001,
    description: copy.common.components_DeferredFeatureMenu_002,
    status: copy.common.components_DeferredFeatureMenu_003,
    href: '/tools/depot-value',
    feature: 'depot_value',
  },
]

interface DeferredFeatureMenuProps {
  className?: string
  iconOnly?: boolean
}

export default function DeferredFeatureMenu({ className = '', iconOnly = false }: DeferredFeatureMenuProps) {
  const { features } = useSiteFeatures()
  const visibleFeatures = deferredFeatures.filter((feature) => features[feature.feature])
  if (visibleFeatures.length === 0) return null
  return (
    <details className={`group relative z-20 flex-shrink-0 ${className}`}>
      <summary
        aria-label={iconOnly ? copy.common.components_CompactHeaderMenu_002 : undefined}
        className={`tool-secondary-action flex h-11 cursor-pointer list-none gap-2 py-0 text-sm [&::-webkit-details-marker]:hidden ${iconOnly ? 'w-11 justify-center px-0' : 'px-3'}`}
      >
        {iconOnly ? <MoreHorizontal aria-hidden="true" className="size-5" /> : <>{copy.common.components_DeferredFeatureMenu_016}<svg
            className="h-4 w-4 transition-transform duration-150 group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 9l6 6 6-6" />
          </svg></>}
      </summary>
      <div className="deferred-menu-panel tool-panel absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden">
        <div className="tool-panel-header px-4 py-3">
          <p className="text-sm font-semibold text-ink-primary">{copy.common.components_DeferredFeatureMenu_017}</p>
          <p className="mt-1 text-xs text-ink-muted">{copy.common.components_DeferredFeatureMenu_018}</p>
        </div>
        <div className="divide-y divide-surface-3/70">
          {visibleFeatures.map((feature) => {
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
