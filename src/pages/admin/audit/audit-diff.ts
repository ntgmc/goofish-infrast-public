export interface AuditChange {
  path: string
  before: unknown
  after: unknown
}

export function auditChanges(before: unknown, after: unknown, path = '$'): AuditChange[] {
  if (Object.is(before, after)) return []
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .flatMap((key) => auditChanges(before[key], after[key], `${path}[${JSON.stringify(key)}]`))
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length
    && before.every((value, index) => auditChanges(value, after[index]).length === 0)) return []
  return [{ path, before, after }]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
