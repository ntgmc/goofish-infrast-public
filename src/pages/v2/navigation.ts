import type { SiteFeatures } from '../../lib/site-features'
import { METERED_BILLING_AVAILABLE } from '../../lib/site-features'

const V2_SECTIONS = ['overview', 'generation', 'plans', 'lab', 'tools', 'manual-tool', 'cultivation', 'depot', 'profiles', 'add-account', 'inventory', 'commercial', 'balance', 'announcements', 'settings', 'help', 'updates', 'terms', 'privacy', 'disclaimer', 'support', 'status', 'pricing'] as const
export type V2Section = typeof V2_SECTIONS[number]

export function v2Section(params: URLSearchParams): V2Section {
  const section = params.get('section')
  return V2_SECTIONS.find((entry) => entry === section) ?? 'overview'
}

export function v2Path(section: V2Section, profileId?: string | null): string {
  const params = new URLSearchParams()
  if (section !== 'overview') params.set('section', section)
  if (profileId) params.set('profile_id', profileId)
  return `/v2${params.size ? `?${params}` : ''}`
}

export function v2SectionAvailable(section: V2Section, features: SiteFeatures): boolean {
  switch (section) {
    case 'tools': return features.site && features.tools
    case 'profiles': return features.site && features.profiles
    case 'add-account': return features.site && features.profiles && (features.free_preview || features.cdk_redemption)
    case 'generation': case 'plans': return features.site && features.profiles
    case 'lab': return features.site && features.profiles && features.scenario_comparison
    case 'manual-tool': return features.site && features.manual_schedule
    case 'cultivation': return features.site && features.cultivation_plan
    case 'depot': return features.site && features.depot_value
    case 'inventory': return features.site && features.inventory
    case 'commercial': case 'balance': return features.site && METERED_BILLING_AVAILABLE && features.metered_billing
    case 'announcements': return features.announcements
    case 'settings': return features.site
    case 'status': return features.service_status
    case 'support': return features.support
    case 'pricing': return features.pricing
    case 'help': return features.faq
    case 'updates': return features.changelog
    default: return true
  }
}

const legacySections: Record<string, V2Section> = {
  '/': 'overview', '/tool': 'profiles', '/tool/profiles': 'profiles', '/tool/tools': 'tools',
  '/tool/redeem': 'add-account', '/tool/inventory': 'inventory', '/tool/balance': 'balance',
  '/tool/commercial': 'commercial', '/tool/settings': 'settings', '/tool/announcements': 'announcements',
  '/tool/setup/operators': 'overview', '/tool/setup/config': 'overview', '/tool/setup/cdk': 'add-account',
  '/tool/optimize/overview': 'generation', '/tool/optimize/plans': 'plans', '/tool/optimize/config': 'overview',
  '/tool/optimize/result': 'overview', '/tool/optimize/lab': 'lab',
  '/tools/manual-schedule': 'manual-tool', '/tools/cultivation-plan': 'cultivation', '/tools/depot-value': 'depot',
  '/announcements': 'announcements', '/faq': 'help', '/changelog': 'updates', '/pricing': 'pricing',
  '/terms': 'terms', '/privacy': 'privacy', '/disclaimer': 'disclaimer', '/support': 'support', '/status': 'status',
}

export function v2Href(href: string, profileId?: string | null): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href
  const source = new URL(href, 'https://navigation.internal')
  const section = legacySections[source.pathname.replace(/\/+$/, '') || '/']
  if (!section) return href
  const target = new URL(v2Path(section, source.searchParams.get('profile_id') ?? profileId), source.origin)
  for (const [key, value] of source.searchParams) if (key !== 'section' && key !== 'profile_id') target.searchParams.set(key, value)
  if (source.pathname === '/tool/setup/operators') target.searchParams.set('panel', 'operators')
  if (source.pathname === '/tool/setup/config' || source.pathname === '/tool/optimize/config') target.searchParams.set('panel', 'config')
  return `${target.pathname}${target.search}${source.hash}`
}
