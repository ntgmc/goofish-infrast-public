import type { LicenseConfig, LicenseFile, LicenseOperator, PermissionMode, RawPermissionMode, WorkFile } from "./types";
import { decryptPayload } from "./crypto";
import { copy } from '../copy/index'
import { hasCapability, normalizeRuntimePermission } from './product-catalog'


const LICENSE_PREFIX = "MAA-V1:";
const WORKFILE_PREFIX = "MAA-W1:";
const VALID_PERMISSION_MODES: RawPermissionMode[] = [
  "recommended",
  "growth",
  "advanced",
  "ultimate",
  "basic",
  "premium",
  "admin",
];

export type ParsedFile =
  | { kind: "license"; data: LicenseFile }
  | { kind: "workfile"; data: WorkFile };

export type ValidateError = {
  code: string;
  message: string;
};

export async function parseFileContent(
  content: string
): Promise<{ ok: true; data: ParsedFile } | { ok: false; error: ValidateError }> {
  const trimmed = content.trim();

  if (trimmed.startsWith(LICENSE_PREFIX)) {
    try {
      const base64 = trimmed.slice(LICENSE_PREFIX.length);
      const json = await decryptPayload(base64);
      const data = JSON.parse(json) as LicenseFile;
      const check = validateLicenseStructure(data);
      if (check.ok === false) return { ok: false, error: check.error };
      return { ok: true, data: { kind: "license", data } };
    } catch {
      return { ok: false, error: { code: "DECRYPT_FAILED", message: copy.domain.lib_license_001 } };
    }
  }

  if (trimmed.startsWith(WORKFILE_PREFIX)) {
    try {
      const base64 = trimmed.slice(WORKFILE_PREFIX.length);
      const json = await decryptPayload(base64);
      const data = JSON.parse(json) as WorkFile;
      const check = validateWorkFileStructure(data);
      if (check.ok === false) return { ok: false, error: check.error };
      return { ok: true, data: { kind: "workfile", data } };
    } catch {
      return { ok: false, error: { code: "DECRYPT_FAILED", message: copy.domain.lib_license_002 } };
    }
  }

  return {
    ok: false,
    error: {
      code: "INVALID_PREFIX",
      message: copy.domain.lib_license_003,
    },
  };
}

function validateLicenseStructure(
  license: LicenseFile
): { ok: true } | { ok: false; error: ValidateError } {
  if (!license.order_hash || !license.operators || !license.config || !license.sig) {
    return { ok: false, error: { code: "MISSING_FIELDS", message: copy.domain.lib_license_004 } };
  }
  if (license.version !== 1) {
    return { ok: false, error: { code: "VERSION_MISMATCH", message: copy.domain.lib_license_005 } };
  }
  if (!Array.isArray(license.operators) || license.operators.length === 0) {
    return { ok: false, error: { code: "INVALID_DATA", message: copy.domain.lib_license_006 } };
  }
  if (license.permission && !isRawPermissionMode(license.permission)) {
    return { ok: false, error: { code: "INVALID_PERMISSION", message: copy.domain.lib_license_007 } };
  }
  const configCheck = validateConfigStructure(license.config);
  if (!configCheck.ok) return configCheck;
  return { ok: true };
}

function validateConfigStructure(
  config: LicenseConfig
): { ok: true } | { ok: false; error: ValidateError } {
  if (!config.layout || !config.product_requirements) {
    return { ok: false, error: { code: "INVALID_CONFIG", message: copy.domain.lib_license_008 } };
  }
  if (
    typeof config.trading_stations_count !== "number" ||
    typeof config.manufacturing_stations_count !== "number"
  ) {
    return { ok: false, error: { code: "INVALID_CONFIG", message: copy.domain.lib_license_009 } };
  }
  return { ok: true };
}

function validateWorkFileStructure(
  workfile: WorkFile
): { ok: true } | { ok: false; error: ValidateError } {
  if (!workfile.license || !workfile.client_state) {
    return { ok: false, error: { code: "MISSING_FIELDS", message: copy.domain.lib_license_010 } };
  }

  const licenseCheck = validateLicenseStructure(workfile.license);
  if (!licenseCheck.ok) return licenseCheck;

  if (!workfile.client_state.operator_elite_overrides || !workfile.client_state.client_sig) {
    return { ok: false, error: { code: "MISSING_FIELDS", message: copy.domain.lib_license_011 } };
  }

  if (workfile.client_state.config_override) {
    if (!canEditConfig(workfile.license) && !canUseLimitedConfigOverride(workfile.license, workfile.client_state.config_override)) {
      return { ok: false, error: { code: "PERMISSION_DENIED", message: copy.domain.lib_license_012 } };
    }
    const configCheck = validateConfigStructure(workfile.client_state.config_override);
    if (!configCheck.ok) return configCheck;
  }

  const overrides = workfile.client_state.operator_elite_overrides;
  const licenseIds = new Set(workfile.license.operators.map((op) => op.id));

  for (const id of Object.keys(overrides)) {
    if (!licenseIds.has(id)) {
      return { ok: false, error: { code: "UNKNOWN_OPERATOR", message: `${copy.domain.lib_license_013}${id}` } };
    }
  }

  return { ok: true };
}

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

export function extractLicense(parsed: ParsedFile): LicenseFile {
  if (parsed.kind === "license") return parsed.data;
  return parsed.data.license;
}

export function extractEliteOverrides(parsed: ParsedFile): Record<string, number> {
  if (parsed.kind === "workfile") return parsed.data.client_state.operator_elite_overrides;
  return {};
}

export function extractConfigOverride(parsed: ParsedFile): LicenseConfig | null {
  if (parsed.kind !== "workfile") return null;
  return parsed.data.client_state.config_override ?? null;
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

function canUseLimitedConfigOverride(
  license: LicenseFile,
  config: LicenseConfig | null | undefined
): boolean {
  if (!config) return false;
  if (!hasCapability({ permission: license.permission }, 'edit_limited_config')) return false;
  return hasSameStationPlan(license.config, config);
}

function hasSameStationPlan(base: LicenseConfig, override: LicenseConfig): boolean {
  return base.layout === override.layout
    && base.trading_stations_count === override.trading_stations_count
    && base.manufacturing_stations_count === override.manufacturing_stations_count
    && countRecordsEqual(base.product_requirements?.trading_stations, override.product_requirements?.trading_stations)
    && countRecordsEqual(base.product_requirements?.manufacturing_stations, override.product_requirements?.manufacturing_stations);
}

function countRecordsEqual(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

export function canReplaceOperators(license: LicenseFile): boolean {
  return hasCapability({ permission: license.permission, operatorUpdateGrantRemaining: license.operator_update_grant?.remaining }, 'replace_operator_data')
}

function isRawPermissionMode(value: string): value is RawPermissionMode {
  return (VALID_PERMISSION_MODES as string[]).includes(value);
}
