import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const bundleDir = resolve('.cache/check-auth-security')

try {
  await mkdir(bundleDir, { recursive: true })
  const passwordModule = await bundleModule('server/security/password.ts', 'password')
  const rateLimitModule = await bundleModule('server/security/auth-rate-limit.ts', 'auth-rate-limit')
  const clientIpModule = await bundleModule('server/security/client-ip.ts', 'client-ip')

  await assertPasswordSecurity(passwordModule)
  assertSlidingWindowRateLimits(rateLimitModule)
  assertClientIpResolution(clientIpModule)
  await assertUserLoginRateLimits()
  await assertAdminAuthenticationRateLimits()

  console.log('[check-auth-security] async password work and authentication rate limits passed')
} finally {
  await rm(bundleDir, { recursive: true, force: true })
}

async function assertPasswordSecurity(passwordModule) {
  const password = 'compatibility-password'
  const salt = '00112233445566778899aabbccddeeff'
  const password_hash = pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('hex')
  const record = { password_hash, salt, iterations: 120_000 }

  assert.equal(await passwordModule.verifyPasswordHash(password, record), true, 'legacy password hash should verify')
  assert.equal(await passwordModule.verifyPasswordHash('wrong-password', record), false, 'wrong password should fail')

  const created = await passwordModule.createPasswordHash(password)
  assert.equal(created.iterations, 120_000, 'new password hash should preserve iteration count')
  assert.match(created.salt, /^[a-f0-9]{32}$/, 'new password salt should remain 16-byte hex')
  assert.match(created.password_hash, /^[a-f0-9]{64}$/, 'new password hash should remain 32-byte hex')
  assert.equal(await passwordModule.verifyPasswordHash(password, created), true, 'new password hash should verify')
  assert.equal(passwordModule.constantTimeSecretEqual('root-secret', 'root-secret'), true)
  assert.equal(passwordModule.constantTimeSecretEqual('root-secret', 'wrong-secret'), false)

  let timerRan = false
  const asynchronousVerification = passwordModule.verifyPasswordHash(password, record)
  setTimeout(() => {
    timerRan = true
  }, 0)
  await asynchronousVerification
  assert.equal(timerRan, true, 'PBKDF2 should not block the event loop timer phase')

  const jobs = Array.from({ length: 35 }, () => passwordModule.verifyPasswordHash(password, record))
  const results = await Promise.allSettled(jobs)
  const capacityFailures = results.filter((result) => (
    result.status === 'rejected' && result.reason?.name === 'PasswordWorkCapacityError'
  ))
  assert.equal(passwordModule.MAX_ACTIVE_PASSWORD_JOBS, 2)
  assert.equal(passwordModule.MAX_QUEUED_PASSWORD_JOBS, 32)
  assert.equal(capacityFailures.length, 1, 'the 35th concurrent password job should fail fast')
}

function assertSlidingWindowRateLimits(rateLimitModule) {
  let now = 0
  const limiter = new rateLimitModule.SlidingWindowRateLimiter({ now: () => now })
  const scopes = [
    { key: 'ip', limit: 20, windowMs: 15 * 60 * 1000 },
    { key: 'account', limit: 5, windowMs: 15 * 60 * 1000 },
  ]

  for (let index = 0; index < 5; index += 1) {
    const decision = limiter.reserve(scopes)
    assert.equal(decision.allowed, true)
    decision.attempt.retainFailure()
  }
  const accountBlocked = limiter.reserve(scopes)
  assert.equal(accountBlocked.allowed, false, 'sixth account failure should be blocked')
  assert.equal(accountBlocked.retryAfterSeconds, 900)

  now = 15 * 60 * 1000 + 1
  const afterWindow = limiter.reserve(scopes)
  assert.equal(afterWindow.allowed, true, 'expired failures should be removed from the sliding window')
  afterWindow.attempt.refund()

  for (let index = 0; index < 25; index += 1) {
    const decision = limiter.reserve([
      { key: 'successful-ip', limit: 20, windowMs: 15 * 60 * 1000 },
      { key: 'successful-account', limit: 5, windowMs: 15 * 60 * 1000 },
    ])
    assert.equal(decision.allowed, true, 'refunded successes should not consume the limit')
    decision.attempt.refund()
  }

  const capacityLimiter = new rateLimitModule.SlidingWindowRateLimiter({ maxEntries: 2, now: () => now })
  const fillsCapacity = capacityLimiter.reserve([
    { key: 'one', limit: 5, windowMs: 1_000 },
    { key: 'two', limit: 5, windowMs: 1_000 },
  ])
  assert.equal(fillsCapacity.allowed, true)
  fillsCapacity.attempt.retainFailure()
  const capacityBlocked = capacityLimiter.reserve([{ key: 'three', limit: 5, windowMs: 1_000 }])
  assert.deepEqual(capacityBlocked, { allowed: false, retryAfterSeconds: 60 })
}

