import { recordDebugApiEvent, type DebugApiOutcome } from './debug-diagnostics'

export class ApiError extends Error {
  readonly status: number
  readonly data: unknown
  readonly url: string
  readonly code: string | null
  readonly requestId: string | null
  readonly issues: ApiValidationIssue[]
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    status: number,
    data: unknown,
    url: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.url = url
    this.code = readApiErrorCode(data)
    this.requestId = readStringProperty(data, 'request_id')
    this.issues = readValidationIssues(data)
    this.retryAfterSeconds = retryAfterSeconds ?? readRetryAfterSecondsFromData(data)
  }
}

export type ApiValidationIssue = { path: string; code: string }

const DEFAULT_QUERY_TIMEOUT_MS = 15_000
const DEFAULT_MUTATION_TIMEOUT_MS = 30_000

export type ApiRequestInit = Omit<RequestInit, 'body'> & {
  json?: unknown
  fallbackMessage?: string
  timeoutMs?: number
}

export async function apiJson<T>(url: string, init: ApiRequestInit = {}): Promise<T> {
  const pending = await request(url, init)
  try {
    const result = await parseJson<T>(pending.response, url, init.fallbackMessage)
    pending.completeSuccess()
    return result
  } catch (error) {
    const normalized = pending.normalizeError(error)
    pending.completeFailure(normalized)
    throw normalized
  } finally {
    pending.cleanup()
  }
}

export async function apiJsonOrNull<T>(url: string, init: ApiRequestInit = {}): Promise<T | null> {
  const pending = await request(url, init)
  try {
    if (pending.response.status === 204) {
      pending.completeSuccess()
      return null
    }
    const result = await parseJson<T>(pending.response, url, init.fallbackMessage)
    pending.completeSuccess()
    return result
  } catch (error) {
    const normalized = pending.normalizeError(error)
    pending.completeFailure(normalized)
    throw normalized
  } finally {
    pending.cleanup()
  }
}

export async function apiVoid(url: string, init: ApiRequestInit = {}): Promise<void> {
  const pending = await request(url, init)
  try {
    await pending.response.body?.cancel()
    pending.completeSuccess()
  } catch (error) {
    const normalized = pending.normalizeError(error)
    pending.completeFailure(normalized)
    throw normalized
  } finally {
    pending.cleanup()
  }
}

export async function apiBlob(url: string, init: ApiRequestInit = {}): Promise<Blob> {
  const pending = await request(url, init)
  try {
    const result = await pending.response.blob()
    pending.completeSuccess()
    return result
  } catch (error) {
    const normalized = pending.normalizeError(error)
    pending.completeFailure(normalized)
    throw normalized
  } finally {
    pending.cleanup()
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function getApiErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null
}

export function getApiRetryAfterSeconds(error: unknown): number | null {
  return error instanceof ApiError ? error.retryAfterSeconds : null
}

export function getApiRequestId(error: unknown): string | null {
  return error instanceof ApiError ? error.requestId : null
}

type PendingResponse = {
  response: Response
  cleanup: () => void
  normalizeError: (error: unknown) => ApiError
  completeSuccess: () => void
  completeFailure: (error: ApiError) => void
}

async function request(url: string, init: ApiRequestInit): Promise<PendingResponse> {
  const { json, fallbackMessage, headers, timeoutMs, signal: callerSignal, ...rest } = init
  const diagnostics = createRequestDiagnostics(url, rest.method)
  const requestHeaders = new Headers(headers)
  const deadline = createRequestDeadline(
    callerSignal,
    timeoutMs ?? defaultTimeoutMs(rest.method),
  )
  const requestInit: RequestInit = { ...rest, headers: requestHeaders, signal: deadline.signal }

  if (json !== undefined) {
    requestInit.body = JSON.stringify(json)
    requestInit.headers = withJsonHeader(requestHeaders)
  }

  try {
    const response = await fetch(url, requestInit)
    diagnostics.setResponse(response)
    if (response.ok) {
      return {
        response,
        cleanup: deadline.cleanup,
        normalizeError: (error) => normalizeRequestError(error, url, fallbackMessage, callerSignal, deadline),
        completeSuccess: diagnostics.completeSuccess,
        completeFailure: diagnostics.completeFailure,
      }
    }

    const data = await readResponseData(response)
    throw new ApiError(
      readErrorMessage(data, fallbackMessage || `Request failed: ${response.status}`),
      response.status,
      data,
      url,
      readRetryAfterHeader(response.headers.get('Retry-After')),
    )
  } catch (error) {
    deadline.cleanup()
    const normalized = normalizeRequestError(error, url, fallbackMessage, callerSignal, deadline)
    diagnostics.completeFailure(normalized)
    throw normalized
  }
}

function createRequestDiagnostics(url: string, method: string | undefined): {
  setResponse: (response: Response) => void
  completeSuccess: () => void
  completeFailure: (error: ApiError) => void
} {
  const startedAt = debugNow()
  let response: Response | null = null
  let completed = false
  const finish = (error: ApiError | null) => {
    if (completed) return
    completed = true
    const status = response?.status ?? (error && error.status > 0 ? error.status : null)
    try {
      recordDebugApiEvent({
        url,
        method,
        status,
        durationMs: debugNow() - startedAt,
        outcome: debugApiOutcome(error, status),
        requestId: response?.headers.get('X-Request-ID') || error?.requestId,
        errorCode: error?.code,
      })
    } catch {
      // Diagnostics must never affect the API contract.
    }
  }
  return {
    setResponse: (nextResponse) => { response = nextResponse },
    completeSuccess: () => finish(null),
    completeFailure: (error) => finish(error),
  }
}

function debugApiOutcome(error: ApiError | null, status: number | null): DebugApiOutcome {
  if (!error) return 'success'
  if (error.code === 'request_timeout') return 'timeout'
  if (error.code === 'request_aborted') return 'aborted'
  if (error.code === 'invalid_response') return 'invalid_response'
  if (status !== null && status >= 300) return 'http_error'
  return 'network_error'
}

function debugNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function withJsonHeader(headers: HeadersInit | undefined): HeadersInit {
  const next = new Headers(headers)
  if (!next.has('Content-Type')) next.set('Content-Type', 'application/json')
  return next
}

async function parseJson<T>(response: Response, url: string, fallbackMessage?: string): Promise<T> {
  if (response.status === 204) {
    throw new ApiError(fallbackMessage || 'Expected a JSON response but received no content.', response.status, { code: 'invalid_response' }, url)
  }
  if (!isJsonContentType(response.headers.get('Content-Type'))) {
    throw new ApiError(fallbackMessage || 'Expected a JSON response.', response.status, { code: 'invalid_response' }, url)
  }
  const text = await response.text()
  if (!text.trim()) {
    throw new ApiError(fallbackMessage || 'Expected a JSON response but received an empty body.', response.status, { code: 'invalid_response' }, url)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(fallbackMessage || 'Response body contains invalid JSON.', response.status, { code: 'invalid_response' }, url)
  }
}

async function readResponseData(response: Response): Promise<unknown> {
  if (!isJsonContentType(response.headers.get('Content-Type'))) return null
  try {
    const text = await response.text()
    return text.trim() ? JSON.parse(text) : null
  } catch (error) {
    if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) throw error
    return null
  }
}

