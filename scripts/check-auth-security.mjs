import assert from 'node:assert/strict'
import { Algorithm, Version, hash as argon2Hash } from '@node-rs/argon2'
import { pbkdf2Sync } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  await assertUserPasswordMigration(passwordModule)
  await assertUserLoginRateLimits()
  await assertAdminAuthenticationRateLimits()
  await assertNoBrowserReadableAdminPasswords()

  console.log('[check-auth-security] async password work and authentication rate limits passed')
} finally {
  await rm(bundleDir, { recursive: true, force: true })
}

async function assertPasswordSecurity(passwordModule) {
  const password = 'compatibility-password'
  const salt = '00112233445566778899aabbccddeeff'
  const password_hash = pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('hex')
  const record = { password_hash, salt, iterations: 120_000 }

  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, record),
    { verified: true, needsRehash: true },
    'legacy password hash should verify and request migration',
  )
  assert.deepEqual(
    await passwordModule.verifyPasswordHash('wrong-password', record),
    { verified: false, needsRehash: false },
    'wrong legacy password should fail',
  )

  const created = await passwordModule.createPasswordHash(password)
  assert.equal(created.password_algorithm, 'argon2id')
  assert.equal(created.iterations, 2, 'compatibility iteration column should store Argon2 time cost')
  assert.match(created.salt, /^[a-f0-9]{32}$/, 'new password salt should remain 16-byte hex')
  assert.match(
    created.password_hash,
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
    'new password hash should use the configured Argon2id PHC format',
  )
  const createdPhcParts = created.password_hash.split('$')
  assert.equal(Buffer.from(createdPhcParts[4], 'base64').length, 16, 'Argon2id PHC salt should be 16 bytes')
  assert.equal(Buffer.from(createdPhcParts[5], 'base64').length, 32, 'Argon2id output should be 32 bytes')
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, created),
    { verified: true, needsRehash: false },
    'current Argon2id password hash should verify without rehash',
  )
  const { password_algorithm: _algorithm, ...argonWithoutAlgorithmMetadata } = created
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, argonWithoutAlgorithmMetadata),
    { verified: true, needsRehash: true },
    'Argon2id records missing algorithm metadata should request rehash',
  )
  assert.deepEqual(
    await passwordModule.verifyPasswordHash('wrong-password', created),
    { verified: false, needsRehash: false },
    'wrong Argon2id password should fail',
  )

  const outdatedSalt = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex')
  const outdatedHash = await argon2Hash(password, {
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
    memoryCost: 4096,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
    salt: outdatedSalt,
  })
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, {
      password_hash: outdatedHash,
      salt: outdatedSalt.toString('hex'),
      iterations: 3,
      password_algorithm: 'argon2id',
    }),
    { verified: true, needsRehash: true },
    'outdated Argon2id parameters should request rehash',
  )
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, {
      password_hash: '$argon2id$invalid',
      salt: created.salt,
      iterations: 2,
      password_algorithm: 'argon2id',
    }),
    { verified: false, needsRehash: false },
    'malformed Argon2id hashes should fail closed',
  )
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, {
      password_hash: created.password_hash,
      salt: created.salt,
      iterations: 2,
      password_algorithm: 'unknown-algorithm',
    }),
    { verified: false, needsRehash: false },
    'unknown algorithms should fail closed',
  )
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, {
      password_hash: null,
      salt: null,
      iterations: 2,
    }),
    { verified: false, needsRehash: false },
    'non-string password metadata should fail closed',
  )
  assert.equal(passwordModule.constantTimeSecretEqual('root-secret', 'root-secret'), true)
  assert.equal(passwordModule.constantTimeSecretEqual('root-secret', 'wrong-secret'), false)

  let completedPasswordJobs = 0
  let timerObservedPendingPasswordWork = false
  const jobs = Array.from({ length: 35 }, () => (
    passwordModule.createPasswordHash(password).then((value) => {
      completedPasswordJobs += 1
      return value
    })
  ))
  const resultsPromise = Promise.allSettled(jobs)
  await new Promise((resolveTimer) => {
    setTimeout(() => {
      timerObservedPendingPasswordWork = completedPasswordJobs < 34
      resolveTimer()
    }, 0)
  })
  const results = await resultsPromise
  const capacityFailures = results.filter((result) => (
    result.status === 'rejected' && result.reason?.name === 'PasswordWorkCapacityError'
  ))
  assert.equal(timerObservedPendingPasswordWork, true, 'Argon2id should not block the event loop timer phase')
  assert.equal(passwordModule.MAX_ACTIVE_PASSWORD_JOBS, 2)
  assert.equal(passwordModule.MAX_QUEUED_PASSWORD_JOBS, 32)
  assert.equal(capacityFailures.length, 1, 'the 35th concurrent password job should fail fast')
}

