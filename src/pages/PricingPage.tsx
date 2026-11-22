import { usePublicContent } from '../lib/public-content-context'
import Pricing from './v2/pages/Pricing'
import PublicPageLayout from './v2/PublicPageLayout'

export default function PricingPage() {
  const { content } = usePublicContent()
  return <PublicPageLayout title={content.pricing.title} description={content.pricing.intro}>
    <Pricing />
  </PublicPageLayout>
}