function assertClientIpResolution(clientIpModule) {
  assert.equal(clientIpModule.resolveClientIp('127.0.0.1', '203.0.113.8'), '203.0.113.8')
  assert.equal(clientIpModule.resolveClientIp('::ffff:127.0.0.1', '2001:db8::8'), '2001:db8::8')
  assert.equal(clientIpModule.resolveClientIp('198.51.100.4', '203.0.113.8'), '198.51.100.4')
  assert.equal(clientIpModule.resolveClientIp('127.0.0.1', 'not-an-ip'), '127.0.0.1')
}

async function assertUserLoginRateLimits() {
  globalThis.__authSecurityLoginCalls = 0
  const authHandler = await bundleModule('server/handlers/auth.ts', 'auth-handler', [authHandlerPlugin()])

  for (let index = 0; index < 5; index += 1) {
    const response = await callLogin(authHandler.default, 'blocked@example.com', 'wrong-password', `198.51.100.${index + 1}`)
    assert.equal(response.status, 401)
  }
  const accountBlocked = await callLogin(authHandler.default, 'blocked@example.com', 'wrong-password', '198.51.100.10')
  assertRateLimitedResponse(accountBlocked, 'user account limit')
  assert.equal(globalThis.__authSecurityLoginCalls, 5, 'rate-limited account should skip login work')

  for (let index = 0; index < 20; index += 1) {
    const response = await callLogin(authHandler.default, `ip-${index}@example.com`, 'wrong-password', '203.0.113.20')
    assert.equal(response.status, 401)
  }
  const ipBlocked = await callLogin(authHandler.default, 'ip-final@example.com', 'wrong-password', '203.0.113.20')
  assertRateLimitedResponse(ipBlocked, 'user IP limit')

  for (let index = 0; index < 7; index += 1) {
    const response = await callLogin(authHandler.default, 'success@example.com', 'correct-password', '192.0.2.40')
    assert.equal(response.status, 200, 'successful logins should refund reservations')
  }
}

async function assertAdminAuthenticationRateLimits() {
  process.env.MAA_ADMIN_PASSWORD = 'root-admin-password'
  globalThis.__authSecurityAdminStore = new Map()
  globalThis.__authSecurityAdminGets = 0
  const adminAuth = await bundleModule('server/handlers/admin-auth.ts', 'admin-auth', [adminAuthPlugin()])
  const created = await adminAuth.createAdminUser('security_admin', 'correct-admin-password')
  assert.equal(created.ok, true)

  const successfulRequests = Array.from({ length: 5 }, (_, index) => adminRequest(
    'security_admin',
    'correct-admin-password',
    `198.51.100.${100 + index}`,
  ))
  const successfulResults = await Promise.all(successfulRequests.map((request) => (
    adminAuth.authenticateAdminRequest(request)
  )))
  assert(successfulResults.every((result) => result.ok), 'five concurrent valid admin requests should pass')

  for (let index = 0; index < 10; index += 1) {
    const result = await adminAuth.authenticateAdminRequest(adminRequest(
      'security_admin',
      'wrong-admin-password',
      `203.0.113.${100 + index}`,
    ))
    assert.equal(result.ok, false)
    assert.equal(result.response.status, 401)
  }
  const getsBeforeBlockedAttempt = globalThis.__authSecurityAdminGets
  const accountBlocked = await adminAuth.authenticateAdminRequest(adminRequest(
    'security_admin',
    'wrong-admin-password',
    '203.0.113.200',
  ))
  assert.equal(accountBlocked.ok, false)
  assertRateLimitedResponse(accountBlocked.response, 'admin account limit')
  assert.equal(globalThis.__authSecurityAdminGets, getsBeforeBlockedAttempt, 'blocked admin attempt should skip storage and PBKDF2')

  const rootIp = '192.0.2.90'
  for (let index = 0; index < 5; index += 1) {
    const result = await adminAuth.requireRootAdminPassword(rootRequest(rootIp), 'wrong-root-password')
    assert.equal(result.response.status, 401)
  }
  for (let index = 0; index < 5; index += 1) {
    const result = await adminAuth.authenticateAdminRequest(rootRequest(rootIp, 'wrong-root-password'))
    assert.equal(result.response.status, 401)
  }
  const rootBlocked = await adminAuth.requireRootAdminPassword(rootRequest(rootIp), 'wrong-root-password')
  assert.equal(rootBlocked.ok, false)
  assertRateLimitedResponse(rootBlocked.response, 'shared root authentication limit')
}

