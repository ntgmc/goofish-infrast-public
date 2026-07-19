import catalogJson from '../../product/catalog.json'
import type { RawPermissionMode, UserGameAccountKind } from './types'

export type CapabilityId = keyof typeof catalogJson.capabilities
export const capabilityIds = Object.keys(catalogJson.capabilities) as CapabilityId[]
export type RuntimePermission = keyof typeof catalogJson.runtime_permissions
export type ProductPermission = Exclude<RuntimePermission, 'admin'>
export type SkuId = keyof typeof catalogJson.skus
export type ProductPolicy = typeof catalogJson.policies

export interface CapabilitySubject {
  kind?: UserGameAccountKind
  permission?: RawPermissionMode | null
}

export const productCatalog = catalogJson
export const productPolicies: ProductPolicy = catalogJson.policies

export function normalizeRuntimePermission(permission: RawPermissionMode | null | undefined): RuntimePermission {
  if (permission === 'basic' || permission === 'premium') return catalogJson.legacy_aliases[permission] as RuntimePermission
  if (permission && permission in catalogJson.runtime_permissions) return permission as RuntimePermission
  return 'growth'
}

export function getSku(id: SkuId) {
  return catalogJson.skus[id]
}

export function getPermissionProfile(permission: RawPermissionMode | null | undefined) {
  return catalogJson.runtime_permissions[normalizeRuntimePermission(permission)]
}

export function listPublicSkus() {
  return (Object.entries(catalogJson.skus) as Array<[SkuId, (typeof catalogJson.skus)[SkuId]]>)
    .filter(([, sku]) => sku.public)
    .map(([id, sku]) => ({ id, ...sku }))
}

export function listAdminIssuablePermissions(): ProductPermission[] {
  return (Object.entries(catalogJson.runtime_permissions) as Array<[RuntimePermission, (typeof catalogJson.runtime_permissions)[RuntimePermission]]>)
    .filter(([permission, profile]) => permission !== 'admin' && profile.admin_issuable)
    .sort((left, right) => left[1].admin_rank - right[1].admin_rank)
    .map(([permission]) => permission as ProductPermission)
}

export function getPermissionRank(permission: RawPermissionMode | null | undefined): number {
  return getPermissionProfile(permission).admin_rank
}

export function hasCapability(subject: CapabilitySubject, capability: CapabilityId): boolean {
  const permission = normalizeRuntimePermission(subject.permission)
  const profile = catalogJson.runtime_permissions[permission]
  if ((profile.capabilities as string[]).includes(capability)) return true
  if (subject.kind === 'free_preview') {
    return capability === 'generate_full_schedule'
      || capability === 'edit_limited_config'
      || capability === 'use_intermediate_auto_config'
  }
  return false
}