async function assertUserPasswordMigration(passwordModule) {
  globalThis.__authSecurityUsers = new Map()
  globalThis.__authSecurityUserUpgradeCalls = 0
  globalThis.__authSecurityUserUpgradeModes = new Map()
  globalThis.__authSecuritySessions = []
  const userAuth = await bundleInlineModule(
    "export { loginUser } from './server/handlers/user-auth.ts'",
    'user-auth-migration',
    [userAuthMigrationPlugin()],
  )
  const password = 'legacy-user-password'

  const migratedUser = legacyUserRecord('migrated@example.com', password)
  globalThis.__authSecurityUsers.set(migratedUser.email, migratedUser)
  const migrated = await userAuth.loginUser(migratedUser.email, password)
  assert.equal(migrated.ok, true, 'legacy user should still be able to log in')
  const upgradedUser = globalThis.__authSecurityUsers.get(migratedUser.email)
  assert.equal(upgradedUser.password_algorithm, 'argon2id')
  assert.match(upgradedUser.password_hash, /^\$argon2id\$/)
  assert.deepEqual(
    await passwordModule.verifyPasswordHash(password, upgradedUser),
    { verified: true, needsRehash: false },
    'migrated user password should use current Argon2id parameters',
  )

  const wrongPasswordUser = legacyUserRecord('wrong-password@example.com', password)
  globalThis.__authSecurityUsers.set(wrongPasswordUser.email, wrongPasswordUser)
  const upgradesBeforeWrongPassword = globalThis.__authSecurityUserUpgradeCalls
  const rejected = await userAuth.loginUser(wrongPasswordUser.email, 'incorrect-password')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.status, 401)
  assert.equal(
    globalThis.__authSecurityUserUpgradeCalls,
    upgradesBeforeWrongPassword,
    'wrong user password should not attempt an upgrade',
  )

  const conflictUser = legacyUserRecord('conflict@example.com', password)
  globalThis.__authSecurityUsers.set(conflictUser.email, conflictUser)
  globalThis.__authSecurityUserUpgradeModes.set(conflictUser.id, 'conflict')
  const conflictLogin = await userAuth.loginUser(conflictUser.email, password)
  assert.equal(conflictLogin.ok, true, 'conditional user upgrade conflicts should not block login')
  assert.equal(
    globalThis.__authSecurityUsers.get(conflictUser.email).password_hash,
    'concurrently-updated-password-hash',
    'conditional user upgrade should not overwrite a concurrent password change',
  )

  const failingUser = legacyUserRecord('upgrade-failure@example.com', password)
  globalThis.__authSecurityUsers.set(failingUser.email, failingUser)
  globalThis.__authSecurityUserUpgradeModes.set(failingUser.id, 'failure')
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    const failureLogin = await userAuth.loginUser(failingUser.email, password)
    assert.equal(failureLogin.ok, true, 'user upgrade failures should not block verified login')
  } finally {
    console.warn = originalWarn
  }
  assert.deepEqual(warnings, [['user password hash upgrade skipped:', 'Error']])
  assert.equal(
    JSON.stringify(warnings).includes(failingUser.email),
    false,
    'user upgrade warnings should not include account identifiers',
  )
  assert.equal(
    JSON.stringify(warnings).includes(password),
    false,
    'user upgrade warnings should not include passwords',
  )
}

