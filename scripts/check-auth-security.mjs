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
  const authCopyModule = await bundleModule('src/copy/zh-CN/auth.ts', 'auth-copy')

  assertAuthApiCopy(authCopyModule.authCopy)
  await assertAuthResponseCopyCentralization()
  await assertPasswordSecurity(passwordModule)
  assertSlidingWindowRateLimits(rateLimitModule)
  assertClientIpResolution(clientIpModule)
  await assertUserPasswordMigration(passwordModule)
  await assertRegistrationCdkTransaction()
  await assertRegistrationBrevoQuotaPolicies()
  await assertResendVerificationEnumerationSafety()
  await assertUserSessionTouchAndAuthPayload()
  await assertUserSessionStorage()
  await assertAtomicPasswordResetHandler()
  await assertAtomicPasswordResetStorage()
  await assertUserLoginRateLimits()
  await assertAdminAuthenticationRateLimits()
  await assertNoBrowserReadableAdminPasswords()

  console.log('[check-auth-security] async password work and authentication rate limits passed')
} finally {
  await rm(bundleDir, { recursive: true, force: true })
}

function assertAuthApiCopy(authCopy) {
  const apiEntries = Object.entries(authCopy).filter(([key]) => key.startsWith('api_'))
  assert(apiEntries.length >= 30, 'authentication API copy should remain centralized')
  for (const [key, value] of apiEntries) {
    assert.equal(typeof value, 'string', `${key} should be a string`)
    assert.match(value, /[\u3400-\u9fff]/u, `${key} should use Chinese user-facing copy`)
  }
}

async function assertAuthResponseCopyCentralization() {
  for (const filename of ['server/handlers/auth.ts', 'server/handlers/user-auth.ts']) {
    const source = await readFile(filename, 'utf8')
    assert.equal(
      /(?:[{,]\s*)(?:message|error):\s*['"`]/u.test(source),
      false,
      `${filename} should reference src/copy instead of hardcoding response copy`,
    )
  }
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

async function assertRegistrationCdkTransaction() {
  globalThis.__authSecurityRegistrationTransactionTrace = []
  globalThis.__authSecurityRegistrationAccountSyncs = []
  globalThis.__authSecurityRegistrationSessions = []
  const userAuth = await bundleInlineModule(
    "export { registerUser } from './server/handlers/user-auth.ts'",
    'user-registration-cdk',
    [userRegistrationCdkPlugin()],
  )

  const registered = await userAuth.registerUser(
    'new-user@qq.com',
    'valid-password',
    'valid-cdk',
    'registration-request',
  )

  assert.equal(registered.ok, true, 'a new user should be able to register with a valid CDK')
  assert.deepEqual(
    globalThis.__authSecurityRegistrationTransactionTrace.map(({ operation }) => operation),
    ['account', 'account-cdk', 'profile', 'workspace'],
    'CDK registration should insert the account before claiming the CDK and patch only CDK fields afterward',
  )
  const [accountWrite, accountCdkWrite, profileWrite, workspaceWrite] = globalThis.__authSecurityRegistrationTransactionTrace
  assert.equal(accountWrite.value.id, registered.user.id)
  assert.equal(accountWrite.value.cdk_key, null)
  assert.equal(accountCdkWrite.value.id, registered.user.id)
  assert.equal(accountCdkWrite.value.cdk_key, 'cdk/valid')
  assert.equal(profileWrite.value.user_id, registered.user.id)
  assert.equal(profileWrite.value.cdk_key, 'cdk/valid')
  assert.equal(workspaceWrite.value.profile_id, profileWrite.value.id)
  assert.equal(
    globalThis.__authSecurityRegistrationAccountSyncs.length,
    0,
    'registration must not perform a full account save after the CDK transaction',
  )
  assert.equal(
    globalThis.__authSecurityRegistrationSessions.length,
    0,
    'registration must not create a browser session before the user signs in',
  )
}

async function assertRegistrationBrevoQuotaPolicies() {
  const userAuth = await bundleInlineModule(
    "export { registerUser } from './server/handlers/user-auth.ts'",
    'user-registration-brevo-quota',
    [userRegistrationCdkPlugin()],
  )
  process.env.PUBLIC_APP_URL = 'https://example.test'

  const reset = (settings, quotaReached) => {
    globalThis.__authSecurityRegistrationSettings = settings
    globalThis.__authSecurityBrevoQuotaReached = quotaReached
    globalThis.__authSecurityEmailReserveCalls = 0
    globalThis.__authSecurityEmailReleaseCalls = 0
    globalThis.__authSecurityEmailSendCalls = 0
    globalThis.__authSecurityRegistrationTransactionTrace = []
    globalThis.__authSecurityRegistrationAccountSyncs = []
    globalThis.__authSecurityRegistrationSessions = []
    globalThis.__authSecurityVerificationTokens = []
    globalThis.__authSecurityExistingRegistrationUsers = new Map()
    globalThis.__authSecurityRecentVerificationToken = null
    globalThis.__authSecurityEmailSendFailure = false
  }

  reset({ email_verification_required: true, invite_code_required: false, brevo_quota_action: 'pause_registration' }, false)
  const unsupportedProvider = await userAuth.registerUser('blocked@company.example', 'valid-password')
  assert.deepEqual(unsupportedProvider, {
    ok: false,
    status: 400,
    message: '注册仅支持常用公共邮箱，不支持企业、自建或临时邮箱。',
    code: 'email_provider_not_allowed',
  })
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs.length, 0)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 0)
  assert.equal(globalThis.__authSecurityEmailSendCalls, 0)

  const aliasAddress = await userAuth.registerUser('alias+tag@qq.com', 'valid-password')
  assert.deepEqual(aliasAddress, {
    ok: false,
    status: 400,
    message: '注册不支持邮箱别名。请移除“+”；Gmail 请同时移除用户名中的“.”并使用 gmail.com。',
    code: 'email_alias_not_allowed',
  })
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs.length, 0)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 0)
  assert.equal(globalThis.__authSecurityEmailSendCalls, 0)

  const typoAddress = await userAuth.registerUser('correct@gmial.com', 'valid-password')
  assert.deepEqual(typoAddress, {
    ok: false,
    status: 400,
    message: '邮箱域名可能有误，请使用建议地址。',
    code: 'email_domain_typo',
    suggestedEmail: 'correct@gmail.com',
  })
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs.length, 0)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 0)
  assert.equal(globalThis.__authSecurityEmailSendCalls, 0)

  reset({ email_verification_required: true, invite_code_required: true, brevo_quota_action: 'pause_registration' }, false)
  const inviteRequired = await userAuth.registerUser('invite-required@qq.com', 'valid-password')
  assert.deepEqual(inviteRequired, {
    ok: false,
    status: 400,
    message: '当前仅限管理员邀请注册，请输入管理员邀请码。',
    code: 'invite_code_required',
  })
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs.length, 0)

  reset({ email_verification_required: true, invite_code_required: false, brevo_quota_action: 'pause_registration' }, true)
  const paused = await userAuth.registerUser('paused@qq.com', 'valid-password')
  assert.deepEqual(paused, {
    ok: false,
    status: 503,
    message: '今日邮件发送额度已用尽，注册已暂停，请明日再试。',
    code: 'brevo_daily_limit_reached',
    retryAfterSeconds: 3_600,
  })
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 1)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs.length, 0)
  assert.equal(globalThis.__authSecurityRegistrationTransactionTrace.length, 0)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 0)
  assert.equal(globalThis.__authSecurityEmailSendCalls, 0)

  globalThis.__authSecurityExistingRegistrationUsers.set('paused-existing@qq.com', { id: 'existing-user' })
  const pausedExisting = await userAuth.registerUser('paused-existing@qq.com', 'valid-password')
  assert.deepEqual(pausedExisting, paused, 'quota exhaustion must not reveal whether the email already exists')

  reset({ email_verification_required: true, invite_code_required: false, brevo_quota_action: 'allow_unverified_registration' }, true)
  const bypassed = await userAuth.registerUser('bypassed@qq.com', 'valid-password')
  assert.equal(bypassed.ok, true)
  assert.equal(bypassed.verificationRequired, false)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs.length, 1)
  assert.equal(globalThis.__authSecurityRegistrationAccountSyncs[0].email_verified_at !== null, true)
  assert.equal(globalThis.__authSecurityEmailSendCalls, 0)

  reset({ email_verification_required: true, invite_code_required: false, brevo_quota_action: 'allow_unverified_registration' }, false)
  const verified = await userAuth.registerUser('verified@qq.com', 'valid-password')
  assert.equal(verified.ok, true)
  assert.equal(verified.verificationRequired, true)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 1)
  assert.equal(globalThis.__authSecurityEmailSendCalls, 1)

  reset({ email_verification_required: true, invite_code_required: false, brevo_quota_action: 'pause_registration' }, false)
  globalThis.__authSecurityEmailSendFailure = true
  const deliveryFailed = await userAuth.registerUser('delivery-failed@qq.com', 'valid-password')
  assert.equal(deliveryFailed.ok, true)
  assert.equal(deliveryFailed.verificationRequired, true)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 1)
  assert.equal(globalThis.__authSecurityVerificationTokens[0].delivery_id, 'reservation')
  assert.equal(globalThis.__authSecurityEmailReleaseCalls, 1)

  reset({ email_verification_required: false, invite_code_required: false, brevo_quota_action: 'pause_registration' }, true)
  const verificationDisabled = await userAuth.registerUser('disabled@qq.com', 'valid-password')
  assert.equal(verificationDisabled.ok, true)
  assert.equal(verificationDisabled.verificationRequired, false)
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)

  delete globalThis.__authSecurityRegistrationSettings
  delete globalThis.__authSecurityBrevoQuotaReached
}

