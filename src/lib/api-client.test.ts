// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  apiJson,
  apiJsonOrNull,
  getApiErrorCode,
  getApiRequestId,
  getApiRetryAfterSeconds,
} from './api-client'
import { enableDebugMode, getDebugDiagnosticsSnapshot } from './debug-diagnostics'

const DEBUG_STORAGE_KEY = 'maa:debug-diagnostics:v1'

beforeEach(() => {
  window.localStorage.removeItem(DEBUG_STORAGE_KEY)
  expect(enableDebugMode()).toBe(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.localStorage.removeItem(DEBUG_STORAGE_KEY)
})

describe('API client boundary', () => {
  it('parses JSON only when the success response declares JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-ID': 'request-success' },
    })))

    await expect(apiJson<{ ok: boolean }>('/api/test')).resolves.toEqual({ ok: true })
    expect(apiEvents()).toEqual([expect.objectContaining({
      outcome: 'success', status: 200, request_id: 'request-success', path: '/api/test',
    })])
  })

  it('rejects empty, non-JSON, and unexpected 204 responses with a stable code', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiJson('/api/empty')).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(apiJson('/api/text')).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(apiJson('/api/no-content')).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(apiJsonOrNull('/api/no-content')).resolves.toBeNull()
    expect(apiEvents().map((event) => event.outcome)).toEqual([
      'invalid_response', 'invalid_response', 'invalid_response', 'success',
    ])
  })

  it('exposes structured server diagnostics and Retry-After metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Invalid input',
      code: 'invalid_request',
      request_id: 'request-123',
      issues: [{ path: 'email', code: 'invalid_format' }],
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
    })))

    const error = await apiJson('/api/test').catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 429,
      code: 'invalid_request',
      requestId: 'request-123',
      issues: [{ path: 'email', code: 'invalid_format' }],
      retryAfterSeconds: 7,
    })
    expect(getApiErrorCode(error)).toBe('invalid_request')
    expect(getApiRequestId(error)).toBe('request-123')
    expect(getApiRetryAfterSeconds(error)).toBe(7)
    expect(apiEvents()).toEqual([expect.objectContaining({
      outcome: 'http_error', status: 429, request_id: 'request-123', error_code: 'invalid_request',
    })])
  })

  it('maps a deadline abort to request_timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', abortableFetch())

    const request = apiJson('/api/slow', { timeoutMs: 25 })
    const expectation = expect(request).rejects.toMatchObject({ status: 0, code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(apiEvents()).toEqual([expect.objectContaining({ outcome: 'timeout', status: null, error_code: 'request_timeout' })])
  })

  it('maps a caller abort separately from a deadline', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', abortableFetch())

    const request = apiJson('/api/cancelled', { signal: controller.signal })
    controller.abort()

    await expect(request).rejects.toMatchObject({ status: 0, code: 'request_aborted' })
    expect(apiEvents()).toEqual([expect.objectContaining({ outcome: 'aborted', status: null, error_code: 'request_aborted' })])
  })

  it('uses fallbackMessage for network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(apiJson('/api/offline', { fallbackMessage: '暂时无法连接服务。' }))
      .rejects.toMatchObject({ message: '暂时无法连接服务。', code: 'network_error' })
    expect(apiEvents()).toEqual([expect.objectContaining({ outcome: 'network_error', status: null, error_code: 'network_error' })])
  })

  it('never records query values or request payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', {
      headers: { 'Content-Type': 'application/json' },
    })))

    await apiJson('/api/user/workspace?profile_id=profile-secret&token=query-secret', {
      method: 'POST',
      json: { password: 'payload-secret' },
    })

    const serialized = JSON.stringify(getDebugDiagnosticsSnapshot().events)
    expect(serialized).toContain('/api/user/workspace')
    expect(serialized).not.toContain('profile-secret')
    expect(serialized).not.toContain('query-secret')
    expect(serialized).not.toContain('payload-secret')
  })
})

function apiEvents() {
  return getDebugDiagnosticsSnapshot().events.filter((event) => event.type === 'api')
}

function abortableFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  }))
}
