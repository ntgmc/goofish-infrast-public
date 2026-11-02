import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useSearchParams } from 'react-router'
import { copy } from '../copy'
import { profileScopedPath } from '../lib/app-routes'
import { useSiteFeatures } from '../lib/site-feature-context'
import BrandLogo from './BrandLogo'
import FeatureUnavailablePage from './FeatureUnavailablePage'
import SessionLoader from './SessionLoader'
import ThemeSwitcher from './ThemeSwitcher'
import './V1Route.css'

const text = copy.features.v1_migration
const shutdownAt = Date.parse('2026-11-15T00:00:00+08:00')

export default function V1Route() {
  const { status, features, retry } = useSiteFeatures()
  const [params] = useSearchParams()
  if (status === 'loading') return <SessionLoader label={copy.features.loading} />
  if (status === 'error') return <FeatureUnavailablePage loadError onRetry={retry} />
  if (!features.v1) return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-4"><BrandLogo size="md" /><ThemeSwitcher /></div>
        <section className="tool-panel mt-8 p-6 sm:p-8">
          <p className="tool-eyebrow">{copy.features.feature_labels.v1}</p>
          <h1 className="display-title mt-3 text-2xl text-ink-primary">{text.closed_title}</h1>
          <p className="mt-4 text-sm leading-6 text-ink-secondary">{text.closed_body}</p>
          <Link to={profileScopedPath('/v2', params.get('profile_id'))} className="tool-primary-action mt-6 inline-flex">{text.enter_v2}</Link>
        </section>
      </div>
    </main>
  )
  return <div className="v1-layout"><V1MigrationNotice /><Outlet /></div>
}

function V1MigrationNotice() {
  const [now, setNow] = useState(Date.now)
  const banner = useRef<HTMLElement>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    const observer = new ResizeObserver(() => {
      const element = banner.current
      element?.parentElement?.style.setProperty('--v1-notice-height', `${element.getBoundingClientRect().height}px`)
    })
    if (banner.current) observer.observe(banner.current)
    return () => { window.clearInterval(timer); observer.disconnect() }
  }, [])
  const minutes = Math.max(0, Math.ceil((shutdownAt - now) / 60_000))
  const remaining = text.remaining(Math.floor(minutes / 1440), Math.floor(minutes % 1440 / 60), minutes % 60)
  return (
    <aside ref={banner} className="v1-migration-notice" aria-label={text.label}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-8">
        <div className="min-w-0 text-sm leading-6"><p className="font-semibold">{text.deadline}</p><p>{text.guidance}</p></div>
        <p className="text-sm font-semibold tabular-nums">{minutes > 0 ? remaining : text.deadline_reached}</p>
      </div>
    </aside>
  )
}
