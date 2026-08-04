import assert from 'node:assert/strict'
import test from 'node:test'
import {
  confirmProductionRelease,
  readProductionReleaseConfiguration,
} from './confirm-production-release.mjs'

const token = 'release-confirmation-token-at-least-32-bytes'
const configuration = {
  publicAppUrl: 'https://example.test',
  token,
}

test('derives the deployed version from readiness and creates the release event', async () => {
  const { calls, fetchImpl } = queuedFetch([
    jsonResponse(200, readyBody('2.1.0', '2.1.0')),
    jsonResponse(201, { ok: true, created: true, event_id: 'release:2.1.0' }),
  ])

  const result = await confirmProductionRelease(configuration, {
    fetchImpl,
    sleepImpl: unexpectedSleep,
  })

  assert.deepEqual(result, {
    version: '2.1.0',
    created: true,
    eventId: 'release:2.1.0',
    status: 201,
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://example.test/api/health/ready')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[1].url, 'https://example.test/api/internal/releases/confirm')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.redirect, 'error')
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${token}`)
  assert.deepEqual(JSON.parse(calls[1].init.body), { version: '2.1.0' })
})

test('accepts an idempotent already-confirmed response', async () => {
  const { fetchImpl } = queuedFetch([
    jsonResponse(200, readyBody('2026.08.05', '2026.08.05')),
    jsonResponse(200, {
      ok: true,
      created: false,
      event_id: 'release:2026.08.05',
    }),
  ])

  const result = await confirmProductionRelease(configuration, {
    fetchImpl,
    sleepImpl: unexpectedSleep,
  })

  assert.equal(result.created, false)
  assert.equal(result.status, 200)
  assert.equal(result.version, '2026.08.05')
})

test('rejects missing configuration and non-production URLs', async () => {
  assert.throws(
    () => readProductionReleaseConfiguration({}),
    /PUBLIC_APP_URL is required/,
  )
  assert.throws(
    () => readProductionReleaseConfiguration({ PUBLIC_APP_URL: 'https://example.test' }),
    /WEBSITE_RELEASE_CONFIRMATION_TOKEN must contain at least 32 bytes/,
  )
  await assert.rejects(
    () => confirmProductionRelease({ publicAppUrl: 'http://example.test', token }),
    /PUBLIC_APP_URL must be an HTTPS origin/,
  )
  await assert.rejects(
    () => confirmProductionRelease({ publicAppUrl: 'https://example.test/application', token }),
    /PUBLIC_APP_URL must be an HTTPS origin/,
  )
})

test('stops before confirmation when deployed frontend and backend versions drift', async () => {
  const { calls, fetchImpl } = queuedFetch([
    jsonResponse(200, readyBody('9.8.7', '9.8.6')),
  ])

  await assert.rejects(
    () => confirmProductionRelease(configuration, {
      fetchImpl,
      sleepImpl: unexpectedSleep,
    }),
    /frontend version 9\.8\.7 does not match backend version 9\.8\.6/,
  )
  assert.equal(calls.length, 1)
})

test('reports a contract error without exposing response text or the token', async () => {
  const responseMessage = `do not log ${token}`
  const { fetchImpl } = queuedFetch([
    jsonResponse(200, readyBody('2.1.0', '2.1.0')),
    jsonResponse(409, {
      error: responseMessage,
      code: 'changelog_release_not_found',
    }),
  ])

  await assert.rejects(
    () => confirmProductionRelease(configuration, {
      fetchImpl,
      sleepImpl: unexpectedSleep,
    }),
    (error) => {
      assert.match(error.message, /HTTP 409, code=changelog_release_not_found/)
      assert.doesNotMatch(error.message, new RegExp(token))
      assert.doesNotMatch(error.message, /do not log/)
      return true
    },
  )
})

test('retries network errors, HTTP 429, and HTTP 5xx without leaking errors', async () => {
  const secretNetworkMessage = `network failed with ${token}`
  const { calls, fetchImpl } = queuedFetch([
    new TypeError(secretNetworkMessage),
    jsonResponse(429, { error: 'Rate limited', code: 'rate_limited' }, { 'Retry-After': '0' }),
    jsonResponse(200, readyBody('2.1.0+build.7', '2.1.0+build.7')),
    jsonResponse(503, { error: 'Unavailable', code: 'service_unavailable' }),
    jsonResponse(201, {
      ok: true,
      created: true,
      event_id: 'release:2.1.0+build.7',
    }),
  ])
  const delays = []

  const result = await confirmProductionRelease(configuration, {
    fetchImpl,
    sleepImpl: async (delay) => delays.push(delay),
  })

  assert.equal(result.version, '2.1.0+build.7')
  assert.equal(result.created, true)
  assert.equal(calls.length, 5)
  assert.deepEqual(delays, [2_000, 0, 2_000])
})

test('rejects malformed readiness and confirmation success responses', async () => {
  const malformedHealth = queuedFetch([
    jsonResponse(200, { ok: true, build_meta: { frontend_version: '', backend_version: '' } }),
  ])
  await assert.rejects(
    () => confirmProductionRelease(configuration, {
      fetchImpl: malformedHealth.fetchImpl,
      sleepImpl: unexpectedSleep,
    }),
    /invalid frontend version/,
  )

  const malformedConfirmation = queuedFetch([
    jsonResponse(200, readyBody('2.1.0', '2.1.0')),
    jsonResponse(201, { ok: true, created: false, event_id: 'release:2.1.0' }),
  ])
  await assert.rejects(
    () => confirmProductionRelease(configuration, {
      fetchImpl: malformedConfirmation.fetchImpl,
      sleepImpl: unexpectedSleep,
    }),
    /invalid success response/,
  )
})

function readyBody(frontendVersion, backendVersion) {
  return {
    ok: true,
    state: 'ready',
    build_meta: {
      frontend_version: frontendVersion,
      backend_version: backendVersion,
    },
    storage: { type: 'postgres', ok: true },
  }
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function queuedFetch(items) {
  const queue = [...items]
  const calls = []
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      const item = queue.shift()
      if (item instanceof Error) throw item
      assert(item, 'unexpected fetch call')
      return item
    },
  }
}

async function unexpectedSleep() {
  assert.fail('request should not have retried')
}
