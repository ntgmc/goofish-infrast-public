import { Link, useLocation } from 'react-router'
import { copy } from '../copy'
import PublicPageLayout from '../pages/v2/PublicPageLayout'

export default function NotFoundPage() {
  const location = useLocation()
  return <PublicPageLayout title={copy.common.components_NotFoundPage_002} description={copy.common.components_NotFoundPage_003}>
    <section className="v2-safety-content">
      <p className="v2-muted">{copy.common.components_NotFoundPage_001}</p>
      <code className="v2-not-found-path">{location.pathname}</code>
      <nav className="v2-actions" aria-label={copy.common.components_NotFoundPage_004}>
        <Link to="/v2" replace className="v2-button v2-button-primary">{copy.common.components_NotFoundPage_005}</Link>
        <Link to="/v2?section=profiles" replace className="v2-button v2-button-secondary">{copy.common.components_NotFoundPage_006}</Link>
      </nav>
    </section>
  </PublicPageLayout>
}
