const SYSTEM_ITEM_CODES = [
  'priority_compute_coupon',
  'reorder_check_coupon',
  'scenario_simulation_coupon',
  'training_diagnosis_coupon',
  'additional_recompute_coupon',
  'plan_capacity_certificate',
  'history_capacity_certificate',
  'result_archive_folder',
  'maa_export_trial_coupon',
  'newcomer_supply_pack',
  'lifetime_profile_voucher',
  'limited_profile_voucher',
] as const

export type SystemItemCode = typeof SYSTEM_ITEM_CODES[number]
type ItemKind = 'consumable' | 'capacity_upgrade' | 'gift_pack' | 'cosmetic' | 'badge' | 'license_voucher'
type ItemEffectCode =
  | 'priority_compute'
  | 'reorder_check'
  | 'scenario_simulation'
  | 'training_diagnosis'
  | 'additional_recompute'
  | 'plan_capacity'
  | 'history_capacity'
  | 'result_archive_capacity'
  | 'maa_export_trial'
  | 'open_gift_pack'
  | 'bind_lifetime_profile'
  | 'activate_limited_profile'

export type ExpiryPolicy =
  | { mode: 'never' }
  | { mode: 'relative_days'; days: number }

export interface ItemDefinition {
  code: string
  kind: ItemKind
  effect_code: ItemEffectCode | null
  name: string
  description: string
  icon_key: string
  system_owned: boolean
  issuance_enabled: boolean
  created_at: string | null
  updated_at: string | null
}

interface InventoryExpiryBucket {
  quantity: number
  expires_at: string | null
}

export interface InventoryStack {
  stack_id: string
  item: ItemDefinition
  gift_pack_version_id: string | null
  quantity: number
  permanent: number
  next_expiry_at: string | null
  expiry_buckets: InventoryExpiryBucket[]
  actions: Array<'use' | 'open' | 'bind' | 'context_only'>
}

export interface ProfileCapacitySummary {
  profile_id: string
  display_name: string
  plan_slots: { used: number; limit: number; maximum: number }
  history_slots: { used: number; limit: number; maximum: number }
  archive_slots: { used: number; limit: number; maximum: number }
}

export interface ProfileReorderQuotaSummary {
  profile_id: string
  limit: number
  used: number
  remaining: number
  reset_at: string
  timezone: 'Asia/Shanghai'
}

export interface InventoryResponse {
  stacks: InventoryStack[]
  capacities: ProfileCapacitySummary[]
  reorder_quotas: ProfileReorderQuotaSummary[]
  recent_events: InventoryLedgerEvent[]
}

export interface InventoryLedgerEvent {
  id: string
  item_code: string
  event_type: 'grant' | 'reserve' | 'consume' | 'refund' | 'revoke' | 'gift_open' | 'entitlement'
  quantity: number
  reference_type: string
  reference_id: string
  created_at: string
  metadata: Record<string, unknown>
}

export interface ItemUseRequest {
  item_code: string
  quantity: 1
  profile_id?: string
  gift_pack_version_id?: string
  idempotency_key: string
}

export interface GiftPackContentInput {
  item_code: string
  quantity: number
  expiry: ExpiryPolicy
  gift_pack_version_id?: string
}

export interface GiftPackVersion {
  id: string
  item_code: string
  version: number
  status: 'draft' | 'published' | 'retired'
  contents: GiftPackContentInput[]
  created_at: string
  published_at: string | null
}

export type OnboardingTaskCode = 'welcome_inventory' | 'bind_skland' | 'first_main_schedule'

export interface OnboardingTaskView {
  code: OnboardingTaskCode
  title: string
  description: string
  enabled: boolean
  status: 'disabled' | 'incomplete' | 'claimable' | 'claimed'
  completed_at: string | null
  claimed_at: string | null
  rewards: GiftPackContentInput[]
}

export const ITEM_ICON_PATHS: Record<string, string> = {
  placeholder: '/assets/items/item-placeholder.svg',
  priority_compute_coupon: '/assets/items/priority-compute-coupon.png',
  reorder_check_coupon: '/assets/items/reorder-check-coupon.png',
  scenario_simulation_coupon: '/assets/items/scenario-simulation-coupon.png',
  training_diagnosis_coupon: '/assets/items/training-diagnosis-coupon.png',
  additional_recompute_coupon: '/assets/items/additional-recompute-coupon.png',
  plan_capacity_certificate: '/assets/items/plan-capacity-certificate.png',
  history_capacity_certificate: '/assets/items/history-capacity-certificate.png',
  result_archive_folder: '/assets/items/result-archive-folder.png',
  maa_export_trial_coupon: '/assets/items/maa-export-trial-coupon.png',
  newcomer_supply_pack: '/assets/items/newcomer-supply-pack.png',
  generic_gift_pack: '/assets/items/generic-gift-pack.png',
  lifetime_profile_voucher: '/assets/items/lifetime-profile-voucher.png',
  limited_profile_voucher: '/assets/items/limited-profile-voucher.png',
}

export function itemIconPath(iconKey: string): string {
  return ITEM_ICON_PATHS[iconKey] ?? ITEM_ICON_PATHS.placeholder
}

export function normalizeExpiryPolicy(value: unknown): ExpiryPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const expiry = value as Record<string, unknown>
  if (expiry.mode === 'never') return { mode: 'never' }
  if (expiry.mode !== 'relative_days' || !Number.isInteger(expiry.days)) return null
  const days = Number(expiry.days)
  return days >= 1 && days <= 3650 ? { mode: 'relative_days', days } : null
}