function legacyUserRecord(email, password) {
  const salt = '00112233445566778899aabbccddeeff'
  return {
    version: 1,
    id: `user-${email}`,
    email,
    password_hash: pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('hex'),
    salt,
    iterations: 120_000,
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
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
  globalThis.__authSecurityAdminSessions = new Map()
  globalThis.__authSecurityAdminGets = 0
  globalThis.__authSecurityAdminUpgradeModes = new Map()
  const adminAuth = await bundleModule('server/handlers/admin-auth.ts', 'admin-auth', [adminAuthPlugin()])
  const adminSessionHandler = await bundleModule('server/handlers/admin-session.ts', 'admin-session', [adminAuthPlugin()])
  const created = await adminAuth.createAdminUser('security_admin', 'correct-admin-password')
  assert.equal(created.ok, true)

  const loginTime = new Date('2026-07-10T00:00:00.000Z')
  const login = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.70'),
    'security_admin',
    'correct-admin-password',
    loginTime,
  )
  assert.equal(login.ok, true)
  assert.match(login.cookie, /^maa_admin_session=[A-Za-z0-9_-]{43};/)
  assert.match(login.cookie, /; HttpOnly/)
  assert.match(login.cookie, /; SameSite=Strict/)
  assert.match(login.cookie, /; Path=\/api\/admin/)
  assert.doesNotMatch(login.cookie, /Max-Age|Expires=/i, 'admin session cookie should close with the browser')
  assert.doesNotMatch(login.cookie, /; Secure/, 'development admin cookie should work over HTTP')
  const sessionToken = adminCookieToken(login.cookie)
  assert.equal(Buffer.from(sessionToken, 'base64url').length, 32)
  const storedSessions = [...globalThis.__authSecurityAdminSessions.values()]
  assert.equal(storedSessions.length, 1)
  assert.match(storedSessions[0].token_hash, /^[a-f0-9]{64}$/)
  assert.equal(storedSessions[0].token_hash === sessionToken, false)
  assert.equal(JSON.stringify(storedSessions).includes(sessionToken), false, 'raw admin token must not be stored')

  const getsBeforeSessionRequests = globalThis.__authSecurityAdminGets
  const successfulRequests = Array.from({ length: 5 }, () => adminSessionRequest(login.cookie))
  const successfulResults = await Promise.all(successfulRequests.map((request) => (
    adminAuth.authenticateAdminRequest(request, new Date('2026-07-10T00:01:00.000Z'))
  )))
  assert(successfulResults.every((result) => result.ok && result.username === 'security_admin'))
  assert.equal(
    globalThis.__authSecurityAdminGets,
    getsBeforeSessionRequests,
    'authenticated admin requests should not query password records',
  )

  const legacyHeaders = await adminAuth.authenticateAdminRequest(adminLegacyHeaderRequest(
    'security_admin',
    'correct-admin-password',
  ))
  assert.equal(legacyHeaders.ok, false)
  assert.equal(legacyHeaders.response.status, 401, 'legacy password headers must not authenticate')
  const legacyBody = await adminAuth.authenticateAdminRequest(new Request('http://local/api/admin/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      admin_user: 'security_admin',
      admin_password: 'correct-admin-password',
    }),
  }))
  assert.equal(legacyBody.ok, false)
  assert.equal(legacyBody.response.status, 401, 'legacy password body fields must not authenticate')

  const malformedCookie = await adminAuth.authenticateAdminRequest(new Request('http://local/api/admin/test', {
    headers: { Cookie: 'maa_admin_session=not-a-valid-token' },
  }))
  assert.equal(malformedCookie.ok, false)
  assert.match(malformedCookie.response.headers.get('Set-Cookie') ?? '', /Max-Age=0/)

  const crossOrigin = await adminAuth.authenticateAdminRequest(adminSessionRequest(login.cookie, {
    method: 'PATCH',
    origin: 'https://attacker.example',
  }))
  assert.equal(crossOrigin.ok, false)
  assert.equal(crossOrigin.response.status, 403)
  const sameOrigin = await adminAuth.authenticateAdminRequest(adminSessionRequest(login.cookie, {
    method: 'PATCH',
    origin: 'http://local',
  }), new Date('2026-07-10T00:02:00.000Z'))
  assert.equal(sameOrigin.ok, true)

  const idleBoundaryLogin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.71'),
    'security_admin',
    'correct-admin-password',
    loginTime,
  )
  assert.equal(idleBoundaryLogin.ok, true)
  const justBeforeIdleExpiry = await adminAuth.authenticateAdminRequest(
    adminSessionRequest(idleBoundaryLogin.cookie),
    new Date(loginTime.getTime() + adminAuth.ADMIN_SESSION_IDLE_MS - 1),
  )
  assert.equal(justBeforeIdleExpiry.ok, true, 'admin session should work just before idle expiry')

  const idleExpiredLogin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.72'),
    'security_admin',
    'correct-admin-password',
    loginTime,
  )
  assert.equal(idleExpiredLogin.ok, true)
  const idleExpired = await adminAuth.authenticateAdminRequest(
    adminSessionRequest(idleExpiredLogin.cookie),
    new Date(loginTime.getTime() + adminAuth.ADMIN_SESSION_IDLE_MS),
  )
  assert.equal(idleExpired.ok, false)
  assert.equal(idleExpired.response.status, 401)
  assert.match(idleExpired.response.headers.get('Set-Cookie') ?? '', /Max-Age=0/)

  const absoluteLogin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.73'),
    'security_admin',
    'correct-admin-password',
    loginTime,
  )
  assert.equal(absoluteLogin.ok, true)
  for (
    let elapsed = 29 * 60 * 1000;
    elapsed < adminAuth.ADMIN_SESSION_ABSOLUTE_MS;
    elapsed += 29 * 60 * 1000
  ) {
    const active = await adminAuth.authenticateAdminRequest(
      adminSessionRequest(absoluteLogin.cookie),
      new Date(loginTime.getTime() + elapsed),
    )
    assert.equal(active.ok, true, 'activity should keep the idle window alive before absolute expiry')
  }
  const absoluteExpired = await adminAuth.authenticateAdminRequest(
    adminSessionRequest(absoluteLogin.cookie),
    new Date(loginTime.getTime() + adminAuth.ADMIN_SESSION_ABSOLUTE_MS),
  )
  assert.equal(absoluteExpired.ok, false, 'absolute expiry must never be extended')

  const productionMode = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const secureLogin = await adminAuth.loginAdminRequest(
      adminLoginRequest('198.51.100.74'),
      'security_admin',
      'correct-admin-password',
      loginTime,
    )
    assert.equal(secureLogin.ok, true)
    assert.match(secureLogin.cookie, /; Secure/)
  } finally {
    if (productionMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = productionMode
  }

  const legacyPassword = 'legacy-admin-password'
  const legacyAdmin = legacyAdminRecord('legacy_admin', legacyPassword)
  globalThis.__authSecurityAdminStore.set(legacyAdmin.username, legacyAdmin)
  const migratedAdmin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.80'),
    legacyAdmin.username,
    legacyPassword,
    loginTime,
  )
  assert.equal(migratedAdmin.ok, true, 'legacy administrator should still authenticate')
  assert.equal(
    globalThis.__authSecurityAdminStore.get(legacyAdmin.username).password_algorithm,
    'argon2id',
    'legacy administrator should be upgraded after successful authentication',
  )
  assert.equal(
    (await adminAuth.authenticateAdminRequest(adminSessionRequest(migratedAdmin.cookie), loginTime)).ok,
    true,
    'Argon2id rehash should not revoke the newly created admin session',
  )

  const conflictAdmin = legacyAdminRecord('conflict_admin', legacyPassword)
  globalThis.__authSecurityAdminStore.set(conflictAdmin.username, conflictAdmin)
  globalThis.__authSecurityAdminUpgradeModes.set(conflictAdmin.username, 'conflict')
  const conflictAuthentication = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.81'),
    conflictAdmin.username,
    legacyPassword,
    loginTime,
  )
  assert.equal(conflictAuthentication.ok, true, 'admin upgrade conflicts should not block authentication')
  assert.equal(
    globalThis.__authSecurityAdminStore.get(conflictAdmin.username).password_hash,
    'concurrently-updated-admin-password-hash',
    'conditional admin upgrade should not overwrite a concurrent password change',
  )

  const failingAdmin = legacyAdminRecord('failing_admin', legacyPassword)
  globalThis.__authSecurityAdminStore.set(failingAdmin.username, failingAdmin)
  globalThis.__authSecurityAdminUpgradeModes.set(failingAdmin.username, 'failure')
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    const failureAuthentication = await adminAuth.loginAdminRequest(
      adminLoginRequest('198.51.100.82'),
      failingAdmin.username,
      legacyPassword,
      loginTime,
    )
    assert.equal(failureAuthentication.ok, true, 'admin upgrade failures should not block authentication')
  } finally {
    console.warn = originalWarn
  }
  assert.deepEqual(warnings, [['admin password hash upgrade skipped:', 'Error']])
  assert.equal(JSON.stringify(warnings).includes(failingAdmin.username), false)
  assert.equal(JSON.stringify(warnings).includes(legacyPassword), false)

  for (let index = 0; index < 10; index += 1) {
    const result = await adminAuth.loginAdminRequest(
      adminLoginRequest(`203.0.113.${100 + index}`),
      'blocked_admin',
      'wrong-admin-password',
    )
    assert.equal(result.ok, false)
    assert.equal(result.response.status, 401)
  }
  const getsBeforeBlockedAttempt = globalThis.__authSecurityAdminGets
  const accountBlocked = await adminAuth.loginAdminRequest(
    adminLoginRequest('203.0.113.200'),
    'blocked_admin',
    'wrong-admin-password',
  )
  assert.equal(accountBlocked.ok, false)
  assertRateLimitedResponse(accountBlocked.response, 'admin account limit')
  assert.equal(globalThis.__authSecurityAdminGets, getsBeforeBlockedAttempt, 'blocked admin attempt should skip storage and password work')

  const rootIp = '192.0.2.90'
  for (let index = 0; index < 10; index += 1) {
    const result = await adminAuth.requireRootAdminPassword(rootRequest(rootIp), 'wrong-root-password')
    assert.equal(result.response.status, 401)
  }
  const rootBlocked = await adminAuth.requireRootAdminPassword(rootRequest(rootIp), 'wrong-root-password')
  assert.equal(rootBlocked.ok, false)
  assertRateLimitedResponse(rootBlocked.response, 'shared root authentication limit')

  const logoutLogin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.75'),
    'security_admin',
    'correct-admin-password',
  )
  assert.equal(logoutLogin.ok, true)
  const logout = await adminAuth.logoutAdminRequest(adminSessionRequest(logoutLogin.cookie, { method: 'DELETE' }))
  assert.equal(logout.ok, true)
  assert.match(logout.cookie, /Max-Age=0/)
  assert.equal(
    (await adminAuth.authenticateAdminRequest(adminSessionRequest(logoutLogin.cookie))).ok,
    false,
    'logout should revoke the current session',
  )

  const replacedLogin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.76'),
    'security_admin',
    'correct-admin-password',
  )
  assert.equal(replacedLogin.ok, true)
  assert.equal((await adminAuth.createAdminUser('security_admin', 'replacement-password')).ok, true)
  assert.equal(
    (await adminAuth.authenticateAdminRequest(adminSessionRequest(replacedLogin.cookie))).ok,
    false,
    'replacing an admin password should revoke existing sessions',
  )

  const deleteCreated = await adminAuth.createAdminUser('delete_admin', 'delete-admin-password')
  assert.equal(deleteCreated.ok, true)
  const deleteLogin = await adminAuth.loginAdminRequest(
    adminLoginRequest('198.51.100.77'),
    'delete_admin',
    'delete-admin-password',
  )
  assert.equal(deleteLogin.ok, true)
  assert.equal((await adminAuth.deleteAdminUser('delete_admin')).ok, true)
  assert.equal(
    (await adminAuth.authenticateAdminRequest(adminSessionRequest(deleteLogin.cookie))).ok,
    false,
    'deleting an admin should revoke existing sessions',
  )

  const handlerLoginResponse = await adminSessionHandler.default(new Request('http://local/api/admin/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goofish-Client-IP': '192.0.2.100',
    },
    body: JSON.stringify({ username: 'security_admin', password: 'replacement-password' }),
  }))
  assert.equal(handlerLoginResponse.status, 200)
  assert.equal(handlerLoginResponse.headers.get('Cache-Control'), 'no-store')
  const handlerCookie = handlerLoginResponse.headers.get('Set-Cookie')
  assert(handlerCookie)
  const handlerSessionResponse = await adminSessionHandler.default(adminSessionRequest(handlerCookie))
  assert.equal(handlerSessionResponse.status, 200)
  const handlerLogoutResponse = await adminSessionHandler.default(adminSessionRequest(handlerCookie, { method: 'DELETE' }))
  assert.equal(handlerLogoutResponse.status, 200)
  assert.match(handlerLogoutResponse.headers.get('Set-Cookie') ?? '', /Max-Age=0/)
  const handlerMethodResponse = await adminSessionHandler.default(adminSessionRequest('', { method: 'PUT' }))
  assert.equal(handlerMethodResponse.status, 405)
  const idempotentLogout = await adminSessionHandler.default(adminSessionRequest('', { method: 'DELETE' }))
  assert.equal(idempotentLogout.status, 200)

  for (let index = 0; index < 10; index += 1) {
    const wrongPassword = await callAdminSessionLoginHandler(
      adminSessionHandler.default,
      'handler_blocked',
      'wrong-password',
      `192.0.2.${120 + index}`,
    )
    assert.equal(wrongPassword.status, 401)
  }
  const handlerRateLimited = await callAdminSessionLoginHandler(
    adminSessionHandler.default,
    'handler_blocked',
    'wrong-password',
    '192.0.2.140',
  )
  assertRateLimitedResponse(handlerRateLimited, 'admin session handler account limit')
}

