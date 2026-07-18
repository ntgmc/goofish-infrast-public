import type { LicenseConfig, LicenseFile, LicenseOperator, PermissionMode } from "./types";
import { hasCapability, normalizeRuntimePermission } from './product-catalog'



export function mergeOperators(
  licenseOperators: LicenseOperator[],
  eliteOverrides: Record<string, number>
): LicenseOperator[] {
  return licenseOperators.map((op) => {
    const override = eliteOverrides[op.id];
    if (override !== undefined && op.own) {
      return { ...op, elite: override };
    }
    return op;
  });
}
export function getPermissionMode(license: LicenseFile): PermissionMode {
  return normalizeRuntimePermission(license.permission)
}

export function canUseUpgradeFeatures(license: LicenseFile): boolean {
  return hasCapability({ permission: license.permission }, 'view_upgrade_suggestions')
}

export function canEditConfig(license: LicenseFile): boolean {
  return hasCapability({ permission: license.permission }, 'edit_full_config')
}

export function canUseScenarioComparison(license: LicenseFile): boolean {
  return hasCapability({ permission: license.permission }, 'run_scenario_comparison')
}

export function isIntermediateAutoConfig(config: LicenseConfig | null | undefined): boolean {
  return config?.auto_balance_source === "intermediate_inventory" || config?.auto_balance_source === "limited_config";
}

export function canUseIntermediateAutoConfig(
  license: LicenseFile,
  config: LicenseConfig | null | undefined
): boolean {
  return hasCapability({ permission: license.permission }, 'use_intermediate_auto_config') && isIntermediateAutoConfig(config)
}
