import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { OptimizeResult } from '../../src/lib/types'
import { getRequestClientIp } from '../security/client-ip'
import { hasDatabaseUrl } from '../storage/postgres'
import {
  getTrackedGenerationEvent,
  insertBehaviorRiskEvent,
  insertBehaviorRiskEventInTransaction,
  recordBehaviorRiskCollectionStatus,
  runBehaviorRiskEvaluation,
  type BehaviorRiskEventInput,
} from '../storage/behavior-risk-store'
import type { AuthContext } from '../handlers/user-auth'
import type { BehaviorRiskEventType, BehaviorRiskPageCategory } from './scoring'

const BEHAVIOR_RISK_DEVICE_COOKIE = 'maa_behavior_device'
const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
const DEVICE_COOKIE_CLOCK_SKEW_MS = 5 * 60_000
const DEFAULT_KEY_VERSION = 'v1'
const EVALUATION_DELAY_MS = 5_000

let evaluationTimer: ReturnType<typeof setTimeout> | null = null
let missingSecretWarned = false

type BehaviorRiskHmacKey = { secret: string; version: string }
type BehaviorRiskKeyring = { current: BehaviorRiskHmacKey; previous: BehaviorRiskHmacKey | null }

export async function recordRequestBehaviorEvent(input: {
  req: Request
  eventType: BehaviorRiskEventType
  userId: string
  sessionTokenHash?: string | null
  profileId?: string | null
  jobId?: string | null
  uid?: string | null
  outputHash?: string | null
  pageCategory?: BehaviorRiskPageCategory | null
  eventKey?: string | null
  optimizerVersion?: string | null
  structureSummary?: Record<string, unknown> | null
  activityClaimedAt?: string | null
  declarationVersion?: string | null
  declarationAcceptedAt?: string | null
  occurredAt?: Date
}): Promise<boolean> {
  const keyring = getBehaviorRiskKeyring()
  if (!hasDatabaseUrl()) return false
  if (!keyring) {
    await recordBehaviorRiskCollectionStatus('disabled').catch(() => undefined)
    return false
  }
  return safelyInsert(buildRequestBehaviorRiskEvent(input, keyring), shouldEvaluateImmediately(input.eventType))
}

export async function recordRequestBehaviorEventInTransaction(
  client: Pick<PoolClient, 'query'>,
  input: Parameters<typeof recordRequestBehaviorEvent>[0],
): Promise<boolean> {
  const keyring = getBehaviorRiskKeyring()
  if (!keyring || !hasDatabaseUrl()) return false
  const inserted = await insertBehaviorRiskEventInTransaction(client, buildRequestBehaviorRiskEvent(input, keyring))
  if (inserted && shouldEvaluateImmediately(input.eventType)) queueBehaviorRiskEvaluation()
  return inserted
}

function buildRequestBehaviorRiskEvent(
  input: Parameters<typeof recordRequestBehaviorEvent>[0],
  keyring: BehaviorRiskKeyring,
): BehaviorRiskEventInput {
  const signals = requestSignals(input.req, input.sessionTokenHash ?? null, keyring)
  const uidSignal = input.uid ? hashSignalSet(keyring, 'uid', input.uid.trim()) : null
  return {
    eventKey: input.eventKey,
    eventType: input.eventType,
    userId: input.userId,
    profileId: input.profileId,
    jobId: input.jobId,
    uidHmac: uidSignal?.primary ?? null,
    outputHash: input.outputHash,
    pageCategory: input.pageCategory,
    optimizerVersion: input.optimizerVersion,
    structureSummary: input.structureSummary,
    activityClaimedAt: input.activityClaimedAt,
    declarationVersion: input.declarationVersion,
    declarationAcceptedAt: input.declarationAcceptedAt,
    occurredAt: input.occurredAt,
    keyVersion: keyring.current.version,
    ...signals,
    signalAliases: mergeSignalAliases(signals.signalAliases, uidSignal ? { uid: uidSignal.aliases } : null),
  }
}

export async function recordAuthenticatedRequestBehaviorEvent(input: {
  req: Request
  auth: AuthContext
  eventType: BehaviorRiskEventType
  profileId?: string | null
  jobId?: string | null
  uid?: string | null
  outputHash?: string | null
  pageCategory?: BehaviorRiskPageCategory | null
  eventKey?: string | null
  optimizerVersion?: string | null
  structureSummary?: Record<string, unknown> | null
  activityClaimedAt?: string | null
  declarationVersion?: string | null
  declarationAcceptedAt?: string | null
  occurredAt?: Date
}): Promise<boolean> {
  return recordRequestBehaviorEvent({
    ...input,
    userId: input.auth.user.id,
    sessionTokenHash: input.auth.tokenHash,
  })
}