function legacyAdminRecord(username, password) {
  const salt = 'ffeeddccbbaa99887766554433221100'
  return {
    version: 1,
    username,
    password_hash: pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('hex'),
    salt,
    iterations: 120_000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
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

function adminLoginRequest(clientIp) {
  return new Request('http://local/api/admin/session', {
    method: 'POST',
    headers: { 'X-Goofish-Client-IP': clientIp },
  })
}

function callAdminSessionLoginHandler(handler, username, password, clientIp) {
  return handler(new Request('http://local/api/admin/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goofish-Client-IP': clientIp,
    },
    body: JSON.stringify({ username, password }),
  }))
}

function adminSessionRequest(cookie, options = {}) {
  const headers = new Headers()
  if (cookie) headers.set('Cookie', cookie.split(';', 1)[0])
  if (options.origin) headers.set('Origin', options.origin)
  return new Request('http://local/api/admin/test', {
    method: options.method ?? 'GET',
    headers,
  })
}

function adminLegacyHeaderRequest(username, password) {
  return new Request('http://local/api/admin/test', {
    headers: {
      'X-Admin-User': username,
      'X-Admin-Password': password,
    },
  })
}

function adminCookieToken(cookie) {
  const value = /^maa_admin_session=([^;]+)/.exec(cookie)?.[1]
  assert(value, 'admin session cookie should contain a token')
  return decodeURIComponent(value)
}

