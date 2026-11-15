import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import { BackIcon } from '../../components/icons'
import { copy } from '../../copy'
import { safeAuthBack } from '../../lib/auth-navigation'
import './v2.css'
import './auth.css'

export default function AuthLayout({ title, description, backTo = '/v2', children }: {
  title: string
  description: string
  backTo?: string
  children: ReactNode
}) {
  return <div className="v2-app v2-auth-page">
    <header className="v2-auth-header"><Link to="/v2" className="v2-brand"><img src="/assets/maatool-v2-icon.svg" width="36" height="36" alt="" /><span><strong>{copy.v2.brand}</strong><small>{copy.v2.brandDescription}</small></span></Link><ThemeSwitcher iconOnly /></header>
    <main className="v2-auth-main" tabIndex={-1} data-route-focus>
      <div className="v2-auth-content"><Link to={safeAuthBack(backTo)} replace className="v2-auth-back"><BackIcon size={16} aria-hidden="true" />{copy.auth.backToTask}</Link>
        <section className="v2-auth-panel" aria-labelledby="v2-auth-title"><h1 id="v2-auth-title">{title}</h1><p className="v2-auth-description">{description}</p>{children}</section>
        <p className="v2-auth-legal">{copy.auth.authTerms}<Link to="/v2?section=terms">{copy.auth.termsLink}</Link><span> · </span><Link to="/v2?section=privacy">{copy.auth.privacyLink}</Link></p>
      </div>
    </main>
  </div>
}
