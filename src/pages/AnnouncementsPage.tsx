import { copy } from '../copy'
import Announcements from './v2/pages/Announcements'
import PublicPageLayout from './v2/PublicPageLayout'

export default function AnnouncementsPage() {
  return <PublicPageLayout title={copy.v2.announcements}>
    <Announcements />
  </PublicPageLayout>
}