function rootRequest(clientIp) {
  return new Request('http://local/api/admin/test', {
    method: 'POST',
    headers: { 'X-Goofish-Client-IP': clientIp },
  })
}

function assertRateLimitedResponse(response, label) {
  assert.equal(response.status, 429, `${label} should return 429`)
  assert(Number(response.headers.get('Retry-After')) >= 1, `${label} should include Retry-After`)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
}

async function assertNoBrowserReadableAdminPasswords() {
  const adminPage = await readFile('src/pages/AdminPage.tsx', 'utf8')
  const adminSetupPage = await readFile('src/pages/AdminSetupPage.tsx', 'utf8')
  const adminClient = await readFile('src/lib/admin-api-client.ts', 'utf8')
  const productionAdminSources = `${adminPage}\n${adminSetupPage}\n${adminClient}`

  assert.equal(productionAdminSources.includes('maa-admin-credentials'), false)
  assert.equal(productionAdminSources.includes('X-Admin-Password'), false)
  assert.equal(productionAdminSources.includes('X-Admin-User'), false)
  assert.equal(/\badmin_password\b/.test(productionAdminSources), false)
  assert.equal(/\badmin_user\b/.test(productionAdminSources), false)
  assert.equal(/sessionStorage\.(?:getItem|setItem)/.test(productionAdminSources), false)
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
      build.onResolve({ filter: /(^|[\\/])admin-session-store(\.ts)?$/ }, () => ({
        path: 'admin-session-store',
        namespace: 'auth-security',
      }))
      build.onResolve({ filter: /(^|[\\/])license-utils(\.ts)?$/ }, () => ({
        path: 'license-utils',
        namespace: 'auth-security',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auth-security' }, (args) => ({
        contents: args.path === 'license-utils'
          ? licenseUtilsMock()
          : args.path === 'admin-session-store'
            ? adminSessionStoreMock()
            : adminUserStoreMock(),
        loader: 'js',
      }))
    },
  }
}