async function assertResendVerificationEnumerationSafety() {
  const userAuth = await bundleInlineModule(
    "export { resendEmailVerification } from './server/handlers/user-auth.ts'",
    'user-resend-verification',
    [userRegistrationCdkPlugin()],
  )
  process.env.PUBLIC_APP_URL = 'https://example.test'
  const pendingUser = {
    version: 1,
    id: 'pending-user',
    email: 'pending@qq.com',
    password_hash: 'password-hash',
    salt: 'password-salt',
    iterations: 2,
    password_algorithm: 'argon2id',
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: null,
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  }
  const reset = () => {
    globalThis.__authSecurityExistingRegistrationUsers = new Map()
    globalThis.__authSecurityRecentVerificationToken = null
    globalThis.__authSecurityBrevoQuotaReached = false
    globalThis.__authSecurityEmailSendFailure = false
    globalThis.__authSecurityEmailReserveCalls = 0
    globalThis.__authSecurityEmailReleaseCalls = 0
    globalThis.__authSecurityEmailSendCalls = 0
    globalThis.__authSecurityVerificationTokens = []
  }
  const results = []

  reset()
  results.push(await userAuth.resendEmailVerification('missing@qq.com'))
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)

  reset()
  globalThis.__authSecurityExistingRegistrationUsers.set('verified@qq.com', {
    ...pendingUser,
    email: 'verified@qq.com',
    email_verified_at: '2026-07-31T00:00:00.000Z',
  })
  results.push(await userAuth.resendEmailVerification('verified@qq.com'))
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)

  reset()
  globalThis.__authSecurityExistingRegistrationUsers.set(pendingUser.email, pendingUser)
  globalThis.__authSecurityRecentVerificationToken = { id: 'recent-token' }
  results.push(await userAuth.resendEmailVerification(pendingUser.email))
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 0)

  reset()
  globalThis.__authSecurityExistingRegistrationUsers.set(pendingUser.email, pendingUser)
  globalThis.__authSecurityBrevoQuotaReached = true
  results.push(await userAuth.resendEmailVerification(pendingUser.email))
  assert.equal(globalThis.__authSecurityEmailReserveCalls, 1)

  reset()
  globalThis.__authSecurityExistingRegistrationUsers.set(pendingUser.email, pendingUser)
  globalThis.__authSecurityEmailSendFailure = true
  results.push(await userAuth.resendEmailVerification(pendingUser.email))
  assert.equal(globalThis.__authSecurityEmailSendCalls, 1)
  assert.equal(globalThis.__authSecurityVerificationTokens.length, 1)
  assert.equal(globalThis.__authSecurityVerificationTokens[0].delivery_id, 'reservation')
  assert.equal(globalThis.__authSecurityEmailReleaseCalls, 1)

  assert(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0])))
  assert.deepEqual(results[0], {
    ok: true,
    message: '如果账号符合条件，请按照发送至注册邮箱的验证说明完成注册。',
  })
}

async function assertUserSessionTouchAndAuthPayload() {
  const userAuth = await bundleInlineModule(
    "export { buildAuthPayload, requireUserSession, USER_SESSION_TOUCH_INTERVAL_MS } from './server/handlers/user-auth.ts'",
    'user-session-auth',
    [userSessionAuthPlugin()],
  )
  const now = new Date('2026-07-10T12:00:00.000Z')
  const sessionToken = 'A'.repeat(43)
  const request = new Request('http://local/api/optimization/jobs/test', {
    headers: { Cookie: `maa_session=${sessionToken}` },
  })
  const activeUser = {
    version: 1,
    id: 'user-1',
    email: 'session@example.com',
    password_hash: 'unused',
    salt: 'unused',
    iterations: 2,
    password_algorithm: 'argon2id',
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
  const sessionAt = (lastSeenAt, expiresAt = '2026-08-10T12:00:00.000Z') => ({
    version: 1,
    id: 'session-1',
    user_id: activeUser.id,
    token_hash: 'stored-token-hash',
    created_at: '2026-07-01T00:00:00.000Z',
    last_seen_at: lastSeenAt,
    expires_at: expiresAt,
  })
  const authenticateAt = async (session, user = activeUser) => {
    globalThis.__authSecurityUserSession = session
    globalThis.__authSecuritySessionUser = user
    globalThis.__authSecuritySessionTouches = []
    globalThis.__authSecuritySessionDeletes = []
    globalThis.__authSecurityProfiles = []
    return userAuth.requireUserSession(request, now)
  }

  const fresh = sessionAt(new Date(now.getTime() - userAuth.USER_SESSION_TOUCH_INTERVAL_MS + 1).toISOString())
  assert(await authenticateAt(fresh), 'fresh user session should authenticate')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 0, 'fresh user session should not be touched')

  const boundary = sessionAt(new Date(now.getTime() - userAuth.USER_SESSION_TOUCH_INTERVAL_MS).toISOString())
  assert(await authenticateAt(boundary), 'boundary user session should authenticate')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 1, 'touch interval boundary should be inclusive')
  assert.equal(globalThis.__authSecuritySessionTouches[0].now, now.toISOString())
  assert.equal(globalThis.__authSecuritySessionTouches[0].cutoff, boundary.last_seen_at)

  const stale = sessionAt(new Date(now.getTime() - userAuth.USER_SESSION_TOUCH_INTERVAL_MS - 1).toISOString())
  assert(await authenticateAt(stale), 'stale user session should authenticate')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 1, 'stale user session should be touched once')

  assert(await authenticateAt(sessionAt('not-a-date')), 'session with invalid last_seen_at should authenticate')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 1, 'invalid last_seen_at should be repaired')

  assert(await authenticateAt(sessionAt('2026-07-10T12:01:00.000Z')), 'future last_seen_at session should authenticate')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 0, 'future last_seen_at should not be touched')

  assert.equal(await authenticateAt(sessionAt(stale.last_seen_at, now.toISOString())), null)
  assert.equal(globalThis.__authSecuritySessionDeletes.length, 1, 'expired session should be deleted')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 0, 'expired session should not be touched')

  assert.equal(await authenticateAt(stale, null), null)
  assert.equal(globalThis.__authSecuritySessionDeletes.length, 1, 'session for missing user should be deleted')
  assert.equal(globalThis.__authSecuritySessionTouches.length, 0)

  for (const status of ['frozen', 'revoked']) {
    assert.equal(await authenticateAt(stale, { ...activeUser, status }), null)
    assert.equal(globalThis.__authSecuritySessionDeletes.length, 1, `${status} user session should be deleted`)
    assert.equal(globalThis.__authSecuritySessionTouches.length, 0, `${status} user session should not be touched`)
  }

  const profiles = [
    { id: 'profile-2', user_id: activeUser.id, kind: 'cdk', display_name: 'Second' },
    { id: 'profile-1', user_id: activeUser.id, kind: 'cdk', display_name: 'First' },
  ]
  globalThis.__authSecurityProfiles = profiles
  globalThis.__authSecurityWorkspaces = new Map([
    ['profile-1', { profile_id: 'profile-1', updated_at: '2026-07-10T11:00:00.000Z' }],
  ])
  globalThis.__authSecurityWorkspaceBatchCalls = []
  globalThis.__authSecurityWorkspaceSingleCalls = 0
  const payload = await userAuth.buildAuthPayload(activeUser, 'profile-1')
  assert.deepEqual(globalThis.__authSecurityWorkspaceBatchCalls, [['profile-2', 'profile-1']])
  assert.equal(globalThis.__authSecurityWorkspaceSingleCalls, 0, 'auth payload should not read workspaces individually')
  assert.deepEqual(payload.profiles.map((profile) => profile.id), ['profile-2', 'profile-1'])
  assert.equal(payload.profiles[0].workspace_profile_id, null)
  assert.equal(payload.profiles[1].workspace_profile_id, 'profile-1')
  assert.equal(payload.active_profile.id, 'profile-1')
  assert.equal(payload.active_profile.workspace_profile_id, 'profile-1')
  assert.equal(payload.workspace.profile_id, 'profile-1')

  globalThis.__authSecurityWorkspaceBatchCalls = []
  const fallbackPayload = await userAuth.buildAuthPayload(activeUser, 'missing-profile')
  assert.deepEqual(globalThis.__authSecurityWorkspaceBatchCalls, [['profile-2', 'profile-1']])
  assert.equal(fallbackPayload.active_profile.id, 'profile-2')
  assert.equal(fallbackPayload.workspace, null)

  globalThis.__authSecurityProfiles = [profiles[1]]
  globalThis.__authSecurityWorkspaceBatchCalls = []
  const singleProfilePayload = await userAuth.buildAuthPayload(activeUser)
  assert.deepEqual(globalThis.__authSecurityWorkspaceBatchCalls, [['profile-1']])
  assert.deepEqual(singleProfilePayload.profiles.map((profile) => profile.id), ['profile-1'])
  assert.equal(singleProfilePayload.active_profile.id, 'profile-1')
  assert.equal(singleProfilePayload.workspace.profile_id, 'profile-1')

  globalThis.__authSecurityProfiles = []
  globalThis.__authSecurityWorkspaceBatchCalls = []
  const emptyPayload = await userAuth.buildAuthPayload(activeUser, 'missing-profile')
  assert.deepEqual(globalThis.__authSecurityWorkspaceBatchCalls, [[]])
  assert.deepEqual(emptyPayload.profiles, [])
  assert.equal(emptyPayload.active_profile, null)
  assert.equal(emptyPayload.workspace, null)
}