function callLogin(handler, email, password, clientIp) {
  return handler(new Request('http://local/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goofish-Client-IP': clientIp,
    },
    body: JSON.stringify({ email, password }),
  }))
}

function adminRequest(username, password, clientIp) {
  return new Request('http://local/api/admin/test', {
    headers: {
      'X-Admin-User': username,
      'X-Admin-Password': password,
      'X-Goofish-Client-IP': clientIp,
    },
  })
}

function rootRequest(clientIp, password) {
  return new Request('http://local/api/admin/test', {
    headers: {
      ...(password ? { 'X-Admin-Password': password } : {}),
      'X-Goofish-Client-IP': clientIp,
    },
  })
}

function assertRateLimitedResponse(response, label) {
  assert.equal(response.status, 429, `${label} should return 429`)
  assert(Number(response.headers.get('Retry-After')) >= 1, `${label} should include Retry-After`)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
}

function authHandlerPlugin() {
  return {
    name: 'auth-security-handler-mocks',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])user-auth(\.ts)?$/ }, () => ({
        path: 'user-auth',
        namespace: 'auth-security',
      }))
      build.onResolve({ filter: /(^|[\\/])usage-stats(\.ts)?$/ }, () => ({
        path: 'usage-stats',
        namespace: 'auth-security',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auth-security' }, (args) => ({
        contents: args.path === 'usage-stats' ? usageStatsMock() : userAuthMock(),
        loader: 'js',
      }))
    },
  }
}

function adminAuthPlugin() {
  return {
    name: 'auth-security-admin-mocks',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])admin-user-store(\.ts)?$/ }, () => ({
        path: 'admin-user-store',
        namespace: 'auth-security',
      }))
      build.onResolve({ filter: /(^|[\\/])license-utils(\.ts)?$/ }, () => ({
        path: 'license-utils',
        namespace: 'auth-security',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auth-security' }, (args) => ({
        contents: args.path === 'license-utils' ? licenseUtilsMock() : adminUserStoreMock(),
        loader: 'js',
      }))
    },
  }
}

function userAuthMock() {
  return `
    export function jsonResponse(body, status = 200, headers = {}) {
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { ...(status === 204 ? {} : { 'Content-Type': 'application/json' }), ...headers },
      })
    }
    export function normalizeEmail(value) {
      if (typeof value !== 'string') return null
      const email = value.trim().toLowerCase()
      return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) && email.length <= 254 ? email : null
    }
    export async function loginUser(email, password) {
      globalThis.__authSecurityLoginCalls += 1
      if (password !== 'correct-password') return { ok: false, status: 401, message: 'Invalid email or password.' }
      return { ok: true, user: { id: 'user-1', email }, cookie: 'maa_session=test' }
    }
    export async function buildAuthPayload(user) { return { user } }
    export async function registerUser() { return { ok: false, status: 400, message: 'unused' } }
    export async function logoutRequest() {}
    export async function requestPasswordReset() { return { ok: true } }
    export async function resetPasswordWithToken() { return { ok: false, status: 400, message: 'unused' } }
    export async function changeUserPassword() { return { ok: false, status: 400, message: 'unused' } }
    export async function requireUserSession() { return null }
    export function clearSessionCookie() { return '' }
  `
}

function usageStatsMock() {
  return 'export async function recordUsageEvent() {}'
}

function adminUserStoreMock() {
  return `
    export function createPostgresAdminUserStore() {
      return {
        get: async (username) => {
          globalThis.__authSecurityAdminGets += 1
          return globalThis.__authSecurityAdminStore.get(username) ?? null
        },
        set: async (username, user) => globalThis.__authSecurityAdminStore.set(username, user),
        delete: async (username) => globalThis.__authSecurityAdminStore.delete(username),
        list: async () => [...globalThis.__authSecurityAdminStore.values()],
      }
    }
  `
}

function licenseUtilsMock() {
  return `
    export function requireEnv(name) {
      const value = process.env[name]
      if (!value) throw new Error(name + ' not configured')
      return value
    }
    export function jsonResponse(body, status = 200, headers = {}) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      })
    }
  `
}

async function bundleModule(entryPoint, name, plugins = []) {
  const outputPath = resolve(bundleDir, `${name}.mjs`)
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    write: false,
    plugins,
    logLevel: 'silent',
  })
  const bundledCode = result.outputFiles[0]?.text
  if (!bundledCode) throw new Error(`Failed to bundle ${entryPoint}`)
  await writeFile(outputPath, bundledCode, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`)
}
