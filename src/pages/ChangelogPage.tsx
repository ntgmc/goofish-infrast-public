import { copy } from '../copy'
import Releases from './v2/pages/Releases'
import PublicPageLayout from './v2/PublicPageLayout'

export default function ChangelogPage() {
  return <PublicPageLayout title={copy.v2.updates}>
    <Releases />
  </PublicPageLayout>
}
