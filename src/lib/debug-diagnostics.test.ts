// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDebugDataBundle,
  clearDebugEvents,
  disableDebugMode,
  downloadDebugData,
  enableDebugMode,
  getDebugDiagnosticsSnapshot,
  installDebugDiagnostics,
  recordDebugApiEvent,
  recordDebugError,
} from './debug-diagnostics'

const STORAGE_KEY = 'maa:debug-diagnostics:v1'

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  window.history.replaceState({}, '', '/tool/settings?profile_id=profile-secret#private')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.removeItem(STORAGE_KEY)
})

describe('debug diagnostics storage', () => {
  it('enables, clears, and disables a local-only capture session', () => {
    expect(getDebugDiagnosticsSnapshot()).toMatchObject({ enabled: false, eventCount: 0 })

    expect(enableDebugMode()).toBe(true)
    expect(getDebugDiagnosticsSnapshot()).toMatchObject({ enabled: true, eventCount: 1 })
    expect(getDebugDiagnosticsSnapshot().events[0]).toMatchObject({ type: 'navigation', path: '/tool/settings' })

    expect(clearDebugEvents()).toBe(true)
    expect(getDebugDiagnosticsSnapshot()).toMatchObject({ enabled: true, eventCount: 0 })

    expect(disableDebugMode()).toBe(true)
    expect(getDebugDiagnosticsSnapshot()).toMatchObject({ enabled: false, eventCount: 0 })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('prunes records older than seven days and keeps only the latest 200 events', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    expect(enableDebugMode()).toBe(true)
    recordDebugApiEvent({ url: '/api/old', durationMs: 10, outcome: 'success', status: 200 })

    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'))
    recordDebugApiEvent({ url: '/api/new', durationMs: 20, outcome: 'success', status: 200 })
    expect(getDebugDiagnosticsSnapshot().events).toEqual([
      expect.objectContaining({ type: 'api', path: '/api/new' }),
    ])

    for (let index = 0; index < 205; index += 1) {
      recordDebugApiEvent({ url: `/api/item-${index}`, durationMs: index, outcome: 'success', status: 200 })
    }
    const snapshot = getDebugDiagnosticsSnapshot()
    expect(snapshot.eventCount).toBe(200)
    expect(snapshot.events[0]).toMatchObject({ type: 'api', path: '/api/item-5' })
    expect(snapshot.events[199]).toMatchObject({ type: 'api', path: '/api/item-204' })
  })

  it('ignores corrupt or unknown state and fails closed when storage writes are blocked', () => {
    window.localStorage.setItem(STORAGE_KEY, '{broken')
    expect(getDebugDiagnosticsSnapshot().enabled).toBe(false)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, enabled_at: new Date().toISOString(), events: [] }))
    expect(getDebugDiagnosticsSnapshot().enabled).toBe(false)

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
    expect(enableDebugMode()).toBe(false)
    setItem.mockRestore()
  })
})

describe('debug diagnostics privacy', () => {
  it('removes query data and dynamic ids while redacting bounded error messages', () => {
    expect(enableDebugMode()).toBe(true)
    recordDebugApiEvent({
      url: '/api/optimization/jobs/job-secret/cancel?profile_id=profile-secret&token=query-secret#private',
      method: 'post',
      durationMs: 12.4,
      outcome: 'http_error',
      status: 503,
      requestId: 'request-123',
      errorCode: 'service_unavailable',
    })
    recordDebugError(new Error(
      `password=plain-secret Bearer bearer-secret user@example.test https://example.test/path?token=url-secret ${'x'.repeat(600)}`,
    ), 'window_error', { source: 'https://example.test/assets/app.js?token=source-secret', line: 12, column: 8 })
    recordDebugError({ token: 'object-secret' }, 'unhandled_rejection')

    const snapshot = getDebugDiagnosticsSnapshot()
    const apiEvent = snapshot.events.find((event) => event.type === 'api')
    expect(apiEvent).toMatchObject({
      path: '/api/optimization/jobs/:jobId/cancel',
      method: 'POST',
      request_id: 'request-123',
      error_code: 'service_unavailable',
    })
    const serialized = JSON.stringify(snapshot.events)
    for (const secret of ['job-secret', 'profile-secret', 'query-secret', 'plain-secret', 'bearer-secret', 'user@example.test', 'url-secret', 'source-secret', 'object-secret']) {
      expect(serialized).not.toContain(secret)
    }
    const errorEvent = snapshot.events.find((event) => event.type === 'window_error')
    expect(errorEvent?.type === 'window_error' ? errorEvent.message.length : 0).toBeLessThanOrEqual(500)
    expect(snapshot.events.find((event) => event.type === 'unhandled_rejection')).toMatchObject({
      name: 'NonErrorRejection',
      message: 'Non-Error rejection',
    })
  })

  it('observes global errors without preventing existing browser handling', () => {
    expect(enableDebugMode()).toBe(true)
    const cleanup = installDebugDiagnostics()
    const dispatched = window.dispatchEvent(new ErrorEvent('error', {
      message: 'token=window-secret',
      error: new Error('token=window-secret'),
      filename: 'https://example.test/assets/app.js?token=source-secret',
      lineno: 4,
      colno: 2,
      cancelable: true,
    }))
    cleanup()

    expect(dispatched).toBe(true)
    expect(getDebugDiagnosticsSnapshot().events).toContainEqual(expect.objectContaining({
      type: 'window_error',
      source_path: '/assets/app.js',
      line: 4,
      column: 2,
    }))
  })
})

describe('debug data export', () => {
  it('builds a versioned bundle even when service health is unreachable and retains events', async () => {
    expect(enableDebugMode()).toBe(true)
    recordDebugApiEvent({ url: '/api/user/results/result-secret?token=query-secret', durationMs: 4, outcome: 'success', status: 200 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const bundle = await buildDebugDataBundle()

    expect(bundle).toMatchObject({
      schema_version: 1,
      capture: { retention_days: 7, event_limit: 200, event_count: 2 },
      service: { reachable: false, status: null, state: null, build_meta: null },
      privacy: {
        request_bodies_recorded: false,
        response_bodies_recorded: false,
        query_strings_recorded: false,
        cookies_recorded: false,
        storage_values_recorded: false,
        console_arguments_recorded: false,
        stack_traces_recorded: false,
      },
    })
    expect(JSON.stringify(bundle)).not.toContain('result-secret')
    expect(JSON.stringify(bundle)).not.toContain('query-secret')
    expect(getDebugDiagnosticsSnapshot()).toMatchObject({ enabled: true, eventCount: 2 })
  })

  it('downloads a timestamped JSON file and revokes its object URL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T12:34:56.000Z'))
    expect(enableDebugMode()).toBe(true)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const createObjectURL = vi.fn(() => 'blob:debug-data')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    let downloadedFilename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })

    await downloadDebugData()
    vi.runAllTimers()

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(downloadedFilename).toBe('maatool-debug-20260805-123456.json')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:debug-data')
    expect(getDebugDiagnosticsSnapshot().enabled).toBe(true)
  })
})
