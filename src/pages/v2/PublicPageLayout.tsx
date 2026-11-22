import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { copy } from '../../copy'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import PublicFooter from '../../components/PublicFooter'
import { DialogSurfaceProvider } from '../../components/ui/dialog'
import { InternalLinkProvider } from '../../components/InternalLink'
import { v2Href } from './navigation'
import './v2.css'
import './workspace-pages.css'
import './public-pages.css'

export default function PublicPageLayout({ title, description, children }: {
  title: string
  description?: string
  children: ReactNode
}) {
  return <InternalLinkProvider value={v2Href}><DialogSurfaceProvider value="v2-dialog v2-feature-content">
    <div className="v2-app v2-public-page">
      <header className="v2-public-header">
        <Link to="/v2" className="v2-brand"><img src="/assets/maatool-v2-icon.svg" width="36" height="36" alt="" /><span><strong>{copy.v2.brand}</strong><small>{copy.v2.brandDescription}</small></span></Link>
        <ThemeSwitcher iconOnly />
      </header>
      <main className="v2-public-main v2-feature-content" tabIndex={-1} data-route-focus>
        <header className="v2-section-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div></header>
        {children}
      </main>
      <PublicFooter />
    </div>
  </DialogSurfaceProvider></InternalLinkProvider>
}
