const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 256 * 1024
export const DEPOT_VALUE_REQUEST_BODY_LIMIT_BYTES = 1024 * 1024

const ROUTE_BODY_LIMITS = new Map<string, number>([
  ['/api/depot-value', DEPOT_VALUE_REQUEST_BODY_LIMIT_BYTES],
])

export class RequestBodyTooLargeError extends Error {
  readonly limitBytes: number

  constructor(limitBytes: number) {
    super(`Request body exceeds the ${limitBytes}-byte limit`)
    this.name = 'RequestBodyTooLargeError'
    this.limitBytes = limitBytes
  }
}

export function getRequestBodyLimitBytes(pathname: string): number {
  return ROUTE_BODY_LIMITS.get(pathname) ?? DEFAULT_REQUEST_BODY_LIMIT_BYTES
}
