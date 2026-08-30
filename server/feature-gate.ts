import type { SiteFeatureKey } from '../src/lib/site-features'
import { computeEffectiveSiteFeatures } from '../src/lib/site-features'
import { getSiteFeatureSettings } from './storage/feature-settings-store'

export async function enforceFeatureGate(req: Request): Promise<Response | null> {
  if (req.method === 'OPTIONS') return null
  const url = new URL(req.url)
  return requireSiteFeatures(requiredFeatures(url.pathname, req.method))
}

export async function requireSiteFeatures(features: readonly SiteFeatureKey[]): Promise<Response | null> {
  if (features.length === 0) return null
  try {
    const effective = computeEffectiveSiteFeatures(await getSiteFeatureSettings())
    const disabled = features.find((feature) => !effective[feature])
    return disabled ? featureDisabledResponse(disabled) : null
  } catch (error) {
    console.error('feature gate settings error:', error)
    return jsonResponse({ error: '功能状态暂时无法获取。', code: 'feature_settings_unavailable' }, 503, {
      'Cache-Control': 'no-store',
    })
  }
}

export function requireMeteredBillingFeature(profileKind: string): Promise<Response | null> {
  return profileKind === 'metered_personal' || profileKind === 'metered_commercial'
    ? requireSiteFeatures(['metered_billing'])
    : Promise.resolve(null)
}

function requiredFeatures(pathname: string, method: string): SiteFeatureKey[] {
  if (pathname === '/api/auth/register') return ['registration']
  if (pathname === '/api/auth/login' || pathname === '/api/auth/me') return ['login']
  if (pathname === '/api/announcement') return ['announcements']
  if (pathname === '/api/depot-value') return ['depot_value']
  if (pathname === '/api/usage-stats') return ['login']

  if (pathname === '/api/user/data/credential/clear') return ['profiles']
  if (pathname === '/api/user/announcements') return ['login', 'announcements']
  if (pathname === '/api/user/notifications') return ['login']
  if (pathname === '/api/user/profiles/preview') return ['free_preview']
  if (pathname === '/api/user/profiles/redeem') return ['cdk_redemption']
  if (pathname === '/api/user/cdk/redeem') return ['cdk_redemption']
  if (pathname === '/api/user/balance/redeem') return ['cdk_redemption']
  if (pathname === '/api/user/profiles/depot-value') return ['profiles', 'depot_value']
  if (pathname === '/api/user/profiles/metered-personal' || pathname === '/api/user/commercial/profiles'
    || pathname === '/api/user/billing/quote') return ['profiles', 'schedule_generation', 'metered_billing']
  if (pathname === '/api/user/profiles' || pathname === '/api/user/status') return ['profiles']
  if (pathname === '/api/user/workspace') return ['profiles']
  if (pathname === '/api/user/results' || pathname.startsWith('/api/user/results/')) return ['profiles']
  if (pathname === '/api/user/inventory' || pathname === '/api/user/maa-export' || pathname === '/api/user/result-archive') {
    return ['inventory']
  }
  if (pathname === '/api/user/onboarding-tasks' || pathname === '/api/user/onboarding-tasks/claim'
    || /^\/api\/user\/onboarding-tasks\/[^/]+\/claim$/.test(pathname)) {
    return ['inventory', 'onboarding_tasks']
  }
  if (pathname === '/api/user/invitations' || pathname === '/api/user/invitations/code' || pathname === '/api/user/priority-coupon-balance') {
    return ['invitations']
  }
  if (pathname.startsWith('/api/user/skland/free-preview/')) return ['free_preview', 'skland']
  if (pathname.startsWith('/api/user/skland/lifetime-voucher/')) return ['inventory', 'skland']
  if (pathname.startsWith('/api/user/skland/')) return ['skland']

  if (pathname === '/api/optimization/reorder-checks') return method === 'POST' ? ['schedule_generation'] : ['profiles']
  if (pathname === '/api/optimization/jobs') return method === 'POST' ? ['schedule_generation'] : ['profiles']
  if (pathname.startsWith('/api/optimization/jobs/')) return ['profiles']
  return []
}

function featureDisabledResponse(feature: SiteFeatureKey): Response {
  return jsonResponse({ error: '该功能当前未开放。', code: 'feature_disabled', feature }, 503, {
    'Cache-Control': 'no-store',
  })
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}
