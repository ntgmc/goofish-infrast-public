import { Link, useLocation } from 'react-router'
import { copy } from '../copy'
import PublicPageLayout from '../pages/v2/PublicPageLayout'

export default function NotFoundPage() {
  const location = useLocation()
  return <PublicPageLayout className="v2-not-found-page" title={<><span className="v2-not-found-code" aria-hidden="true">404</span>{copy.common.components_NotFoundPage_002}</>} description={copy.common.components_NotFoundPage_003}>
    <section className="v2-not-found-content" aria-label={copy.common.components_NotFoundPage_001}>
      <code className="v2-not-found-path">{location.pathname}</code>
      <nav className="v2-actions" aria-label={copy.common.components_NotFoundPage_004}>
        <Link to="/v2" replace className="v2-button v2-button-primary">{copy.common.components_NotFoundPage_005}</Link>
        <Link to="/v2?section=profiles" replace className="v2-button v2-button-secondary">{copy.common.components_NotFoundPage_006}</Link>
      </nav>
    </section>
  </PublicPageLayout>
}
