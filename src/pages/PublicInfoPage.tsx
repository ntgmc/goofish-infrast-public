import { usePublicContent } from '../lib/public-content-context'
import { pageMeta, type PublicInfoPageKind } from '../lib/legal-content'
import Documents from './v2/pages/Documents'
import PublicPageLayout from './v2/PublicPageLayout'

export default function PublicInfoPage({ page }: { page: PublicInfoPageKind }) {
  const { content } = usePublicContent()
  return <PublicPageLayout title={page === 'faq' ? content.faq.title : pageMeta[page].title}>
    <Documents page={page} />
  </PublicPageLayout>
}