export async function recordGeneratedBehaviorEvent(input: {
  userId: string
  profileId: string
  jobId: string
  uid?: string | null
  result: OptimizeResult
  occurredAt?: Date
}): Promise<boolean> {
  const keyring = getBehaviorRiskKeyring()
  if (!keyring || !hasDatabaseUrl()) return false
  const bytes = JSON.stringify(input.result, null, 2)
  const buildMeta = input.result.build_meta
  const optimizerVersion = buildMeta
    ? [buildMeta.frontend_version, buildMeta.backend_version, buildMeta.data_version, buildMeta.git_sha].filter(Boolean).join(':')
    : 'unknown'
  const uidSignal = input.uid ? hashSignalSet(keyring, 'uid', input.uid.trim()) : null
  return safelyInsert({
    eventKey: `generate:${input.jobId}`,
    eventType: 'generate',
    userId: input.userId,
    profileId: input.profileId,
    jobId: input.jobId,
    uidHmac: uidSignal?.primary ?? null,
    outputHash: createHash('sha256').update(bytes, 'utf8').digest('hex'),
    keyVersion: keyring.current.version,
    signalAliases: uidSignal ? { uid: uidSignal.aliases } : null,
    optimizerVersion,
    structureSummary: buildIdentityFreeStructureSummary(input.result),
    occurredAt: input.occurredAt,
  }, true)
}

export async function recordOperatorDataAnomalyBehaviorEvent(input: {
  req: Request
  auth: AuthContext
  profileId: string
  uid?: string | null
  anomalyType: string
  fingerprintHash: string
  ownedCount: number
  occurredAt?: Date
}): Promise<boolean> {
  const anomalyType = /^[a-z0-9_]{1,64}$/.test(input.anomalyType) ? input.anomalyType : 'operator_data_anomaly'
  const fingerprintHash = /^[a-f0-9]{64}$/i.test(input.fingerprintHash) ? input.fingerprintHash.toLowerCase() : null
  if (!fingerprintHash) return false
  const occurredAt = input.occurredAt ?? new Date()
  const bucket = Math.floor(occurredAt.getTime() / (5 * 60_000))
  return recordAuthenticatedRequestBehaviorEvent({
    req: input.req,
    auth: input.auth,
    eventType: 'operator_data_anomaly',
    profileId: input.profileId,
    uid: input.uid,
    eventKey: `operator-data-anomaly:${input.auth.user.id}:${input.profileId}:${fingerprintHash}:${bucket}`,
    structureSummary: {
      anomaly_type: anomalyType,
      operator_fingerprint_hash: fingerprintHash,
      owned_count: Math.max(0, Math.trunc(input.ownedCount)),
    },
    occurredAt,
  })
}

export async function recordTrackedExportBehaviorEvent(input: {
  req: Request
  auth: AuthContext
  profileId: string
  jobId: string
  uid?: string | null
  result: unknown
  eventKey: string
  activityClaimedAt?: string | null
  declarationVersion?: string | null
  declarationAcceptedAt?: string | null
  occurredAt?: Date
}): Promise<boolean> {
  const tracked = await getTrackedGenerationEvent(input.auth.user.id, input.profileId, input.jobId).catch(() => null)
  if (!tracked) return false
  const outputHash = createHash('sha256').update(JSON.stringify(input.result, null, 2), 'utf8').digest('hex')
  return recordAuthenticatedRequestBehaviorEvent({
    req: input.req,
    auth: input.auth,
    eventType: 'export',
    profileId: input.profileId,
    jobId: input.jobId,
    uid: input.uid,
    outputHash,
    eventKey: input.eventKey,
    optimizerVersion: tracked.optimizer_version,
    structureSummary: tracked.structure_summary,
    activityClaimedAt: input.activityClaimedAt,
    declarationVersion: input.declarationVersion,
    declarationAcceptedAt: input.declarationAcceptedAt,
    occurredAt: input.occurredAt,
  })
}

export async function recordAccountDeletedBehaviorEvent(userId: string, occurredAt = new Date()): Promise<boolean> {
  const keyring = getBehaviorRiskKeyring()
  if (!keyring || !hasDatabaseUrl()) return false
  return safelyInsert({
    eventKey: `account-deleted:${userId}`,
    eventType: 'account_deleted',
    userId,
    keyVersion: keyring.current.version,
    occurredAt,
  }, false)
}

