import { appBuildMetaSchema } from './app-build-meta-validation'
import { APP_BUILD_META } from './build-meta'
import type { AppBuildMeta } from './types'

const DEBUG_STORAGE_KEY = 'maa:debug-diagnostics:v1'
const DEBUG_CHANGE_EVENT = 'maa:debug-diagnostics-change'
const DEBUG_SCHEMA_VERSION = 1
const DEBUG_EVENT_LIMIT = 200
const DEBUG_RETENTION_DAYS = 7
const DEBUG_RETENTION_MS = DEBUG_RETENTION_DAYS * 24 * 60 * 60 * 1_000
const DEBUG_ERROR_MESSAGE_LIMIT = 500
const DEBUG_HEALTH_TIMEOUT_MS = 5_000

const API_OUTCOMES = new Set<DebugApiOutcome>([
  'success',
  'http_error',
  'network_error',
  'timeout',
  'aborted',
  'invalid_response',
])
const ERROR_EVENT_TYPES = new Set<DebugErrorEventType>([
  'window_error',
  'unhandled_rejection',
  'react_error',
])
const SENSITIVE_ASSIGNMENT = /((?:["']?(?:password|token|secret|api[_-]?key|credential(?:_text)?|cred)["']?\s*[:=]\s*))("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi
const BEARER_TOKEN = /(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+(@)/gi
const URL_WITH_QUERY = /(https?:\/\/[^\s?#]+)[?#][^\s)\]}]*/gi
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

export type DebugApiOutcome =
  | 'success'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'aborted'
  | 'invalid_response'

export type DebugErrorEventType = 'window_error' | 'unhandled_rejection' | 'react_error'

interface DebugEventBase {
  timestamp: string
  page_path: string
}

interface DebugNavigationEvent extends DebugEventBase {
  type: 'navigation'
  path: string
}

interface DebugApiEvent extends DebugEventBase {
  type: 'api'
  method: string
  path: string
  status: number | null
  duration_ms: number
  outcome: DebugApiOutcome
  request_id?: string
  error_code?: string
}

interface DebugErrorEvent extends DebugEventBase {
  type: DebugErrorEventType
  name: string
  message: string
  source_path?: string
  line?: number
  column?: number
  context?: string
}

type DebugDiagnosticEvent = DebugNavigationEvent | DebugApiEvent | DebugErrorEvent

interface DebugStoredStateV1 {
  version: 1
  enabled_at: string
  events: DebugDiagnosticEvent[]
}

export interface DebugDiagnosticsSnapshot {
  enabled: boolean
  enabledAt: string | null
  eventCount: number
  storageAvailable: boolean
  events: DebugDiagnosticEvent[]
}

export interface DebugDataBundleV1 {
  schema_version: 1
  exported_at: string
  capture: {
    enabled_at: string
    retention_days: 7
    event_limit: 200
    event_count: number
  }
  app_build: AppBuildMeta
  service: {
    reachable: boolean
    status: number | null
    state: string | null
    build_meta: AppBuildMeta | null
  }
  browser: {
    origin: string
    pathname: string
    user_agent: string
    language: string
    languages: string[]
    timezone: string | null
    online: boolean
    visibility_state: string
    viewport: { width: number; height: number }
    device_pixel_ratio: number
    color_scheme: 'dark' | 'light'
    reduced_motion: boolean
  }
  privacy: {
    request_bodies_recorded: false
    response_bodies_recorded: false
    query_strings_recorded: false
    cookies_recorded: false
    storage_values_recorded: false
    console_arguments_recorded: false
    stack_traces_recorded: false
  }
  events: DebugDiagnosticEvent[]
}

export interface DebugApiEventInput {
  url: string
  method?: string
  status?: number | null
  durationMs: number
  outcome: DebugApiOutcome
  requestId?: string | null
  errorCode?: string | null
}

export interface DebugErrorOptions {
  source?: string | null
  line?: number | null
  column?: number | null
  context?: string | null
}

let diagnosticsCleanup: (() => void) | null = null

export function getDebugDiagnosticsSnapshot(): DebugDiagnosticsSnapshot {
  const storage = browserStorage()
  if (!storage) return disabledSnapshot(false)
  const state = readStoredState(storage)
  if (!state) return disabledSnapshot(true)
  return {
    enabled: true,
    enabledAt: state.enabled_at,
    eventCount: state.events.length,
    storageAvailable: true,
    events: [...state.events],
  }
}

export function enableDebugMode(): boolean {
  const storage = browserStorage()
  if (!storage) return false
  const current = readStoredState(storage)
  const state: DebugStoredStateV1 = current ?? {
    version: DEBUG_SCHEMA_VERSION,
    enabled_at: new Date().toISOString(),
    events: [],
  }
  if (!writeStoredState(storage, state)) return false
  recordDebugNavigation(currentPagePath())
  return true
}

export function disableDebugMode(): boolean {
  const storage = browserStorage()
  if (!storage) return false
  try {
    storage.removeItem(DEBUG_STORAGE_KEY)
    notifyDebugChange()
    return true
  } catch {
    return false
  }
}

export function clearDebugEvents(): boolean {
  const storage = browserStorage()
  if (!storage) return false
  const current = readStoredState(storage)
  if (!current) return false
  return writeStoredState(storage, { ...current, events: [] })
}

export function subscribeDebugDiagnostics(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEBUG_STORAGE_KEY) onChange()
  }
  window.addEventListener(DEBUG_CHANGE_EVENT, onChange)
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener(DEBUG_CHANGE_EVENT, onChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function recordDebugNavigation(pathname: string): boolean {
  const path = sanitizePath(pathname)
  const snapshot = getDebugDiagnosticsSnapshot()
  const previous = snapshot.events[snapshot.events.length - 1]
  if (previous?.type === 'navigation' && previous.path === path) return true
  return appendDebugEvent({
    type: 'navigation',
    timestamp: new Date().toISOString(),
    page_path: currentPagePath(),
    path,
  })
}

export function recordDebugApiEvent(input: DebugApiEventInput): boolean {
  const requestId = safeIdentifier(input.requestId, 128)
  const errorCode = safeIdentifier(input.errorCode, 64)
  return appendDebugEvent({
    type: 'api',
    timestamp: new Date().toISOString(),
    page_path: currentPagePath(),
    method: sanitizeMethod(input.method),
    path: sanitizeApiPath(input.url),
    status: safeStatus(input.status),
    duration_ms: safeDuration(input.durationMs),
    outcome: API_OUTCOMES.has(input.outcome) ? input.outcome : 'network_error',
    ...(requestId && { request_id: requestId }),
    ...(errorCode && { error_code: errorCode }),
  })
}

export function recordDebugError(
  error: unknown,
  type: DebugErrorEventType,
  options: DebugErrorOptions = {},
): boolean {
  const normalizedType = ERROR_EVENT_TYPES.has(type) ? type : 'window_error'
  const details = errorDetails(error, normalizedType)
  const sourcePath = options.source ? sanitizeSourcePath(options.source) : null
  const context = safeIdentifier(options.context, 64)
  const line = safePositiveInteger(options.line)
  const column = safePositiveInteger(options.column)
  return appendDebugEvent({
    type: normalizedType,
    timestamp: new Date().toISOString(),
    page_path: currentPagePath(),
    name: details.name,
    message: details.message,
    ...(sourcePath && { source_path: sourcePath }),
    ...(line !== null && { line }),
    ...(column !== null && { column }),
    ...(context && { context }),
  })
}

export function installDebugDiagnostics(): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (diagnosticsCleanup) return diagnosticsCleanup

  const handleWindowError = (event: ErrorEvent) => {
    recordDebugError(event.error ?? event.message, 'window_error', {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  }
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    recordDebugError(event.reason, 'unhandled_rejection')
  }

  window.addEventListener('error', handleWindowError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  diagnosticsCleanup = () => {
    window.removeEventListener('error', handleWindowError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    diagnosticsCleanup = null
  }
  return diagnosticsCleanup
}

export async function buildDebugDataBundle(): Promise<DebugDataBundleV1> {
  const beforeProbe = getDebugDiagnosticsSnapshot()
  if (!beforeProbe.enabled || !beforeProbe.enabledAt) throw new Error('Debug mode is not enabled.')
  const service = await probeServiceHealth()
  const snapshot = getDebugDiagnosticsSnapshot()
  if (!snapshot.enabled || !snapshot.enabledAt) throw new Error('Debug mode was disabled before export completed.')
  const exportedAt = new Date().toISOString()
  return {
    schema_version: DEBUG_SCHEMA_VERSION,
    exported_at: exportedAt,
    capture: {
      enabled_at: snapshot.enabledAt,
      retention_days: DEBUG_RETENTION_DAYS,
      event_limit: DEBUG_EVENT_LIMIT,
      event_count: snapshot.events.length,
    },
    app_build: { ...APP_BUILD_META },
    service,
    browser: browserSnapshot(),
    privacy: {
      request_bodies_recorded: false,
      response_bodies_recorded: false,
      query_strings_recorded: false,
      cookies_recorded: false,
      storage_values_recorded: false,
      console_arguments_recorded: false,
      stack_traces_recorded: false,
    },
    events: snapshot.events,
  }
}

export async function downloadDebugData(): Promise<DebugDataBundleV1> {
  const bundle = await buildDebugDataBundle()
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = debugFilename(bundle.exported_at)
  try {
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return bundle
}

function appendDebugEvent(event: DebugDiagnosticEvent): boolean {
  const storage = browserStorage()
  if (!storage) return false
  const current = readStoredState(storage)
  if (!current) return false
  return writeStoredState(storage, {
    ...current,
    events: pruneEvents([...current.events, event], Date.now()),
  })
}

function readStoredState(storage: Storage): DebugStoredStateV1 | null {
  let raw: string | null
  try {
    raw = storage.getItem(DEBUG_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== DEBUG_SCHEMA_VERSION || !validTimestamp(parsed.enabled_at)) return null
  if (!Array.isArray(parsed.events)) return null
  const parsedEvents = parsed.events.flatMap((event) => {
    const normalized = parseStoredEvent(event)
    return normalized ? [normalized] : []
  })
  const events = pruneEvents(parsedEvents, Date.now())
  if (events.length !== parsed.events.length) {
    try {
      storage.setItem(DEBUG_STORAGE_KEY, JSON.stringify({
        version: DEBUG_SCHEMA_VERSION,
        enabled_at: parsed.enabled_at,
        events,
      }))
    } catch {
      // A sanitized in-memory snapshot is still safer than surfacing invalid data.
    }
  }
  return { version: DEBUG_SCHEMA_VERSION, enabled_at: parsed.enabled_at, events }
}

function writeStoredState(storage: Storage, state: DebugStoredStateV1): boolean {
  const next = { ...state, events: pruneEvents(state.events, Date.now()) }
  try {
    storage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(next))
    notifyDebugChange()
    return true
  } catch {
    return false
  }
}

function parseStoredEvent(value: unknown): DebugDiagnosticEvent | null {
  if (!isRecord(value) || !validTimestamp(value.timestamp)) return null
  const pagePath = sanitizePath(typeof value.page_path === 'string' ? value.page_path : '/')
  if (value.type === 'navigation' && typeof value.path === 'string') {
    return { type: 'navigation', timestamp: value.timestamp, page_path: pagePath, path: sanitizePath(value.path) }
  }
  if (value.type === 'api' && typeof value.path === 'string' && typeof value.outcome === 'string') {
    if (!API_OUTCOMES.has(value.outcome as DebugApiOutcome)) return null
    const requestId = safeIdentifier(value.request_id, 128)
    const errorCode = safeIdentifier(value.error_code, 64)
    return {
      type: 'api',
      timestamp: value.timestamp,
      page_path: pagePath,
      method: sanitizeMethod(typeof value.method === 'string' ? value.method : undefined),
      path: sanitizeApiPath(value.path),
      status: safeStatus(typeof value.status === 'number' ? value.status : null),
      duration_ms: safeDuration(typeof value.duration_ms === 'number' ? value.duration_ms : 0),
      outcome: value.outcome as DebugApiOutcome,
      ...(requestId && { request_id: requestId }),
      ...(errorCode && { error_code: errorCode }),
    }
  }
  if (typeof value.type === 'string' && ERROR_EVENT_TYPES.has(value.type as DebugErrorEventType)) {
    const sourcePath = typeof value.source_path === 'string' ? sanitizeSourcePath(value.source_path) : null
    const context = safeIdentifier(value.context, 64)
    const line = safePositiveInteger(value.line)
    const column = safePositiveInteger(value.column)
    return {
      type: value.type as DebugErrorEventType,
      timestamp: value.timestamp,
      page_path: pagePath,
      name: sanitizeErrorName(typeof value.name === 'string' ? value.name : 'Error'),
      message: sanitizeDebugMessage(typeof value.message === 'string' ? value.message : 'Unknown error'),
      ...(sourcePath && { source_path: sourcePath }),
      ...(line !== null && { line }),
      ...(column !== null && { column }),
      ...(context && { context }),
    }
  }
  return null
}

function pruneEvents(events: DebugDiagnosticEvent[], now: number): DebugDiagnosticEvent[] {
  const cutoff = now - DEBUG_RETENTION_MS
  return events
    .filter((event) => Date.parse(event.timestamp) >= cutoff)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-DEBUG_EVENT_LIMIT)
}

async function probeServiceHealth(): Promise<DebugDataBundleV1['service']> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), DEBUG_HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    const buildMetaResult = appBuildMetaSchema.safeParse(isRecord(body) ? body.build_meta : null)
    return {
      reachable: true,
      status: response.status,
      state: safeIdentifier(isRecord(body) ? body.state : null, 64),
      build_meta: buildMetaResult.success ? buildMetaResult.data : null,
    }
  } catch {
    return { reachable: false, status: null, state: null, build_meta: null }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

function browserSnapshot(): DebugDataBundleV1['browser'] {
  const timezone = readTimezone()
  return {
    origin: window.location.origin,
    pathname: sanitizePath(window.location.pathname),
    user_agent: sanitizeBoundedText(navigator.userAgent, 512),
    language: sanitizeBoundedText(navigator.language, 64),
    languages: navigator.languages.slice(0, 10).map((value) => sanitizeBoundedText(value, 64)),
    timezone,
    online: navigator.onLine,
    visibility_state: sanitizeBoundedText(document.visibilityState, 32),
    viewport: {
      width: safeDimension(window.innerWidth),
      height: safeDimension(window.innerHeight),
    },
    device_pixel_ratio: safeDevicePixelRatio(window.devicePixelRatio),
    color_scheme: safeMediaMatch('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    reduced_motion: safeMediaMatch('(prefers-reduced-motion: reduce)'),
  }
}

function errorDetails(error: unknown, type: DebugErrorEventType): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: sanitizeErrorName(error.name),
      message: sanitizeDebugMessage(error.message || error.name || 'Unknown error'),
    }
  }
  if (typeof error === 'string') {
    return { name: type === 'unhandled_rejection' ? 'NonErrorRejection' : 'Error', message: sanitizeDebugMessage(error) }
  }
  return {
    name: type === 'unhandled_rejection' ? 'NonErrorRejection' : 'UnknownError',
    message: type === 'unhandled_rejection' ? 'Non-Error rejection' : 'Unknown error',
  }
}

function sanitizeDebugMessage(value: string): string {
  const sanitized = value
    .replace(URL_PASSWORD, '$1<redacted>$2')
    .replace(BEARER_TOKEN, '$1<redacted>')
    .replace(SENSITIVE_ASSIGNMENT, '$1<redacted>')
    .replace(URL_WITH_QUERY, '$1?<redacted>')
    .replace(EMAIL_ADDRESS, '<redacted-email>')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
  return sanitized.slice(0, DEBUG_ERROR_MESSAGE_LIMIT) || 'Unknown error'
}

function sanitizeApiPath(value: string): string {
  const path = sanitizePath(value)
  return path
    .replace(/^\/api\/user\/results\/[^/]+(?=\/|$)/, '/api/user/results/:resultId')
    .replace(/^\/api\/optimization\/jobs\/[^/]+(?=\/|$)/, '/api/optimization/jobs/:jobId')
}

function sanitizeSourcePath(value: string): string | null {
  if (!value) return null
  return sanitizePath(value)
}

function sanitizePath(value: string): string {
  try {
    const base = typeof window === 'undefined' ? 'https://debug.invalid' : window.location.origin
    const url = new URL(value, base)
    const pathname = url.pathname.replace(/\/{2,}/g, '/').slice(0, 256)
    return pathname.startsWith('/') ? pathname || '/' : `/${pathname}`
  } catch {
    return '/invalid-path'
  }
}

function sanitizeMethod(value: string | undefined): string {
  const method = (value || 'GET').toUpperCase()
  return /^[A-Z]{1,12}$/.test(method) ? method : 'UNKNOWN'
}

function sanitizeErrorName(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : 'Error'
}

function sanitizeBoundedText(value: string, maximum: number): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function safeIdentifier(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maximum && /^[A-Za-z0-9_.:-]+$/.test(normalized)
    ? normalized
    : null
}

function safeStatus(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 599 ? value : null
}

function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(600_000, Math.round(value))) : 0
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10_000_000 ? value : null
}

function safeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100_000, Math.round(value))) : 0
}

function safeDevicePixelRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 1
}

function safeMediaMatch(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

function readTimezone(): string | null {
  try {
    return sanitizeBoundedText(Intl.DateTimeFormat().resolvedOptions().timeZone || '', 128) || null
  } catch {
    return null
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function currentPagePath(): string {
  return typeof window === 'undefined' ? '/' : sanitizePath(window.location.pathname)
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function disabledSnapshot(storageAvailable: boolean): DebugDiagnosticsSnapshot {
  return { enabled: false, enabledAt: null, eventCount: 0, storageAvailable, events: [] }
}

function notifyDebugChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEBUG_CHANGE_EVENT))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function debugFilename(exportedAt: string): string {
  return `maatool-debug-${exportedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.json`
}