async function assertUserSessionStorage() {
  globalThis.__authSecurityStorageQueries = []
  globalThis.__authSecurityStoredLastSeenAt = '2026-07-10T11:49:59.000Z'
  globalThis.__authSecurityStoredSession = null
  globalThis.__authSecurityStoredWorkspaces = new Map()
  const userStore = await bundleInlineModule(
    "export { listProfileWorkspaces, touchSession } from './server/storage/user-store.ts'",
    'user-session-storage',
    [userSessionStoragePlugin()],
  )
  const now = new Date('2026-07-10T12:00:00.000Z')
  const cutoff = new Date('2026-07-10T11:50:00.000Z')
  const session = {
    version: 1,
    id: 'session-1',
    user_id: 'user-1',
    token_hash: 'stored-token-hash',
    created_at: '2026-07-01T00:00:00.000Z',
    last_seen_at: globalThis.__authSecurityStoredLastSeenAt,
    expires_at: '2026-08-01T00:00:00.000Z',
  }
  const touches = await Promise.all([
    userStore.touchSession(session, now, cutoff),
    userStore.touchSession(session, now, cutoff),
    userStore.touchSession(session, now, cutoff),
  ])
  assert.deepEqual(touches.sort(), [false, false, true], 'concurrent stale touches should produce one physical update')
  assert.equal(globalThis.__authSecurityStoredLastSeenAt, now.toISOString())
  assert.equal(globalThis.__authSecurityStoredSession.last_seen_at, now.toISOString())
  const updateQueries = globalThis.__authSecurityStorageQueries.filter(({ text }) => /update user_sessions/i.test(text))
  assert.equal(updateQueries.length, 3)
  assert(updateQueries.every(({ text }) => /last_seen_at <= \$5/i.test(text)))
  assert(updateQueries.every(({ text }) => !/insert into user_sessions/i.test(text)))

  const workspaceRecord = (profileId, updatedAt) => ({
    version: 1,
    profile_id: profileId,
    operators: null,
    config: null,
    elite_overrides: {},
    last_result: null,
    updated_at: updatedAt,
  })
  globalThis.__authSecurityStoredWorkspaces = new Map([
    ['profile-1', workspaceRecord('profile-1', '2026-07-10T10:00:00.000Z')],
    ['profile-2', workspaceRecord('profile-2', '2026-07-10T11:00:00.000Z')],
  ])
  const beforeEmptyBatch = globalThis.__authSecurityStorageQueries.length
  assert.equal((await userStore.listProfileWorkspaces([])).size, 0)
  assert.equal(globalThis.__authSecurityStorageQueries.length, beforeEmptyBatch, 'empty profile batch should not query')

  const workspaces = await userStore.listProfileWorkspaces(['profile-1', 'missing', 'profile-2'])
  const batchQueries = globalThis.__authSecurityStorageQueries.filter(({ text }) => /from user_profile_workspaces/i.test(text))
  assert.equal(batchQueries.length, 1)
  assert(/any\(\$1::text\[\]\)/i.test(batchQueries[0].text))
  assert.deepEqual([...workspaces.keys()].sort(), ['profile-1', 'profile-2'])
  assert.equal(workspaces.get('profile-1').profile_id, 'profile-1')
  assert.deepEqual(workspaces.get('profile-1').saved_configs, [])
  assert.deepEqual(workspaces.get('profile-2').result_history, [])
}

