import { BEHAVIOR_RISK_BROWSER_HEADER, getBehaviorRiskBrowserInstance } from './behavior-risk-client'

export class ApiError extends Error {
  status: number
  data: unknown
  url: string

  constructor(message: string, status: number, data: unknown, url: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.url = url
  }
}

export type ApiRequestInit = Omit<RequestInit, 'body'> & {
  json?: unknown
  fallbackMessage?: string
}

export async function apiJson<T>(url: string, init: ApiRequestInit = {}): Promise<T> {
  const response = await request(url, init)
  return await parseJson<T>(response)
}

export async function apiJsonOrNull<T>(url: string, init: ApiRequestInit = {}): Promise<T | null> {
  const response = await request(url, init)
  if (response.status === 204) return null
  return await parseJson<T>(response)
}

export async function apiVoid(url: string, init: ApiRequestInit = {}): Promise<void> {
  await request(url, init)
}

export async function apiBlob(url: string, init: ApiRequestInit = {}): Promise<Blob> {
  const response = await request(url, init)
  return await response.blob()
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function getApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return null
  const directCode = 'code' in error.data ? (error.data as { code?: unknown }).code : undefined
  if (typeof directCode === 'string') return directCode
  const structuredError = 'error' in error.data ? (error.data as { error?: unknown }).error : undefined
  if (!structuredError || typeof structuredError !== 'object' || !('code' in structuredError)) return null
  const nestedCode = (structuredError as { code?: unknown }).code
  return typeof nestedCode === 'string' ? nestedCode : null
}

export function getApiRetryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return null
  const value = 'retry_after_seconds' in error.data
    ? (error.data as { retry_after_seconds?: unknown }).retry_after_seconds
    : undefined
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null
}

async function request(url: string, init: ApiRequestInit): Promise<Response> {
  const { json, fallbackMessage, headers, ...rest } = init
  const requestHeaders = new Headers(headers)
  const browserInstance = getBehaviorRiskBrowserInstance()
  if (browserInstance && !requestHeaders.has(BEHAVIOR_RISK_BROWSER_HEADER)) {
    requestHeaders.set(BEHAVIOR_RISK_BROWSER_HEADER, browserInstance)
  }
  const requestInit: RequestInit = { ...rest, headers: requestHeaders }

  if (json !== undefined) {
    requestInit.body = JSON.stringify(json)
    requestInit.headers = withJsonHeader(requestHeaders)
  }

  const response = await fetch(url, requestInit)
  if (response.ok) return response

  const data = await readResponseData(response)
  throw new ApiError(readErrorMessage(data, fallbackMessage || `Request failed: ${response.status}`), response.status, data, url)
}

function withJsonHeader(headers: HeadersInit | undefined): HeadersInit {
  const next = new Headers(headers)
  if (!next.has('Content-Type')) next.set('Content-Type', 'application/json')
  return next
}

async function parseJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

async function readResponseData(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
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