function requestSignals(
  req: Request,
  sessionTokenHash: string | null,
  keyring: BehaviorRiskKeyring,
): Pick<BehaviorRiskEventInput, 'browserHmac' | 'sessionHmac' | 'networkHmac' | 'uaHmac' | 'signalAliases'> {
  const browserInstance = readBehaviorRiskDeviceCookie(req, keyring)?.deviceId ?? null
  const clientIp = getRequestClientIp(req)
  const userAgent = req.headers.get('user-agent')?.trim() ?? ''
  const browserSignal = browserInstance ? hashSignalSet(keyring, 'browser', browserInstance) : null
  const sessionSignal = sessionTokenHash ? hashSignalSet(keyring, 'session', sessionTokenHash) : null
  const networkSignal = clientIp !== 'unknown' ? hashSignalSet(keyring, 'network', clientIp) : null
  const uaSignal = userAgent ? hashSignalSet(keyring, 'ua', userAgent) : null
  return {
    browserHmac: browserSignal?.primary ?? null,
    sessionHmac: sessionSignal?.primary ?? null,
    networkHmac: networkSignal?.primary ?? null,
    uaHmac: uaSignal?.primary ?? null,
    signalAliases: mergeSignalAliases(
      browserSignal ? { browser: browserSignal.aliases } : null,
      sessionSignal ? { session: sessionSignal.aliases } : null,
      networkSignal ? { network: networkSignal.aliases } : null,
      uaSignal ? { ua: uaSignal.aliases } : null,
    ),
  }
}

function getBehaviorRiskKeyring(): BehaviorRiskKeyring | null {
  const secret = process.env.BEHAVIOR_RISK_HMAC_SECRET?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && !missingSecretWarned) {
      missingSecretWarned = true
      console.warn('[behavior-risk] event collection disabled because BEHAVIOR_RISK_HMAC_SECRET is not configured')
    }
    return null
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    if (!missingSecretWarned) {
      missingSecretWarned = true
      console.warn('[behavior-risk] event collection disabled because BEHAVIOR_RISK_HMAC_SECRET is too short')
    }
    return null
  }
  const current: BehaviorRiskHmacKey = {
    secret,
    version: normalizeKeyVersion(process.env.BEHAVIOR_RISK_HMAC_KEY_VERSION) ?? DEFAULT_KEY_VERSION,
  }
  const previousSecret = process.env.BEHAVIOR_RISK_HMAC_PREVIOUS_SECRET?.trim()
  const previousVersion = normalizeKeyVersion(process.env.BEHAVIOR_RISK_HMAC_PREVIOUS_KEY_VERSION)
  const previous = previousSecret && previousVersion && previousVersion !== current.version
    && (process.env.NODE_ENV !== 'production' || previousSecret.length >= 32)
    ? { secret: previousSecret, version: previousVersion }
    : null
  return { current, previous }
}

function hashSignal(key: BehaviorRiskHmacKey, namespace: string, value: string): string {
  return createHmac('sha256', key.secret).update(`${key.version}:${namespace}:${value}`).digest('hex')
}

function hashSignalSet(
  keyring: BehaviorRiskKeyring,
  namespace: string,
  value: string,
): { primary: string; aliases: string[] } {
  const primary = hashSignal(keyring.current, namespace, value)
  const aliases = keyring.previous
    ? [primary, hashSignal(keyring.previous, namespace, value)]
    : [primary]
  return { primary, aliases }
}

function mergeSignalAliases(
  ...sources: Array<BehaviorRiskEventInput['signalAliases'] | null | undefined>
): BehaviorRiskEventInput['signalAliases'] {
  const merged: NonNullable<BehaviorRiskEventInput['signalAliases']> = {}
  for (const source of sources) {
    if (!source) continue
    for (const namespace of ['browser', 'session', 'network', 'ua', 'uid'] as const) {
      if (source[namespace]?.length) merged[namespace] = [...new Set([...(merged[namespace] ?? []), ...source[namespace]!])]
    }
  }
  return Object.keys(merged).length > 0 ? merged : null
}