async function assertAtomicPasswordResetHandler() {
  const userAuth = await bundleInlineModule(
    "export { resetPasswordWithToken, resetUserPasswordByAdmin } from './server/handlers/user-auth.ts'",
    'atomic-password-reset-handler',
    [passwordResetAuthPlugin()],
  )
  const activeUser = {
    version: 1,
    id: 'reset-user-1',
    email: 'reset@example.com',
    password_hash: 'old-password-hash',
    salt: 'old-salt',
    iterations: 2,
    password_algorithm: 'argon2id',
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
  const validToken = {
    id: 'reset-token-1',
    user_id: activeUser.id,
    token_hash: 'stored-reset-token-hash',
    expires_at: '2999-01-01T00:00:00.000Z',
    used_at: null,
    created_at: '2026-07-10T00:00:00.000Z',
  }
  const resetHandlerState = (overrides = {}) => {
    globalThis.__authSecurityResetSequence = []
    globalThis.__authSecurityResetToken = validToken
    globalThis.__authSecurityResetUser = activeUser
    globalThis.__authSecurityResetMode = 'success'
    globalThis.__authSecurityResetClaimed = false
    globalThis.__authSecurityResetCalls = []
    Object.assign(globalThis, overrides)
  }

  resetHandlerState()
  const success = await userAuth.resetPasswordWithToken('raw-reset-token', 'StrongResetPassword!2026')
  assert.deepEqual(success, { ok: true })
  assert.deepEqual(globalThis.__authSecurityResetSequence, ['token-preflight', 'user-preflight', 'hash', 'transaction'])
  assert.equal(globalThis.__authSecurityResetCalls.length, 1)
  assert.match(globalThis.__authSecurityResetCalls[0].resetTokenHash, /^[a-f0-9]{64}$/)
  assert.notEqual(globalThis.__authSecurityResetCalls[0].resetTokenHash, 'raw-reset-token')
  assert.equal(globalThis.__authSecurityResetCalls[0].userId, activeUser.id)
  assert.equal(globalThis.__authSecurityResetCalls[0].expectedPasswordHash, activeUser.password_hash)
  assert.deepEqual(globalThis.__authSecurityResetCalls[0].replacement, {
    password_hash: 'new-password-hash',
    salt: 'new-password-salt',
    iterations: 2,
    password_algorithm: 'argon2id',
  })
  assert(globalThis.__authSecurityResetCalls[0].updatedAt instanceof Date)

  resetHandlerState({ __authSecurityResetMode: 'concurrent' })
  const concurrent = await Promise.all([
    userAuth.resetPasswordWithToken('same-reset-token', 'StrongResetPassword!2026'),
    userAuth.resetPasswordWithToken('same-reset-token', 'AnotherStrongPassword!2026'),
  ])
  assert.equal(concurrent.filter((result) => result.ok).length, 1)
  const concurrentFailure = concurrent.find((result) => !result.ok)
  assert.deepEqual(concurrentFailure, {
    ok: false,
    status: 400,
    message: '重置链接无效或已过期。',
  })
  assert.equal(globalThis.__authSecurityResetCalls.length, 2)

  for (const token of [
    null,
    { ...validToken, used_at: '2026-07-10T01:00:00.000Z' },
    { ...validToken, expires_at: '2000-01-01T00:00:00.000Z' },
  ]) {
    resetHandlerState({ __authSecurityResetToken: token })
    const invalid = await userAuth.resetPasswordWithToken('invalid-reset-token', 'StrongResetPassword!2026')
    assert.equal(invalid.ok, false)
    assert.equal(invalid.status, 400)
    assert.deepEqual(globalThis.__authSecurityResetSequence, ['token-preflight'])
  }

  for (const user of [null, { ...activeUser, status: 'frozen' }, { ...activeUser, status: 'revoked' }]) {
    resetHandlerState({ __authSecurityResetUser: user })
    const invalid = await userAuth.resetPasswordWithToken('invalid-user-token', 'StrongResetPassword!2026')
    assert.equal(invalid.ok, false)
    assert.equal(invalid.status, 400)
    assert.deepEqual(globalThis.__authSecurityResetSequence, ['token-preflight', 'user-preflight'])
  }

  resetHandlerState()
  const weakPassword = await userAuth.resetPasswordWithToken('raw-reset-token', 'short')
  assert.equal(weakPassword.ok, false)
  assert.deepEqual(globalThis.__authSecurityResetSequence, ['token-preflight', 'user-preflight'])

  resetHandlerState({ __authSecurityResetMode: 'expire-during-hash' })
  const expiredDuringHash = await userAuth.resetPasswordWithToken('raw-reset-token', 'StrongResetPassword!2026')
  assert.deepEqual(expiredDuringHash, {
    ok: false,
    status: 400,
    message: '重置链接无效或已过期。',
  })
  assert.deepEqual(globalThis.__authSecurityResetSequence, ['token-preflight', 'user-preflight', 'hash', 'transaction'])

  resetHandlerState({ __authSecurityResetUser: { ...activeUser, status: 'frozen' } })
  const frozenAdminReset = await userAuth.resetUserPasswordByAdmin(
    globalThis.__authSecurityResetUser,
    'StrongResetPassword!2026',
  )
  assert.deepEqual(frozenAdminReset, {
    ok: false,
    status: 409,
    message: '账号状态或密码已发生变化，请刷新后重试。',
    code: 'password_update_conflict',
  })
  assert.deepEqual(globalThis.__authSecurityResetSequence, [])

  resetHandlerState({ __authSecurityResetMode: 'password-conflict' })
  const concurrentAdminReset = await userAuth.resetUserPasswordByAdmin(
    activeUser,
    'StrongResetPassword!2026',
  )
  assert.deepEqual(concurrentAdminReset, {
    ok: false,
    status: 409,
    message: '账号状态或密码已发生变化，请刷新后重试。',
    code: 'password_update_conflict',
  })
  assert.deepEqual(globalThis.__authSecurityResetSequence, ['hash', 'transaction'])
}

async function assertAtomicPasswordResetStorage() {
  const userStore = await bundleInlineModule(
    "export { updateUserPasswordAtomically } from './server/storage/user-store.ts'",
    'atomic-password-reset-storage',
    [passwordResetStoragePlugin()],
  )
  const claimedAt = new Date('2026-07-10T12:00:00.000Z')
  const passwordHash = {
    password_hash: 'replacement-password-hash',
    salt: 'replacement-password-salt',
    iterations: 2,
    password_algorithm: 'argon2id',
  }
  const baseUser = {
    version: 1,
    id: 'reset-user-1',
    email: 'reset@example.com',
    password_hash: 'old-password-hash',
    salt: 'old-password-salt',
    iterations: 1,
    password_algorithm: 'pbkdf2-sha256',
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
  const resetStorageState = (overrides = {}) => {
    globalThis.__authSecurityPasswordResetDb = {
      tokens: [{
        id: 'reset-token-1',
        user_id: baseUser.id,
        token_hash: 'reset-token-hash',
        expires_at: '2026-07-10T12:01:00.000Z',
        used_at: null,
        delivery_status: 'sent',
      }, {
        id: 'reset-token-2',
        user_id: baseUser.id,
        token_hash: 'other-reset-token-hash',
        expires_at: '2026-07-10T12:02:00.000Z',
        used_at: null,
        delivery_status: 'uncertain',
      }],
      user: structuredClone(baseUser),
      sessions: [{ token_hash: 'keep-session' }, { token_hash: 'other-session' }],
    }
    globalThis.__authSecurityPasswordResetTrace = []
    globalThis.__authSecurityPasswordResetReleased = 0
    globalThis.__authSecurityPasswordResetFailure = null
    globalThis.__authSecurityPasswordResetClaimSql = null
    Object.assign(globalThis, overrides)
  }

  resetStorageState()
  const updated = await userStore.updateUserPasswordAtomically({
    userId: baseUser.id,
    expectedPasswordHash: baseUser.password_hash,
    replacement: passwordHash,
    updatedAt: claimedAt,
    resetTokenHash: 'reset-token-hash',
  })
  assert.equal(updated.ok, true)
  assert.deepEqual(globalThis.__authSecurityPasswordResetTrace, [
    'begin', 'claim', 'update-user', 'invalidate-tokens', 'delete-sessions', 'commit', 'release',
  ])
  assert.match(globalThis.__authSecurityPasswordResetClaimSql.text, /update password_reset_tokens/i)
  assert.match(globalThis.__authSecurityPasswordResetClaimSql.text, /token_hash = \$1/i)
  assert.match(globalThis.__authSecurityPasswordResetClaimSql.text, /user_id = \$2/i)
  assert.match(globalThis.__authSecurityPasswordResetClaimSql.text, /used_at is null/i)
  assert.match(globalThis.__authSecurityPasswordResetClaimSql.text, /expires_at > \$3/i)
  assert.match(globalThis.__authSecurityPasswordResetClaimSql.text, /delivery.status in/i)
  assert.deepEqual(globalThis.__authSecurityPasswordResetClaimSql.values, [
    'reset-token-hash', baseUser.id, claimedAt.toISOString(),
  ])
  assert(globalThis.__authSecurityPasswordResetDb.tokens.every((token) => token.used_at === claimedAt.toISOString()))
  assert.deepEqual(globalThis.__authSecurityPasswordResetDb.sessions, [])
  assert.equal(updated.user.email, baseUser.email)
  assert.equal(updated.user.permission, baseUser.permission)
  assert.equal(updated.user.password_hash, passwordHash.password_hash)
  assert.equal(updated.user.password_algorithm, passwordHash.password_algorithm)
  assert.equal(globalThis.__authSecurityPasswordResetDb.user.password_hash, passwordHash.password_hash)
  assert.equal(globalThis.__authSecurityPasswordResetReleased, 1)

  resetStorageState()
  const selfChanged = await userStore.updateUserPasswordAtomically({
    userId: baseUser.id,
    expectedPasswordHash: baseUser.password_hash,
    replacement: passwordHash,
    updatedAt: claimedAt,
    keepSessionTokenHash: 'keep-session',
  })
  assert.equal(selfChanged.ok, true)
  assert.deepEqual(globalThis.__authSecurityPasswordResetDb.sessions, [{ token_hash: 'keep-session' }])
  assert(globalThis.__authSecurityPasswordResetDb.tokens.every((token) => token.used_at === claimedAt.toISOString()))

  for (const conflict of ['invalid-token', 'stale-password', 'frozen']) {
    resetStorageState()
    const input = {
      userId: baseUser.id,
      expectedPasswordHash: conflict === 'stale-password' ? 'stale-hash' : baseUser.password_hash,
      replacement: passwordHash,
      updatedAt: claimedAt,
      ...(conflict === 'invalid-token' ? { resetTokenHash: 'missing-token' } : {}),
    }
    if (conflict === 'frozen') globalThis.__authSecurityPasswordResetDb.user.status = 'frozen'
    const rejected = await userStore.updateUserPasswordAtomically(input)
    assert.deepEqual(rejected, {
      ok: false,
      reason: conflict === 'invalid-token' ? 'reset_token_invalid' : 'password_update_conflict',
    })
    assert.equal(globalThis.__authSecurityPasswordResetDb.user.password_hash, baseUser.password_hash)
    assert(globalThis.__authSecurityPasswordResetDb.tokens.every((token) => token.used_at === null))
    assert.deepEqual(globalThis.__authSecurityPasswordResetDb.sessions, [
      { token_hash: 'keep-session' }, { token_hash: 'other-session' },
    ])
  }

  for (const failure of ['update-user', 'invalidate-tokens', 'delete-sessions', 'commit']) {
    resetStorageState({ __authSecurityPasswordResetFailure: failure })
    await assert.rejects(
      userStore.updateUserPasswordAtomically({
        userId: baseUser.id,
        expectedPasswordHash: baseUser.password_hash,
        replacement: passwordHash,
        updatedAt: claimedAt,
        resetTokenHash: 'reset-token-hash',
      }),
      new RegExp(`Injected ${failure} failure`),
    )
    assert(globalThis.__authSecurityPasswordResetDb.tokens.every((token) => token.used_at === null))
    assert.equal(globalThis.__authSecurityPasswordResetDb.user.password_hash, baseUser.password_hash)
    assert.deepEqual(globalThis.__authSecurityPasswordResetDb.sessions, [
      { token_hash: 'keep-session' }, { token_hash: 'other-session' },
    ])
    assert.equal(globalThis.__authSecurityPasswordResetTrace.at(-1), 'release')
  }
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
  globalThis.__authSecurityRegisterCalls = 0
  globalThis.__authSecurityRegisterResult = { ok: true, user: { id: 'user-registered' }, verificationRequired: true }
  globalThis.__authSecuritySession = null
  const authHandler = await bundleModule('server/handlers/auth.ts', 'auth-handler', [authHandlerPlugin()])

  const unsupportedProvider = await authHandler.default(new Request('http://local/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': '192.0.2.29' },
    body: JSON.stringify({ email: 'blocked@company.example', password: 'correct-password' }),
  }))
  assert.equal(unsupportedProvider.status, 400)
  assert.deepEqual(await unsupportedProvider.json(), {
    error: '注册仅支持常用公共邮箱，不支持企业、自建或临时邮箱。',
    code: 'email_provider_not_allowed',
  })

  const aliasAddress = await authHandler.default(new Request('http://local/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': '192.0.2.29' },
    body: JSON.stringify({ email: 'alias+tag@qq.com', password: 'correct-password' }),
  }))
  assert.equal(aliasAddress.status, 400)
  assert.deepEqual(await aliasAddress.json(), {
    error: '注册不支持邮箱别名。请移除“+”；Gmail 请同时移除用户名中的“.”并使用 gmail.com。',
    code: 'email_alias_not_allowed',
  })

  const typoAddress = await authHandler.default(new Request('http://local/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': '192.0.2.29' },
    body: JSON.stringify({ email: 'correct@gmial.com', password: 'correct-password' }),
  }))
  assert.equal(typoAddress.status, 400)
  assert.deepEqual(await typoAddress.json(), {
    error: '邮箱域名可能有误，请使用建议地址。',
    code: 'email_domain_typo',
    suggested_email: 'correct@gmail.com',
  })
  for (const email of ['repeat-one@company.example', 'repeat-two@company.example']) {
    const response = await authHandler.default(new Request('http://local/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': '192.0.2.29' },
      body: JSON.stringify({ email, password: 'correct-password' }),
    }))
    assert.equal(response.status, 400)
  }
  assert.equal(globalThis.__authSecurityRegisterCalls, 0, 'invalid registration emails should skip registerUser')

  const registrationAccepted = await authHandler.default(new Request('http://local/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': '192.0.2.29' },
    body: JSON.stringify({ email: 'new@qq.com', password: 'correct-password' }),
  }))
  assert.equal(registrationAccepted.status, 202)
  assert.deepEqual(await registrationAccepted.json(), {
    accepted: true,
    verification_required: true,
    message: '如果账号符合注册条件，请按照发送至该邮箱的验证说明完成注册。',
    resend_after_seconds: 300,
  })
  assert.equal(globalThis.__authSecurityRegisterCalls, 1)

  globalThis.__authSecurityRegisterResult = {
    ok: false,
    status: 503,
    message: '今日邮件发送额度已用尽，注册已暂停，请明日再试。',
    code: 'brevo_daily_limit_reached',
    retryAfterSeconds: 7_200,
  }
  const registrationQuotaLimited = await authHandler.default(new Request('http://local/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': '192.0.2.31' },
    body: JSON.stringify({ email: 'quota@qq.com', password: 'correct-password' }),
  }))
  assert.equal(registrationQuotaLimited.status, 503)
  assert.equal(registrationQuotaLimited.headers.get('Retry-After'), '7200')
  assert.deepEqual(await registrationQuotaLimited.json(), {
    error: '今日邮件发送额度已用尽，注册已暂停，请明日再试。',
    code: 'brevo_daily_limit_reached',
    retry_after_seconds: 7_200,
  })

  const resendResponses = []
  for (const [index, result] of [
    { ok: true, message: 'missing' },
    { ok: true, message: 'verified' },
    { ok: true, message: 'cooldown' },
    { ok: true, message: 'quota' },
    { ok: true, message: 'delivery-failed' },
  ].entries()) {
    globalThis.__authSecurityResendResult = result
    const response = await authHandler.default(new Request('http://local/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goofish-Client-IP': `192.0.2.${40 + index}` },
      body: JSON.stringify({ email: `resend-${index}@qq.com` }),
    }))
    resendResponses.push({ status: response.status, body: await response.json() })
  }
  assert(resendResponses.every((response) => JSON.stringify(response) === JSON.stringify(resendResponses[0])))
  assert.deepEqual(resendResponses[0], {
    status: 202,
    body: {
      accepted: true,
      message: '如果账号符合条件，请按照发送至注册邮箱的说明操作。',
      resend_after_seconds: 300,
    },
  })

  globalThis.__authSecuritySession = { user: { id: 'user-1' } }
  const restoredSession = await authHandler.default(new Request('http://local/api/auth/me?profile_id=profile-2'))
  assert.equal(restoredSession.status, 200)
  assert.deepEqual(await restoredSession.json(), {
    user: { id: 'user-1' },
    active_profile_id: 'profile-2',
  })
  globalThis.__authSecuritySession = null

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
      build.onResolve({ filter: /(^|[\\/])persistent-rate-limit(\.ts)?$/ }, () => ({
        path: 'persistent-rate-limit',
        namespace: 'auth-security',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auth-security' }, (args) => ({
        contents: args.path === 'persistent-rate-limit'
          ? `
              export class RateLimitStoreError extends Error {}
              export async function reservePersistentRateLimit() {
                return { allowed: true, attempt: { retain() {}, async refund() {} } }
              }
            `
          : args.path === 'license-utils'
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
      for (const moduleName of ['user-store', 'announcement-store', 'license-utils', 'cdk-redemption', 'invitation-store', 'admin-registration-invitation-store', 'registration-settings-store', 'email']) {
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
          'cdk-redemption': cdkRedemptionMock(),
          'invitation-store': invitationStoreMock(),
          'admin-registration-invitation-store': adminRegistrationInvitationStoreMock(),
          'registration-settings-store': registrationSettingsStoreMock(),
          email: emailMock(),
        }
        return { contents: mocks[args.path], loader: 'js' }
      })
    },
  }
}