function isJsonContentType(value: string | null): boolean {
  return Boolean(value && /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(value))
}

function defaultTimeoutMs(method: string | undefined): number {
  return !method || method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD'
    ? DEFAULT_QUERY_TIMEOUT_MS
    : DEFAULT_MUTATION_TIMEOUT_MS
}

function createRequestDeadline(callerSignal: AbortSignal | null | undefined, timeoutMs: number): {
  signal: AbortSignal
  cleanup: () => void
  didTimeout: () => boolean
} {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiError('Request timeout must be a positive finite number.', 0, { code: 'invalid_request_timeout' }, '')
  }
  const controller = new AbortController()
  let timedOut = false
  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) onCallerAbort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Request timed out', 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
    didTimeout: () => timedOut,
  }
}

function normalizeRequestError(
  error: unknown,
  url: string,
  fallbackMessage: string | undefined,
  callerSignal: AbortSignal | null | undefined,
  deadline: { didTimeout: () => boolean },
): ApiError {
  if (error instanceof ApiError) return error
  if (deadline.didTimeout()) {
    return new ApiError(fallbackMessage || 'Request timed out.', 0, { code: 'request_timeout' }, url)
  }
  if (callerSignal?.aborted) {
    return new ApiError(fallbackMessage || 'Request was cancelled.', 0, { code: 'request_aborted' }, url)
  }
  return new ApiError(fallbackMessage || 'Network request failed.', 0, { code: 'network_error' }, url)
}

function readApiErrorCode(data: unknown): string | null {
  const directCode = readStringProperty(data, 'code')
  if (directCode) return directCode
  if (!data || typeof data !== 'object') return null
  return readStringProperty((data as { error?: unknown }).error, 'code')
}

function readStringProperty(data: unknown, property: string): string | null {
  if (!data || typeof data !== 'object' || !(property in data)) return null
  const value = (data as Record<string, unknown>)[property]
  return typeof value === 'string' && value ? value : null
}

function readValidationIssues(data: unknown): ApiValidationIssue[] {
  if (!data || typeof data !== 'object') return []
  const issues = (data as { issues?: unknown }).issues
  if (!Array.isArray(issues)) return []
  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return []
    const path = readStringProperty(issue, 'path')
    const code = readStringProperty(issue, 'code')
    return path !== null && code !== null ? [{ path, code }] : []
  }).slice(0, 10)
}

function readRetryAfterSecondsFromData(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const value = (data as { retry_after_seconds?: unknown }).retry_after_seconds
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null
}

function readRetryAfterHeader(value: string | null): number | null {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Math.max(1, Number(value.trim()))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - Date.now()) / 1_000)) : null
}

function readErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const error = 'error' in data ? (data as { error?: unknown }).error : undefined
    if (typeof error === 'string' && error) return error
    if (error && typeof error === 'object' && 'message' in error) {
      const structuredMessage = (error as { message?: unknown }).message
      if (typeof structuredMessage === 'string' && structuredMessage) return structuredMessage
    }
    const message = 'message' in data ? (data as { message?: unknown }).message : undefined
    if (typeof message === 'string' && message) return message
  }
  return fallback
}