export function ensureBehaviorRiskDeviceCookie(req: Request, now = new Date()): string | null {
  const keyring = getBehaviorRiskKeyring()
  if (!keyring) return null
  const existing = readBehaviorRiskDeviceCookie(req, keyring, now)
  if (existing?.keyVersion === keyring.current.version) return null
  const deviceId = existing?.deviceId ?? randomBytes(24).toString('base64url')
  const issuedAt = Math.floor(now.getTime() / 1000)
  const payload = `${deviceId}.${issuedAt}.${keyring.current.version}`
  const signature = signDeviceCookie(keyring.current, payload)
  return `${BEHAVIOR_RISK_DEVICE_COOKIE}=${payload}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

function readBehaviorRiskDeviceCookie(
  req: Request,
  keyring: BehaviorRiskKeyring,
  now = new Date(),
): { deviceId: string; keyVersion: string } | null {
  const raw = readCookie(req.headers.get('cookie'), BEHAVIOR_RISK_DEVICE_COOKIE)
  if (!raw) return null
  const [deviceId, issuedAtValue, keyVersion, signature, ...extra] = raw.split('.')
  if (extra.length > 0 || !deviceId || !issuedAtValue || !keyVersion || !signature) return null
  if (!/^[A-Za-z0-9_-]{32}$/.test(deviceId) || !/^\d{1,12}$/.test(issuedAtValue)) return null
  const issuedAtMs = Number(issuedAtValue) * 1000
  if (!Number.isSafeInteger(issuedAtMs)
    || issuedAtMs > now.getTime() + DEVICE_COOKIE_CLOCK_SKEW_MS
    || issuedAtMs < now.getTime() - DEVICE_COOKIE_MAX_AGE_SECONDS * 1000) return null
  const key = [keyring.current, keyring.previous].find((candidate) => candidate?.version === keyVersion)
  if (!key) return null
  const expected = signDeviceCookie(key, `${deviceId}.${issuedAtValue}.${keyVersion}`)
  if (!safeEqual(signature, expected)) return null
  return { deviceId, keyVersion }
}

function signDeviceCookie(key: BehaviorRiskHmacKey, payload: string): string {
  return createHmac('sha256', key.secret).update(`device-cookie:${payload}`).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function readCookie(header: string | null, name: string): string | null {
  const match = (header ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function normalizeKeyVersion(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return /^[A-Za-z0-9._-]{1,32}$/.test(normalized) ? normalized : null
}

function buildIdentityFreeStructureSummary(result: OptimizeResult): Record<string, unknown> {
  const planShapes = (Array.isArray(result.plans) ? result.plans : []).map((plan) => {
    const roomGroups = Object.values(plan.rooms ?? {})
    return {
      room_group_count: roomGroups.length,
      room_counts: roomGroups.map((rooms) => Array.isArray(rooms) ? rooms.length : 0).sort((left, right) => left - right),
    }
  })
  const totalHours = typeof result.total_schedule_hours === 'number' ? result.total_schedule_hours : null
  const durationBucket = totalHours === null ? 'unknown' : totalHours <= 8 ? '0-8h' : totalHours <= 12 ? '9-12h' : totalHours <= 24 ? '13-24h' : '24h+'
  return {
    schedule_mode: result.schedule_mode ?? 'maa',
    plan_count: planShapes.length,
    shift_count: Array.isArray(result.shift_hours) ? result.shift_hours.length : planShapes.length,
    duration_bucket: durationBucket,
    topology_hash: createHash('sha256').update(JSON.stringify(planShapes)).digest('hex'),
  }
}

async function safelyInsert(input: BehaviorRiskEventInput, evaluate: boolean): Promise<boolean> {
  try {
    const inserted = await insertBehaviorRiskEvent(input)
    if (inserted && evaluate) queueBehaviorRiskEvaluation()
    return inserted
  } catch (error) {
    await recordBehaviorRiskCollectionStatus('failed').catch(() => undefined)
    console.warn('[behavior-risk] event recording skipped:', error instanceof Error ? error.message : 'unknown error')
    return false
  }
}

function queueBehaviorRiskEvaluation(): void {
  if (evaluationTimer) return
  evaluationTimer = setTimeout(() => {
    evaluationTimer = null
    void runBehaviorRiskEvaluation().catch((error) => {
      console.warn('[behavior-risk] evaluation skipped:', error instanceof Error ? error.message : 'unknown error')
    })
  }, EVALUATION_DELAY_MS)
  evaluationTimer.unref?.()
}

function shouldEvaluateImmediately(eventType: BehaviorRiskEventType): boolean {
  return eventType === 'register'
    || eventType === 'activation'
    || eventType === 'bind'
    || eventType === 'export'
    || eventType === 'operator_data_anomaly'
}