function userRegistrationCdkPlugin() {
  return {
    name: 'auth-security-user-registration-cdk-mocks',
    setup(build) {
      for (const moduleName of ['user-store', 'password', 'announcement-store', 'license-utils', 'cdk-redemption', 'invitation-store', 'admin-registration-invitation-store', 'registration-settings-store', 'email']) {
        build.onResolve({ filter: new RegExp(`(^|[\\\\/])${moduleName}(\\.ts)?$`) }, () => ({
          path: moduleName,
          namespace: 'auth-security-user-registration-cdk',
        }))
      }
      build.onLoad({ filter: /.*/, namespace: 'auth-security-user-registration-cdk' }, (args) => {
        const mocks = {
          'user-store': userRegistrationCdkStoreMock(),
          password: userRegistrationPasswordMock(),
          'announcement-store': announcementStoreMock(),
          'license-utils': userRegistrationLicenseUtilsMock(),
          'cdk-redemption': userRegistrationCdkRedemptionMock(),
          'invitation-store': invitationStoreMock(),
          'admin-registration-invitation-store': adminRegistrationInvitationStoreMock(),
          'registration-settings-store': registrationSettingsStoreMock(),
          email: emailMock(),
        }
        return { contents: mocks[args.path], loader: 'js' }
      })
    },
  }
}

function userSessionAuthPlugin() {
  return {
    name: 'auth-security-user-session-mocks',
    setup(build) {
      for (const moduleName of ['user-store', 'announcement-store', 'license-utils', 'cdk-redemption', 'invitation-store', 'admin-registration-invitation-store', 'registration-settings-store', 'email']) {
        build.onResolve({ filter: new RegExp(`(^|[\\\\/])${moduleName}(\\.ts)?$`) }, () => ({
          path: moduleName,
          namespace: 'auth-security-user-session',
        }))
      }
      build.onLoad({ filter: /.*/, namespace: 'auth-security-user-session' }, (args) => {
        const mocks = {
          'user-store': userSessionAuthStoreMock(),
          'announcement-store': announcementStoreMock(),
          'license-utils': userLicenseUtilsMock(),
          'cdk-redemption': cdkRedemptionMock(),
          'invitation-store': invitationStoreMock(),
          'admin-registration-invitation-store': adminRegistrationInvitationStoreMock(),
          'registration-settings-store': registrationSettingsStoreMock(),
          email: emailMock(),
        }
        return { contents: mocks[args.path], loader: 'js' }
      })
    },
  }
}

