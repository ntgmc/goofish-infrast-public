import type { LicenseConfig, LicenseFile, LicenseOperator, PermissionMode, RawPermissionMode, WorkFile } from "./types";
import { decryptPayload } from "./crypto";

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
      return { ok: false, error: { code: "DECRYPT_FAILED", message: "授权文件无法读取，文件可能已损坏。" } };
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
      return { ok: false, error: { code: "DECRYPT_FAILED", message: "保存进度文件无法读取，文件可能已损坏。" } };
    }
  }

  return {
    ok: false,
    error: {
      code: "INVALID_PREFIX",
      message: "无法识别这个文件。请上传本站生成的授权文件，或本工具保存的进度文件。",
    },
  };
}

function validateLicenseStructure(
  license: LicenseFile
): { ok: true } | { ok: false; error: ValidateError } {
  if (!license.order_hash || !license.operators || !license.config || !license.sig) {
    return { ok: false, error: { code: "MISSING_FIELDS", message: "授权文件缺少必要信息。" } };
  }
  if (license.version !== 1) {
    return { ok: false, error: { code: "VERSION_MISMATCH", message: "不支持这个授权文件版本。" } };
  }
  if (!Array.isArray(license.operators) || license.operators.length === 0) {
    return { ok: false, error: { code: "INVALID_DATA", message: "授权文件中的干员列表为空。" } };
  }
  if (license.permission && !isRawPermissionMode(license.permission)) {
    return { ok: false, error: { code: "INVALID_PERMISSION", message: "授权文件包含未知权限类型。" } };
  }
  const configCheck = validateConfigStructure(license.config);
  if (!configCheck.ok) return configCheck;
  return { ok: true };
}

function validateConfigStructure(
  config: LicenseConfig
): { ok: true } | { ok: false; error: ValidateError } {
  if (!config.layout || !config.product_requirements) {
    return { ok: false, error: { code: "INVALID_CONFIG", message: "基建配置缺少必要信息。" } };
  }
  if (
    typeof config.trading_stations_count !== "number" ||
    typeof config.manufacturing_stations_count !== "number"
  ) {
    return { ok: false, error: { code: "INVALID_CONFIG", message: "基建配置中的建筑数量不正确。" } };
  }
  return { ok: true };
}

function validateWorkFileStructure(
  workfile: WorkFile
): { ok: true } | { ok: false; error: ValidateError } {
  if (!workfile.license || !workfile.client_state) {
    return { ok: false, error: { code: "MISSING_FIELDS", message: "保存进度文件缺少必要信息。" } };
  }

  const licenseCheck = validateLicenseStructure(workfile.license);
  if (!licenseCheck.ok) return licenseCheck;

  if (!workfile.client_state.operator_elite_overrides || !workfile.client_state.client_sig) {
    return { ok: false, error: { code: "MISSING_FIELDS", message: "保存进度文件缺少上次保存的调整信息。" } };
  }

  if (workfile.client_state.config_override) {
    if (!canEditConfig(workfile.license) && !canUseLimitedConfigOverride(workfile.license, workfile.client_state.config_override)) {
      return { ok: false, error: { code: "PERMISSION_DENIED", message: "当前授权不允许修改基建配置。" } };
    }
    const configCheck = validateConfigStructure(workfile.client_state.config_override);
    if (!configCheck.ok) return configCheck;
  }

  const overrides = workfile.client_state.operator_elite_overrides;
  const licenseIds = new Set(workfile.license.operators.map((op) => op.id));

  for (const id of Object.keys(overrides)) {
    if (!licenseIds.has(id)) {
      return { ok: false, error: { code: "UNKNOWN_OPERATOR", message: `保存进度文件包含未知干员: ${id}` } };
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
  switch (license.permission) {
    case "recommended":
    case "growth":
    case "advanced":
    case "ultimate":
    case "admin":
      return license.permission;
    case "premium":
      return "advanced";
    case "basic":
    default:
      return "growth";
  }
}

export function canUseUpgradeFeatures(license: LicenseFile): boolean {
  return getPermissionMode(license) !== "recommended";
}

export function canEditConfig(license: LicenseFile): boolean {
  const permission = getPermissionMode(license);
  return permission === "advanced" || permission === "ultimate" || permission === "admin";
}

export function isIntermediateAutoConfig(config: LicenseConfig | null | undefined): boolean {
  return config?.auto_balance_source === "intermediate_inventory" || config?.auto_balance_source === "limited_config";
}

export function canUseIntermediateAutoConfig(
  license: LicenseFile,
  config: LicenseConfig | null | undefined
): boolean {
  const permission = getPermissionMode(license);
  return (permission === "recommended" || permission === "growth") && isIntermediateAutoConfig(config);
}

function canUseLimitedConfigOverride(
  license: LicenseFile,
  config: LicenseConfig | null | undefined
): boolean {
  if (!config) return false;
  const permission = getPermissionMode(license);
  if (permission !== "recommended" && permission !== "growth") return false;
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
  const permission = getPermissionMode(license);
  return permission === "advanced" || permission === "admin" || (license.operator_update_grant?.remaining ?? 0) > 0;
}

function isRawPermissionMode(value: string): value is RawPermissionMode {
  return (VALID_PERMISSION_MODES as string[]).includes(value);
}
