import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_FEATURES } from '../../src/lib/site-features'
import { DEFAULT_PUBLIC_CONTENT_DRAFT } from '../../src/lib/public-content'
import { getRegisteredApiRoutes } from '../routes'
import { inspectIncomingRequest } from './http-boundary'
import { getAllowedMethods, getRoutePolicy, requestSchemas } from './request-policy'
import {
  getValidatedJson,
  RequestInputError,
  stableJsonStringify,
  validateAndStoreJsonBody,
} from './request-validation'

function jsonRequest(value: string): Request {
  return new Request('http://local/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: value,
  })
}

function incomingGet(target: string): IncomingMessage {
  return {
    method: 'GET',
    url: target,
    headers: { host: 'local' },
    rawHeaders: ['Host', 'local'],
  } as IncomingMessage
}

describe('request validation boundary', () => {
  it('declares a fail-closed policy for every registered API route', () => {
    for (const registeredRoute of getRegisteredApiRoutes()) {
      const pathname = registeredRoute
        .replace(':jobId', 'job_test-1')
        .replace(':code', 'welcome_inventory')
      const policy = getRoutePolicy(pathname)
      expect(policy, `missing request policy for ${registeredRoute}`).not.toBeNull()
      expect(getAllowedMethods(policy!)).not.toHaveLength(0)
    }
  })

  it('only declares onboarding claim policies for fixed task codes', () => {
    expect(getRoutePolicy('/api/user/onboarding-tasks/welcome_inventory/claim')).not.toBeNull()
    expect(getRoutePolicy('/api/user/onboarding-tasks/custom_task/claim')).toBeNull()
  })

  it('allows profile selection when restoring an authenticated session', async () => {
    const selectedProfile = inspectIncomingRequest(incomingGet('/api/auth/me?profile_id=profile-2'))
    expect(selectedProfile.allowed).toBe(true)

    const unknownQuery = inspectIncomingRequest(incomingGet('/api/auth/me?profile_id=profile-2&admin=1'))
    expect(unknownQuery.allowed).toBe(false)
    if (!unknownQuery.allowed) {
      expect(unknownQuery.response.status).toBe(400)
      await expect(unknownQuery.response.json()).resolves.toMatchObject({ code: 'invalid_request' })
    }
  })

  it('stores only data accepted by the route schema', async () => {
    const request = jsonRequest(JSON.stringify({ email: 'user@example.com', password: 'password' }))
    await validateAndStoreJsonBody(request, requestSchemas.authLogin, 'auth')
    await expect(getValidatedJson(request, requestSchemas.authLogin)).resolves.toEqual({
      email: 'user@example.com',
      password: 'password',
    })
  })

  it.each([
    ['unknown field', JSON.stringify({ email: 'user@example.com', password: 'password', admin: true })],
    ['null root', 'null'],
    ['array root', '[]'],
    ['dangerous key', '{"email":"user@example.com","password":"password","__proto__":{}}'],
  ])('rejects %s', async (_label, body) => {
    await expect(validateAndStoreJsonBody(
      jsonRequest(body),
      requestSchemas.authLogin,
      'auth',
    )).rejects.toBeInstanceOf(RequestInputError)
  })

  it('rejects excessive nesting before schema traversal', async () => {
    let value = '"leaf"'
    for (let index = 0; index < 26; index += 1) value = `{"nested":${value}}`
    await expect(validateAndStoreJsonBody(
      jsonRequest(value),
      requestSchemas.authLogin,
      'auth',
    )).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('enforces the body profile even when called without the HTTP adapter', async () => {
    const request = jsonRequest(JSON.stringify({
      email: 'user@example.com',
      password: 'x'.repeat(17 * 1024),
    }))
    await expect(validateAndStoreJsonBody(request, requestSchemas.authLogin, 'auth'))
      .rejects.toMatchObject({ status: 413, code: 'payload_too_large' })
  })

  it('serializes validated idempotency input with stable object ordering', () => {
    expect(stableJsonStringify({ z: 1, nested: { b: 2, a: 1 }, items: [{ y: 2, x: 1 }] }))
      .toBe('{"items":[{"x":1,"y":2}],"nested":{"a":1,"b":2},"z":1}')
  })

  it('accepts only the merged schedule request contract', () => {
    const base = {
      identity: { type: 'profile', profileId: 'profile-1' },
      operators: [{ id: 'op-1', name: 'Operator', own: true, elite: 2, rarity: 6 }],
      config: {
        layout: '243',
        desc: 'test',
        trading_stations_count: 2,
        manufacturing_stations_count: 4,
        product_requirements: {
          trading_stations: { lmd: 2 },
          manufacturing_stations: { pure_gold: 4 },
        },
      },
    }
    expect(requestSchemas.optimizationJob.safeParse({
      ...base,
      kind: 'schedule',
      includeUpgradeSuggestions: true,
      pricing_version: '2026-07-31-v1',
      accepted_max_points: '600.00',
    }).success).toBe(true)
    expect(requestSchemas.optimizationJob.safeParse({ ...base, kind: 'schedule' }).success).toBe(false)
    expect(requestSchemas.optimizationJob.safeParse({
      ...base,
      kind: 'upgrade_suggestions',
      upgradeTaskPayload: { tasks: [], baselineScore: 0 },
    }).success).toBe(false)
    expect(requestSchemas.optimizationJob.safeParse({
      ...base,
      kind: 'schedule',
      includeUpgradeSuggestions: false,
      historyResultId: 'legacy-history',
    }).success).toBe(false)
  })

  it('keeps the strict admin feature schema aligned with the shared feature contract', () => {
    expect(requestSchemas.adminFeatureSettings.safeParse({
      features: DEFAULT_SITE_FEATURES,
      expected_revision: 0,
    }).success).toBe(true)
    expect(requestSchemas.adminFeatureSettings.safeParse({
      features: Object.fromEntries(Object.entries(DEFAULT_SITE_FEATURES).filter(([key]) => key !== 'inventory')),
      expected_revision: 0,
    }).success).toBe(false)
    expect(requestSchemas.adminFeatureSettings.safeParse({
      features: { ...DEFAULT_SITE_FEATURES, unknown_feature: true },
      expected_revision: 0,
    }).success).toBe(false)
    expect(requestSchemas.adminFeatureSettings.safeParse({ features: DEFAULT_SITE_FEATURES }).success).toBe(false)
    expect(requestSchemas.adminFeatureSettings.safeParse({ features: DEFAULT_SITE_FEATURES, expected_revision: -1 }).success).toBe(false)
    expect(requestSchemas.adminFeatureSettings.safeParse({ features: DEFAULT_SITE_FEATURES, expected_revision: 1.5 }).success).toBe(false)
    expect(requestSchemas.adminFeatureSettings.safeParse({
      features: DEFAULT_SITE_FEATURES,
      expected_revision: 0,
      unknown_field: true,
    }).success).toBe(false)
  })

  it('requires a safe optimistic-lock revision for public content writes', () => {
    expect(requestSchemas.adminPublicContent.safeParse({
      ...DEFAULT_PUBLIC_CONTENT_DRAFT,
      expected_revision: 0,
    }).success).toBe(true)
    expect(requestSchemas.adminPublicContent.safeParse(DEFAULT_PUBLIC_CONTENT_DRAFT).success).toBe(false)
    expect(requestSchemas.adminPublicContent.safeParse({
      ...DEFAULT_PUBLIC_CONTENT_DRAFT,
      expected_revision: -1,
    }).success).toBe(false)
    expect(requestSchemas.adminPublicContent.safeParse({
      ...DEFAULT_PUBLIC_CONTENT_DRAFT,
      expected_revision: 1.5,
    }).success).toBe(false)
    expect(requestSchemas.adminPublicContent.safeParse({
      ...DEFAULT_PUBLIC_CONTENT_DRAFT,
      expected_revision: Number.MAX_SAFE_INTEGER + 1,
    }).success).toBe(false)
    expect(requestSchemas.adminPublicContent.safeParse({
      ...DEFAULT_PUBLIC_CONTENT_DRAFT,
      expected_revision: 0,
      unknown_field: true,
    }).success).toBe(false)
  })
})