function userSessionStoragePlugin() {
  return {
    name: 'auth-security-user-session-storage-mocks',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])postgres(\.ts)?$/ }, () => ({
        path: 'postgres',
        namespace: 'auth-security-user-session-storage',
      }))
      build.onResolve({ filter: /(^|[\\/])schema(\.ts)?$/ }, () => ({
        path: 'schema',
        namespace: 'auth-security-user-session-storage',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auth-security-user-session-storage' }, (args) => ({
        contents: args.path === 'postgres' ? userSessionPostgresMock() : 'export async function ensureDatabaseSchema() {}',
        loader: 'js',
      }))
    },
  }
}

function passwordResetAuthPlugin() {
  return {
    name: 'auth-security-password-reset-mocks',
    setup(build) {
      for (const moduleName of ['user-store', 'password', 'announcement-store', 'license-utils', 'cdk-redemption', 'invitation-store', 'admin-registration-invitation-store', 'registration-settings-store', 'email']) {
        build.onResolve({ filter: new RegExp(`(^|[\\/])${moduleName}(\.ts)?$`) }, () => ({
          path: moduleName,
          namespace: 'auth-security-password-reset',
        }))
      }
      build.onLoad({ filter: /.*/, namespace: 'auth-security-password-reset' }, (args) => {
        const mocks = {
          'user-store': passwordResetAuthStoreMock(),
          password: passwordResetPasswordMock(),
          'announcement-store': announcementStoreMock(),
          'license-utils': userLicenseUtilsMock(),
          'cdk-redemption': cdkRedemptionMock(),
          'invitation-store': invitationStoreMock(),
          'admin-registration-invitation-store': adminRegistrationInvitationStoreMock(),
          'registration-settings-store': registrationSettingsStoreMock(),
          email: emailMock(),
        }
        return { contents: mocks[args.path], loader: 'js' }
      })
    },
  }
}

