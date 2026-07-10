import type { LicenseConfig } from "../../../src/lib/types";
import type { OptimizeConfigPermission } from './shared';

export function asConfigRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function sanitizeConfigForPublicOptimize(
  config: LicenseConfig,
  permission: OptimizeConfigPermission,
): LicenseConfig {
  const next = structuredClone(config);

  if (permission === "free_preview" || permission === "recommended" || permission === "growth") {
    delete next.optimizer_search;
    delete next.variable_shift_schedule;
    return next;
  }

  if (permission === "ultimate" || permission === "admin") return next;

  if (next.optimization_mode !== "fast" && next.optimization_mode !== "exact") {
    delete next.optimization_mode;
  }

  const optimizerSearch = asConfigRecord(next.optimizer_search);
  if (optimizerSearch) {
    const sanitizedSearch: NonNullable<LicenseConfig["optimizer_search"]> = {};
    if (optimizerSearch.optimization_mode === "fast" || optimizerSearch.optimization_mode === "exact") {
      sanitizedSearch.optimization_mode = optimizerSearch.optimization_mode;
    }
    if (typeof optimizerSearch.beam === "boolean") {
      sanitizedSearch.beam = optimizerSearch.beam;
    }
    if (Object.keys(sanitizedSearch).length > 0) {
      next.optimizer_search = sanitizedSearch;
    } else {
      delete next.optimizer_search;
    }
  } else {
    delete next.optimizer_search;
  }

  const variableShiftSchedule = asConfigRecord(next.variable_shift_schedule);
  if (variableShiftSchedule) {
    const enable = typeof variableShiftSchedule.enable === "boolean"
      ? variableShiftSchedule.enable
      : typeof variableShiftSchedule.enabled === "boolean"
        ? variableShiftSchedule.enabled
        : undefined;
    if (enable === undefined) {
      delete next.variable_shift_schedule;
    } else {
      next.variable_shift_schedule = { enable };
    }
  } else {
    delete next.variable_shift_schedule;
  }

  return next;
}

export function jsonResponse(body: unknown, status = 200): Response {
  const responseBody = normalizeErrorBody(body, status);
  return new Response(JSON.stringify(responseBody), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizeErrorBody(body: unknown, status: number): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (typeof record.error !== "string") return body;
  const { error, code, ...details } = record;
  return {
    error: {
      code: typeof code === "string" ? code : errorCodeForStatus(status),
      message: error,
      ...(Object.keys(details).length > 0 && { details }),
    },
  };
}

export function errorCodeForStatus(status: number): string {
  if (status === 400) return "invalid_request";
  if (status === 401) return "authentication_required";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 409) return "conflict";
  if (status === 429) return "quota_exceeded";
  return status >= 500 ? "internal_error" : "request_failed";
}
