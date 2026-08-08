import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { copy } from '../copy/index'


const DEFAULT_DESCRIPTION = copy.metadata.components_RouteMetadata_001
const SOCIAL_IMAGE_PATH = '/assets/logo.png'

type Metadata = {
  title: string
  description: string
  indexable: boolean
}

const PUBLIC_METADATA: Record<string, Metadata> = {
  '/': {
    title: copy.metadata.components_RouteMetadata_002,
    description: DEFAULT_DESCRIPTION,
    indexable: true,
  },
  '/announcements': {
    title: copy.metadata.components_RouteMetadata_003,
    description: copy.metadata.components_RouteMetadata_004,
    indexable: true,
  },
  '/changelog': {
    title: copy.metadata.components_RouteMetadata_025,
    description: copy.metadata.components_RouteMetadata_026,
    indexable: true,
  },
  '/status': {
    title: copy.metadata.components_RouteMetadata_027,
    description: copy.metadata.components_RouteMetadata_028,
    indexable: true,
  },
  '/faq': {
    title: copy.metadata.components_RouteMetadata_005,
    description: copy.metadata.components_RouteMetadata_006,
    indexable: true,
  },
  '/support': {
    title: copy.metadata.components_RouteMetadata_007,
    description: copy.metadata.components_RouteMetadata_008,
    indexable: true,
  },
  '/pricing': {
    title: copy.metadata.components_RouteMetadata_021,
    description: copy.metadata.components_RouteMetadata_022,
    indexable: true,
  },
  '/thanks': {
    title: copy.metadata.components_RouteMetadata_023,
    description: copy.metadata.components_RouteMetadata_024,
    indexable: true,
  },
  '/privacy': {
    title: copy.metadata.components_RouteMetadata_009,
    description: copy.metadata.components_RouteMetadata_010,
    indexable: true,
  },
  '/terms': {
    title: copy.metadata.components_RouteMetadata_011,
    description: copy.metadata.components_RouteMetadata_012,
    indexable: true,
  },
  '/disclaimer': {
    title: copy.metadata.components_RouteMetadata_013,
    description: copy.metadata.components_RouteMetadata_014,
    indexable: true,
  },
  '/tools/depot-value': {
    title: copy.metadata.components_RouteMetadata_017,
    description: copy.metadata.components_RouteMetadata_018,
    indexable: true,
  },
}

const PRIVATE_METADATA: Metadata = {
  title: copy.metadata.components_RouteMetadata_019,
  description: copy.metadata.components_RouteMetadata_020,
  indexable: false,
}

export default function RouteMetadata() {
  const location = useLocation()

  useEffect(() => {
    const metadata = resolveMetadata(location.pathname)
    const canonicalUrl = canonicalUrlFor(location.pathname)
    const socialImageUrl = new URL(SOCIAL_IMAGE_PATH, canonicalUrl).href

    document.title = metadata.title
    setMetaByName('description', metadata.description)
    setMetaByName('robots', metadata.indexable ? 'index, follow' : 'noindex, nofollow')
    setMetaByProperty('og:type', 'website')
    setMetaByProperty('og:title', metadata.title)
    setMetaByProperty('og:description', metadata.description)
    setMetaByProperty('og:url', canonicalUrl)
    setMetaByProperty('og:image', socialImageUrl)
    setMetaByName('twitter:card', 'summary')
    setMetaByName('twitter:title', metadata.title)
    setMetaByName('twitter:description', metadata.description)
    setMetaByName('twitter:image', socialImageUrl)
    setCanonical(canonicalUrl)
  }, [location.pathname])

  return null
}

function resolveMetadata(pathname: string): Metadata {
  if (PUBLIC_METADATA[pathname]) return PUBLIC_METADATA[pathname]
  return PRIVATE_METADATA
}

function canonicalUrlFor(pathname: string): string {
  return new URL(pathname, window.location.origin).href
}

function setMetaByName(name: string, content: string): void {
  const meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`) ?? createMeta('name', name)
  meta.content = content
}

function setMetaByProperty(property: string, content: string): void {
  const meta = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ?? createMeta('property', property)
  meta.content = content
}

function createMeta(attribute: 'name' | 'property', value: string): HTMLMetaElement {
  const meta = document.createElement('meta')
  meta.setAttribute(attribute, value)
  document.head.append(meta)
  return meta
}

function setCanonical(url: string): void {
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link')
  canonical.rel = 'canonical'
  canonical.href = url
  if (!canonical.parentElement) document.head.append(canonical)
}