function passwordResetStoragePlugin() {
  return {
    name: 'auth-security-password-reset-storage-mocks',
    setup(build) {
      build.onResolve({ filter: /(^|[\/])postgres(\.ts)?$/ }, () => ({
        path: 'postgres',
        namespace: 'auth-security-password-reset-storage',
      }))
      build.onResolve({ filter: /(^|[\/])schema(\.ts)?$/ }, () => ({
        path: 'schema',
        namespace: 'auth-security-password-reset-storage',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auth-security-password-reset-storage' }, (args) => ({
        contents: args.path === 'postgres' ? passwordResetPostgresMock() : 'export async function ensureDatabaseSchema() {}',
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
      if (password !== 'correct-password') return { ok: false, status: 401, message: '邮箱或密码不正确。' }
      return { ok: true, user: { id: 'user-1', email }, cookie: 'maa_session=test' }
    }
    export async function buildAuthPayload(user, activeProfileId) { return { user, active_profile_id: activeProfileId } }
    export async function registerUser() {
      globalThis.__authSecurityRegisterCalls = (globalThis.__authSecurityRegisterCalls ?? 0) + 1
      return globalThis.__authSecurityRegisterResult
    }
    export async function logoutRequest() {}
    export async function requestPasswordReset() { return { ok: true } }
    export async function resendEmailVerification() { return globalThis.__authSecurityResendResult ?? { ok: true, message: 'ok' } }
    export async function resetPasswordWithToken() { return { ok: false, status: 400, message: 'unused' } }
    export async function verifyEmailWithToken() { return { ok: false, status: 400, message: 'unused' } }
    export async function changeUserPassword() { return { ok: false, status: 400, message: 'unused' } }
    export async function requireUserSession() { return globalThis.__authSecuritySession }
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
    export class RegistrationEmailConflictError extends Error {}
    export async function insertUserAccountForRegistration() {}
    export async function updateUserPasswordAtomically() { return { ok: false, reason: 'password_update_conflict' } }
    export async function deleteEmailVerificationTokenByHash() {}
    export async function getRecentEmailVerificationTokenForUser() {
      return globalThis.__authSecurityRecentVerificationToken ?? null
    }
    export async function saveEmailVerificationToken() {}
    export async function verifyUserEmailWithToken() { return null }
    export async function updateProfileWorkspaceAtomically(_profileId, updater) { return updater(null) }
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
    export async function listProfileWorkspaces() { return new Map() }
    export async function listProfilesForUser() { return [] }
    export async function markAnnouncementRead() {}
    export async function savePasswordResetToken() {}
    export async function saveProfileWorkspace() {}
    export async function saveUserAccount() {}
    export async function saveUserProfile() {}
    export async function resetUserPasswordWithToken() { return null }
    export function isFreePreviewProfile() { return false }
    export function toPublicProfile(value) { return value }
    export function toPublicWorkspace(value) { return value }
    export async function touchSession() {}
  `
}

function userRegistrationCdkStoreMock() {
  return `
    export class RegistrationEmailConflictError extends Error {}
    export async function insertUserAccountForRegistration(user) {
      globalThis.__authSecurityRegistrationAccountSyncs.push(structuredClone(user))
    }
    export async function updateUserPasswordAtomically() { return { ok: false, reason: 'password_update_conflict' } }
    export async function deleteEmailVerificationTokenByHash() {}
    export async function getRecentEmailVerificationTokenForUser() {
      return globalThis.__authSecurityRecentVerificationToken ?? null
    }
    export async function saveEmailVerificationToken(token) {
      if (globalThis.__authSecurityVerificationTokens) globalThis.__authSecurityVerificationTokens.push(structuredClone(token))
    }
    export async function verifyUserEmailWithToken() { return null }
    export async function updateProfileWorkspaceAtomically(_profileId, updater) { return updater(null) }
    export async function getUserByEmail(email) {
      return globalThis.__authSecurityExistingRegistrationUsers?.get(email) ?? null
    }
    export async function saveUserAccount(user) {
      globalThis.__authSecurityRegistrationAccountSyncs.push(structuredClone(user))
    }
    export async function saveUserSession(session) {
      globalThis.__authSecurityRegistrationSessions.push(structuredClone(session))
    }
    export function emptyWorkspace(profileId) {
      return {
        version: 1,
        profile_id: profileId,
        operators: [],
        config: {},
        elite_overrides: {},
        last_result: null,
        updated_at: '2026-01-01T00:00:00.000Z',
      }
    }
    export async function deleteSessionByTokenHash() {}
    export async function deleteSessionsForUser() {}
    export async function deleteUserAccount() {}
    export async function getAnnouncementReads() { return [] }
    export async function getPasswordResetTokenByHash() { return null }
    export async function getProfileForUser() { return null }
    export async function getRecentPasswordResetTokenForUser() { return null }
    export async function getSessionByTokenHash() { return null }
    export async function getUserById() { return null }
    export async function listProfileWorkspaces() { return new Map() }
    export async function listProfilesForUser() { return [] }
    export async function markAnnouncementRead() {}
    export async function migrateLegacyUserIfNeeded() { return [] }
    export async function resetUserPasswordWithToken() { return null }
    export async function savePasswordResetToken() {}
    export async function saveProfileWorkspace() {}
    export async function saveUserProfile() {}
    export function isFreePreviewProfile() { return false }
    export function toPublicProfile(value) { return value }
    export function toPublicWorkspace(value) { return value }
    export async function touchSession() { return false }
    export async function upgradeUserPasswordHash() { return null }
  `
}

function userRegistrationPasswordMock() {
  return `
    export async function createPasswordHash() {
      return {
        password_hash: 'registration-password-hash',
        salt: 'registration-password-salt',
        iterations: 2,
        password_algorithm: 'argon2id',
      }
    }
    export async function verifyPasswordHash() {
      return { verified: false, needsRehash: false }
    }
    export async function verifyPasswordHashOrDummy() {
      return { verified: false, needsRehash: false }
    }
  `
}

function userRegistrationLicenseUtilsMock() {
  return `
    export async function findCdkRecordByCode() {
      return {
        codeHash: 'valid-code-hash',
        key: 'cdk/valid',
        record: { status: 'unused', permission: 'growth' },
      }
    }
    export function getCdkRecordStore() { return { get: async () => null } }
    export function getCdkType(record) { return record.cdk_type ?? 'profile' }
    export function isProfileCdkRecord(record) { return getCdkType(record) === 'profile' }
    export function normalizeCode(value) { return value.trim().toUpperCase() }
    export function normalizePermissionMode(value) { return value }
    export function getFreePreviewDefaultConfig() { return {} }
    export function resolveFreePreviewConfig(config) { return { ok: true, config } }
  `
}

function userRegistrationCdkRedemptionMock() {
  return `
    export class CdkAlreadyRedeemedError extends Error {}
    export class IdempotencyConflictError extends Error {}
    export function createRequestHash(value) { return JSON.stringify(value) }
    export async function hasCompletedIdempotentRedemption() { return false }
    export async function redeemCdkAtomically(options) {
      await options.prepare?.({ id: 'registration-client' })
      const completed = await options.complete({ id: 'registration-client' }, {
        status: 'unused',
        permission: 'growth',
        license_order_hash: null,
        operator_count: null,
        config_desc: null,
      })
      return { response: completed.response, replayed: false }
    }
    export async function saveUserAccountInTransaction(client, value) {
      globalThis.__authSecurityRegistrationTransactionTrace.push({ operation: 'account', client, value: structuredClone(value) })
    }
    export async function updateRegisteredUserCdkInTransaction(client, value) {
      globalThis.__authSecurityRegistrationTransactionTrace.push({ operation: 'account-cdk', client, value: structuredClone(value) })
    }
    export async function saveProfileInTransaction(client, value) {
      globalThis.__authSecurityRegistrationTransactionTrace.push({ operation: 'profile', client, value: structuredClone(value) })
    }
    export async function saveWorkspaceInTransaction(client, value) {
      globalThis.__authSecurityRegistrationTransactionTrace.push({ operation: 'workspace', client, value: structuredClone(value) })
    }
  `
}

function userSessionAuthStoreMock() {
  return `
    export class RegistrationEmailConflictError extends Error {}
    export async function insertUserAccountForRegistration() {}
    export async function updateUserPasswordAtomically() { return { ok: false, reason: 'password_update_conflict' } }
    export async function deleteEmailVerificationTokenByHash() {}
    export async function getRecentEmailVerificationTokenForUser() { return null }
    export async function saveEmailVerificationToken() {}
    export async function verifyUserEmailWithToken() { return null }
    export async function updateProfileWorkspaceAtomically(_profileId, updater) { return updater(null) }
    export async function getSessionByTokenHash() {
      return globalThis.__authSecurityUserSession ?? null
    }
    export async function getUserById() {
      return globalThis.__authSecuritySessionUser ?? null
    }
    export async function deleteSessionByTokenHash(tokenHash) {
      globalThis.__authSecuritySessionDeletes.push(tokenHash)
    }
    export async function touchSession(session, now, cutoff) {
      globalThis.__authSecuritySessionTouches.push({
        session,
        now: now.toISOString(),
        cutoff: cutoff.toISOString(),
      })
      return true
    }
    export async function migrateLegacyUserIfNeeded() {
      return globalThis.__authSecurityProfiles ?? []
    }
    export async function listProfileWorkspaces(profileIds) {
      globalThis.__authSecurityWorkspaceBatchCalls.push([...profileIds])
      return new Map(globalThis.__authSecurityWorkspaces ?? [])
    }
    export async function getProfileWorkspace() {
      globalThis.__authSecurityWorkspaceSingleCalls += 1
      return null
    }
    export function toPublicProfile(profile, workspace) {
      return { ...profile, workspace_profile_id: workspace?.profile_id ?? null }
    }
    export function toPublicWorkspace(workspace) { return workspace }
    export async function getAnnouncementReads() { return [] }
    export async function deleteSessionsForUser() {}
    export async function deleteUserAccount() {}
    export function emptyWorkspace() { return null }
    export async function getPasswordResetTokenByHash() { return null }
    export async function getProfileForUser() { return null }
    export async function getRecentPasswordResetTokenForUser() { return null }
    export async function getUserByEmail() { return null }
    export async function listProfilesForUser() { return [] }
    export async function markAnnouncementRead() {}
    export async function savePasswordResetToken() {}
    export async function saveProfileWorkspace() {}
    export async function saveUserAccount() {}
    export async function saveUserProfile() {}
    export async function saveUserSession() {}
    export async function resetUserPasswordWithToken() { return null }
    export function isFreePreviewProfile() { return false }
    export async function upgradeUserPasswordHash() { return null }
  `
}

function userSessionPostgresMock() {
  return `
    export function getPool() { throw new Error('getPool should not be used by these checks') }
    export async function withTransaction(callback) { return callback({ query }) }
    export async function query(text, values = []) {
      globalThis.__authSecurityStorageQueries.push({ text, values })
      if (/update user_sessions/i.test(text)) {
        const cutoff = Date.parse(values[4])
        if (Date.parse(globalThis.__authSecurityStoredLastSeenAt) <= cutoff) {
          globalThis.__authSecurityStoredLastSeenAt = values[2]
          globalThis.__authSecurityStoredSession = JSON.parse(values[3])
          return { rows: [], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }
      if (/from user_profile_workspaces/i.test(text) && text.includes('where profile_id = any($1::text[])')) {
        const rows = [...values[0]]
          .reverse()
          .filter((profileId) => globalThis.__authSecurityStoredWorkspaces.has(profileId))
          .map((profileId) => ({
            profile_id: profileId,
            record_json: globalThis.__authSecurityStoredWorkspaces.get(profileId),
          }))
        return { rows, rowCount: rows.length }
      }
      throw new Error('Unexpected query in user session storage check: ' + text)
    }
  `
}

function passwordResetAuthStoreMock() {
  return `
    export class RegistrationEmailConflictError extends Error {}
    export async function insertUserAccountForRegistration() {}
    export async function deleteEmailVerificationTokenByHash() {}
    export async function getRecentEmailVerificationTokenForUser() { return null }
    export async function saveEmailVerificationToken() {}
    export async function verifyUserEmailWithToken() { return null }
    export async function updateProfileWorkspaceAtomically(_profileId, updater) { return updater(null) }
    export async function getPasswordResetTokenByHash() {
      globalThis.__authSecurityResetSequence.push('token-preflight')
      return globalThis.__authSecurityResetToken
    }
    export async function getUserById() {
      globalThis.__authSecurityResetSequence.push('user-preflight')
      return globalThis.__authSecurityResetUser
    }
    export async function updateUserPasswordAtomically(input) {
      globalThis.__authSecurityResetSequence.push('transaction')
      globalThis.__authSecurityResetCalls.push(input)
      if (globalThis.__authSecurityResetMode === 'expire-during-hash') return { ok: false, reason: 'reset_token_invalid' }
      if (globalThis.__authSecurityResetMode === 'password-conflict') return { ok: false, reason: 'password_update_conflict' }
      if (globalThis.__authSecurityResetMode === 'concurrent') {
        if (globalThis.__authSecurityResetClaimed) return { ok: false, reason: 'reset_token_invalid' }
        globalThis.__authSecurityResetClaimed = true
      }
      return { ok: true, user: { ...globalThis.__authSecurityResetUser, ...input.replacement } }
    }
    export async function deleteSessionByTokenHash() {}
    export async function deleteSessionsForUser() {}
    export async function deleteUserAccount() {}
    export function emptyWorkspace() { return null }
    export async function getAnnouncementReads() { return [] }
    export async function getProfileForUser() { return null }
    export async function getRecentPasswordResetTokenForUser() { return null }
    export async function getSessionByTokenHash() { return null }
    export async function getUserByEmail() { return null }
    export async function listProfileWorkspaces() { return new Map() }
    export async function listProfilesForUser() { return [] }
    export async function markAnnouncementRead() {}
    export async function migrateLegacyUserIfNeeded() { return [] }
    export async function savePasswordResetToken() {}
    export async function saveProfileWorkspace() {}
    export async function saveUserAccount() {}
    export async function saveUserProfile() {}
    export async function saveUserSession() {}
    export function isFreePreviewProfile() { return false }
    export function toPublicProfile(value) { return value }
    export function toPublicWorkspace(value) { return value }
    export async function touchSession() { return false }
    export async function upgradeUserPasswordHash() { return null }
  `
}

function passwordResetPasswordMock() {
  return `
    export async function createPasswordHash() {
      globalThis.__authSecurityResetSequence.push('hash')
      return {
        password_hash: 'new-password-hash',
        salt: 'new-password-salt',
        iterations: 2,
        password_algorithm: 'argon2id',
      }
    }
    export async function verifyPasswordHash() {
      return { verified: false, needsRehash: false }
    }
    export async function verifyPasswordHashOrDummy() {
      return { verified: false, needsRehash: false }
    }
  `
}

function passwordResetPostgresMock() {
  return `
    export async function withTransaction(callback) {
      const client = await getPool().connect()
      try {
        await client.query('BEGIN')
        const result = await callback(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }
    export function getPool() {
      return {
        connect: async () => {
          let snapshot = null
          return {
            query: async (text, values = []) => {
              const normalized = text.trim().toLowerCase()
              if (normalized === 'begin') {
                globalThis.__authSecurityPasswordResetTrace.push('begin')
                snapshot = structuredClone(globalThis.__authSecurityPasswordResetDb)
                return { rows: [], rowCount: null }
              }
              if (normalized === 'rollback') {
                globalThis.__authSecurityPasswordResetTrace.push('rollback')
                if (snapshot) globalThis.__authSecurityPasswordResetDb = structuredClone(snapshot)
                snapshot = null
                return { rows: [], rowCount: null }
              }
              if (normalized === 'commit') {
                globalThis.__authSecurityPasswordResetTrace.push('commit')
                if (globalThis.__authSecurityPasswordResetFailure === 'commit') {
                  throw new Error('Injected commit failure')
                }
                snapshot = null
                return { rows: [], rowCount: null }
              }
              if (/update password_reset_tokens/i.test(text) && /where token_hash/i.test(text)) {
                globalThis.__authSecurityPasswordResetTrace.push('claim')
                globalThis.__authSecurityPasswordResetClaimSql = { text, values }
                const db = globalThis.__authSecurityPasswordResetDb
                const token = db.tokens.find((candidate) => candidate.token_hash === values[0])
                const eligible = token
                  && token.user_id === values[1]
                  && token.used_at === null
                  && Date.parse(token.expires_at) > Date.parse(values[2])
                  && (!token.delivery_status || ['reserved', 'sent', 'uncertain'].includes(token.delivery_status))
                if (!eligible) return { rows: [], rowCount: 0 }
                token.used_at = values[2]
                return { rows: [], rowCount: 1 }
              }
              if (/update user_accounts/i.test(text)) {
                globalThis.__authSecurityPasswordResetTrace.push('update-user')
                if (globalThis.__authSecurityPasswordResetFailure === 'update-user') {
                  throw new Error('Injected update-user failure')
                }
                const db = globalThis.__authSecurityPasswordResetDb
                if (!db.user || db.user.id !== values[0]
                  || db.user.password_hash !== values[1]
                  || db.user.status !== 'active') {
                  return { rows: [], rowCount: 0 }
                }
                const patch = JSON.parse(values[5])
                db.user = {
                  ...db.user,
                  password_hash: values[2],
                  salt: values[3],
                  iterations: values[4],
                  ...patch,
                  updated_at: values[6],
                }
                const row = { record_json: structuredClone(db.user) }
                return { rows: [row], rowCount: 1 }
              }
              if (/update password_reset_tokens/i.test(text) && /where user_id/i.test(text)) {
                globalThis.__authSecurityPasswordResetTrace.push('invalidate-tokens')
                if (globalThis.__authSecurityPasswordResetFailure === 'invalidate-tokens') {
                  throw new Error('Injected invalidate-tokens failure')
                }
                let rowCount = 0
                for (const token of globalThis.__authSecurityPasswordResetDb.tokens) {
                  if (token.user_id === values[0] && token.used_at === null) {
                    token.used_at = values[1]
                    rowCount += 1
                  }
                }
                return { rows: [], rowCount }
              }
              if (/delete from user_sessions/i.test(text)) {
                globalThis.__authSecurityPasswordResetTrace.push('delete-sessions')
                if (globalThis.__authSecurityPasswordResetFailure === 'delete-sessions') {
                  throw new Error('Injected delete-sessions failure')
                }
                const sessions = globalThis.__authSecurityPasswordResetDb.sessions
                globalThis.__authSecurityPasswordResetDb.sessions = text.includes('token_hash <>')
                  ? sessions.filter((session) => session.token_hash === values[1])
                  : []
                return { rows: [], rowCount: sessions.length - globalThis.__authSecurityPasswordResetDb.sessions.length }
              }
              throw new Error('Unexpected password reset transaction query: ' + text)
            },
            release: () => {
              globalThis.__authSecurityPasswordResetTrace.push('release')
              globalThis.__authSecurityPasswordResetReleased += 1
            },
          }
        },
      }
    }
    export async function query() {
      throw new Error('Shared query helper should not be used by password reset transaction checks')
    }
  `
}

function announcementStoreMock() {
  return 'export function createPostgresAnnouncementStore() { return { get: async () => null } }'
}

function userLicenseUtilsMock() {
  return `
    export async function findCdkRecordByCode() { return null }
    export function getCdkRecordStore() { return { get: async () => null } }
    export function getCdkType(record) { return record.cdk_type ?? 'profile' }
    export function isProfileCdkRecord(record) { return getCdkType(record) === 'profile' }
    export function hashCdk(value) { return value }
    export function normalizeCode(value) { return value }
    export function normalizePermissionMode(value) { return value }
    export function getFreePreviewDefaultConfig() { return {} }
    export function resolveFreePreviewConfig(config) { return { ok: true, config } }
    export function requireEnv(name) { return process.env[name] ?? '' }
  `
}

function cdkRedemptionMock() {
  return `
    export class CdkAlreadyRedeemedError extends Error {}
    export class IdempotencyConflictError extends Error {}
    export function createRequestHash(value) { return JSON.stringify(value) }
    export async function hasCompletedIdempotentRedemption() { return false }
    export async function redeemCdkAtomically() { throw new Error('redeem should not run in this check') }
    export async function saveUserAccountInTransaction() {}
    export async function updateRegisteredUserCdkInTransaction() {}
    export async function saveProfileInTransaction() {}
    export async function saveWorkspaceInTransaction() {}
  `
}

function invitationStoreMock() {
  return `
    export class InvitationCodeError extends Error {}
    export async function validateInvitationCode() { return null }
    export async function saveRegistrationWithInvitation() {}
    export async function saveInvitationInTransaction() {}
    export async function settleInvitationForActivatedUser() {}
  `
}

function adminRegistrationInvitationStoreMock() {
  return `
    export class AdminRegistrationInvitationError extends Error {
      constructor() { super('管理员邀请码无效。'); this.code = 'invalid_invite_code' }
    }
    export function normalizeAdminRegistrationInviteCode() { return null }
    export async function validateAdminRegistrationInvitation() { throw new AdminRegistrationInvitationError() }
    export async function saveRegistrationWithAdminInvitation() {}
    export async function consumeAdminRegistrationInvitationInTransaction() {}
    export async function userRegisteredWithAdminInvitation() { return false }
  `
}

function registrationSettingsStoreMock() {
  return `
    export async function getRegistrationSettings() {
      return globalThis.__authSecurityRegistrationSettings ?? {
        email_verification_required: false,
        invite_code_required: false,
        brevo_quota_action: 'pause_registration',
        admin_invite_email_reserve: 0,
        password_reset_email_reserve: 0,
      }
    }
  `
}

function emailMock() {
  return `
    export class BrevoDailyQuotaExceededError extends Error {
      constructor(quotaDate = '2026-07-21', retryAfterSeconds = 3600, reason = 'daily_limit') {
        super('quota reached')
        this.code = 'brevo_daily_limit_reached'
        this.quotaDate = quotaDate
        this.retryAfterSeconds = retryAfterSeconds
        this.reason = reason
      }
    }
    export async function reserveEmailVerificationDelivery() {
      globalThis.__authSecurityEmailReserveCalls = (globalThis.__authSecurityEmailReserveCalls ?? 0) + 1
      if (globalThis.__authSecurityBrevoQuotaReached) throw new BrevoDailyQuotaExceededError()
      return { id: 'reservation', quotaDate: '2026-07-21', purpose: 'email_verification' }
    }
    export async function reservePasswordResetDelivery() {
      globalThis.__authSecurityEmailReserveCalls = (globalThis.__authSecurityEmailReserveCalls ?? 0) + 1
      if (globalThis.__authSecurityBrevoQuotaReached) throw new BrevoDailyQuotaExceededError()
      return { id: 'password-reset-reservation', quotaDate: '2026-07-21', purpose: 'password_reset' }
    }
    export async function releaseEmailDeliveryReservation() {
      globalThis.__authSecurityEmailReleaseCalls = (globalThis.__authSecurityEmailReleaseCalls ?? 0) + 1
    }
    export async function sendPasswordResetEmail() {}
    export async function sendEmailVerificationEmail() {
      globalThis.__authSecurityEmailSendCalls = (globalThis.__authSecurityEmailSendCalls ?? 0) + 1
      if (globalThis.__authSecurityEmailSendFailure) throw new Error('simulated email delivery failure')
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
    external: ['@node-rs/argon2', 'pg'],
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
    external: ['@node-rs/argon2', 'pg'],
    plugins,
    logLevel: 'silent',
  })
  const bundledCode = result.outputFiles[0]?.text
  if (!bundledCode) throw new Error(`Failed to bundle inline module ${name}`)
  await writeFile(outputPath, bundledCode, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`)
}
