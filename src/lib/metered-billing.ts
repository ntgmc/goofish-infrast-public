import { productPolicies } from './product-catalog'
import type { UserGameAccountKind } from './types'

export type MeteredBillingKind = Extract<UserGameAccountKind, 'metered_personal' | 'metered_commercial'>
export type CommercialTierLevel = 1 | 2 | 3 | 4
export type MeteredBillingOperation = 'main_schedule' | 'incremental_recompute' | 'scenario_comparison'

export interface CommercialTierSummary {
  eligible: boolean
  level: CommercialTierLevel | null
  threshold_points: string
  discount_bps: number
  charge_points: string
  next_threshold_points: string | null
  points_to_next_level: string | null
}

export interface MeteredScheduleQuote {
  operation: MeteredBillingOperation
  pricing_version: string
  billing_kind: MeteredBillingKind
  list_price: string
  tier: CommercialTierLevel | null
  discount_bps: number
  charge: string
}

export interface IssuedMeteredScheduleQuote extends MeteredScheduleQuote {
  quote_id: string
  expires_at: string
  available: string
  sufficient: boolean
}

export interface MeteredQuoteConfirmation {
  quoteId: string
  pricingVersion: string
  acceptedMaxPoints: string
}

const policy = productPolicies.metered_billing

export function getCommercialTierSummary(
  lifetimeCredited: string,
  debt = '0.00',
): CommercialTierSummary {
  const creditedMinor = pointsToMinor(lifetimeCredited)
  const debtMinor = pointsToMinor(debt)
  const tiers = policy.commercial.tiers
  const matched = [...tiers].reverse().find((tier) => creditedMinor >= pointsToMinor(tier.threshold_points)) ?? null
  const next = tiers.find((tier) => creditedMinor < pointsToMinor(tier.threshold_points)) ?? null
  const listPriceMinor = pointsToMinor(policy.commercial.list_price_points)
  const discountBps = matched?.discount_bps ?? 0
  return {
    eligible: matched !== null && debtMinor === 0n,
    level: matched ? matched.level as CommercialTierLevel : null,
    threshold_points: tiers[0]!.threshold_points,
    discount_bps: discountBps,
    charge_points: matched?.charge_points ?? minorToPoints(listPriceMinor),
    next_threshold_points: next?.threshold_points ?? null,
    points_to_next_level: next
      ? minorToPoints(pointsToMinor(next.threshold_points) - creditedMinor)
      : null,
  }
}

export function getMeteredScheduleQuote(
  billingKind: MeteredBillingKind,
  lifetimeCredited = '0.00',
  debt = '0.00',
  operation: MeteredBillingOperation = 'main_schedule',
): MeteredScheduleQuote {
  if (operation === 'incremental_recompute' || operation === 'scenario_comparison') {
    const charge = operation === 'incremental_recompute'
      ? policy.personal.incremental_recompute_points
      : policy.personal.scenario_comparison_points
    return {
      operation,
      pricing_version: policy.pricing_version,
      billing_kind: 'metered_personal',
      list_price: charge,
      tier: null,
      discount_bps: 0,
      charge,
    }
  }
  if (billingKind === 'metered_personal') {
    return {
      operation,
      pricing_version: policy.pricing_version,
      billing_kind: billingKind,
      list_price: policy.personal.main_schedule_points,
      tier: null,
      discount_bps: 0,
      charge: policy.personal.main_schedule_points,
    }
  }
  const tier = getCommercialTierSummary(lifetimeCredited, debt)
  return {
    operation,
    pricing_version: policy.pricing_version,
    billing_kind: billingKind,
    list_price: policy.commercial.list_price_points,
    tier: tier.level,
    discount_bps: tier.discount_bps,
    charge: tier.charge_points,
  }
}

export function getMeteredBillingPolicy() {
  return policy
}

export function pointsToMinor(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new Error(`Invalid points amount: ${value}`)
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}

function minorToPoints(value: bigint): string {
  if (value < 0n) throw new Error('Points amount cannot be negative.')
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}
