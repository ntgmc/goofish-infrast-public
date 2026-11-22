import { copy } from '../copy'
import ServiceStatus from './v2/pages/ServiceStatus'
import PublicPageLayout from './v2/PublicPageLayout'

export default function StatusPage() {
  return <PublicPageLayout title={copy.status.pages_StatusPage_002}>
    <ServiceStatus />
  </PublicPageLayout>
}