function userAuthMigrationPlugin() {
  return {
    name: 'auth-security-user-migration-mocks',
    setup(build) {
      for (const moduleName of ['user-store', 'announcement-store', 'license-utils', 'email']) {
        build.onResolve({ filter: new RegExp(`(^|[\\\\/])${moduleName}(\\.ts)?$`) }, () => ({
          path: moduleName,
          namespace: 'auth-security-user-migration',
        }))
      }
      build.onLoad({ filter: /.*/, namespace: 'auth-security-user-migration' }, (args) => {
        const mocks = {
          'user-store': userStoreMigrationMock(),
          'announcement-store': announcementStoreMock(),
          'license-utils': userLicenseUtilsMock(),
          email: emailMock(),
        }
        return { contents: mocks[args.path], loader: 'js' }
      })
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
        set: async (username, user) => {
          globalThis.__authSecurityAdminStore.set(username, user)
          for (const [tokenHash, session] of globalThis.__authSecurityAdminSessions) {
            if (session.username === username) globalThis.__authSecurityAdminSessions.delete(tokenHash)
          }
        },
        upgradePasswordHash: async (username, expectedPasswordHash, replacement) => {
          const current = globalThis.__authSecurityAdminStore.get(username)
          const mode = globalThis.__authSecurityAdminUpgradeModes.get(username)
          if (mode === 'conflict' && current) {
            globalThis.__authSecurityAdminStore.set(username, {
              ...current,
              password_hash: 'concurrently-updated-admin-password-hash',
            })
          }
          if (mode === 'failure') throw new Error('sensitive admin migration detail')
          const latest = globalThis.__authSecurityAdminStore.get(username)
          if (!latest || latest.password_hash !== expectedPasswordHash) return null
          const updated = {
            ...latest,
            ...replacement,
            updated_at: new Date().toISOString(),
          }
          globalThis.__authSecurityAdminStore.set(username, updated)
          return updated
        },
        delete: async (username) => {
          globalThis.__authSecurityAdminStore.delete(username)
          for (const [tokenHash, session] of globalThis.__authSecurityAdminSessions) {
            if (session.username === username) globalThis.__authSecurityAdminSessions.delete(tokenHash)
          }
        },
        list: async () => [...globalThis.__authSecurityAdminStore.values()],
      }
    }
  `
}

function adminSessionStoreMock() {
  return `
    export function createPostgresAdminSessionStore() {
      return {
        save: async (session) => globalThis.__authSecurityAdminSessions.set(session.token_hash, session),
        authenticateAndTouch: async (tokenHash, now, idleCutoff) => {
          const session = globalThis.__authSecurityAdminSessions.get(tokenHash)
          if (!session || session.expires_at <= now || session.last_seen_at <= idleCutoff) {
            globalThis.__authSecurityAdminSessions.delete(tokenHash)
            return null
          }
          const updated = { ...session, last_seen_at: now }
          globalThis.__authSecurityAdminSessions.set(tokenHash, updated)
          return updated
        },
        deleteByTokenHash: async (tokenHash) => globalThis.__authSecurityAdminSessions.delete(tokenHash),
        deleteExpired: async (now, idleCutoff) => {
          for (const [tokenHash, session] of globalThis.__authSecurityAdminSessions) {
            if (session.expires_at <= now || session.last_seen_at <= idleCutoff) {
              globalThis.__authSecurityAdminSessions.delete(tokenHash)
            }
          }
        },
      }
    }
  `
}

function userStoreMigrationMock() {
  return `
    export async function getUserByEmail(email) {
      return globalThis.__authSecurityUsers.get(email) ?? null
    }
    export async function upgradeUserPasswordHash(userId, expectedPasswordHash, replacement) {
      globalThis.__authSecurityUserUpgradeCalls += 1
      const entry = [...globalThis.__authSecurityUsers.entries()].find(([, user]) => user.id === userId)
      if (!entry) return null
      const [email, current] = entry
      const mode = globalThis.__authSecurityUserUpgradeModes.get(userId)
      if (mode === 'conflict') {
        globalThis.__authSecurityUsers.set(email, {
          ...current,
          password_hash: 'concurrently-updated-password-hash',
        })
      }
      if (mode === 'failure') throw new Error('sensitive user migration detail')
      const latest = globalThis.__authSecurityUsers.get(email)
      if (!latest || latest.password_hash !== expectedPasswordHash) return null
      const updated = {
        ...latest,
        ...replacement,
        updated_at: new Date().toISOString(),
      }
      globalThis.__authSecurityUsers.set(email, updated)
      return updated
    }
    export async function migrateLegacyUserIfNeeded() {}
    export async function saveUserSession(session) {
      globalThis.__authSecuritySessions.push(session)
    }
    export async function deleteSessionByTokenHash() {}
    export async function deleteSessionsForUser() {}
    export async function deleteUserAccount() {}
    export function emptyWorkspace() { return null }
    export async function getAnnouncementReads() { return [] }
    export async function getPasswordResetTokenByHash() { return null }
    export async function getProfileForUser() { return null }
    export async function getProfileWorkspace() { return null }
    export async function getRecentPasswordResetTokenForUser() { return null }
    export async function getSessionByTokenHash() { return null }
    export async function getUserById() { return null }
    export async function listProfilesForUser() { return [] }
    export async function markPasswordResetTokenUsed() {}
    export async function markAnnouncementRead() {}
    export async function savePasswordResetToken() {}
    export async function saveProfileWorkspace() {}
    export async function saveUserAccount() {}
    export async function saveUserProfile() {}
    export function isFreePreviewProfile() { return false }
    export function toPublicProfile(value) { return value }
    export function toPublicWorkspace(value) { return value }
    export async function touchSession() {}
  `
}

function announcementStoreMock() {
  return 'export function createPostgresAnnouncementStore() { return { get: async () => null } }'
}

function userLicenseUtilsMock() {
  return `
    export function getCdkRecordStore() { return { get: async () => null } }
    export function hashCdk(value) { return value }
    export function normalizeCode(value) { return value }
    export function normalizePermissionMode(value) { return value }
    export function requireEnv(name) { return process.env[name] ?? '' }
  `
}

function emailMock() {
  return 'export async function sendPasswordResetEmail() {}'
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
    external: ['@node-rs/argon2'],
    plugins,
    logLevel: 'silent',
  })
  const bundledCode = result.outputFiles[0]?.text
  if (!bundledCode) throw new Error(`Failed to bundle ${entryPoint}`)
  await writeFile(outputPath, bundledCode, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`)
}

async function bundleInlineModule(contents, name, plugins = []) {
  const outputPath = resolve(bundleDir, `${name}.mjs`)
  const result = await esbuild.build({
    stdin: {
      contents,
      loader: 'ts',
      resolveDir: resolve('.'),
      sourcefile: `${name}.ts`,
    },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    write: false,
    external: ['@node-rs/argon2'],
    plugins,
    logLevel: 'silent',
  })
  const bundledCode = result.outputFiles[0]?.text
  if (!bundledCode) throw new Error(`Failed to bundle inline module ${name}`)
  await writeFile(outputPath, bundledCode, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`)
}
