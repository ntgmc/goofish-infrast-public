import { createHash, createHmac } from 'node:crypto'
import type { OptimizeResult } from '../../src/lib/types'
import { getRequestClientIp } from '../security/client-ip'
import { hasDatabaseUrl } from '../storage/postgres'
import {
  getTrackedGenerationEvent,
  insertBehaviorRiskEvent,
  runBehaviorRiskEvaluation,
  type BehaviorRiskEventInput,
} from '../storage/behavior-risk-store'
import type { AuthContext } from '../handlers/user-auth'
import type { BehaviorRiskEventType, BehaviorRiskPageCategory } from './scoring'

const BEHAVIOR_RISK_BROWSER_HEADER = 'X-Maa-Behavior-Instance'
const DEFAULT_KEY_VERSION = 'v1'
const EVALUATION_DELAY_MS = 5_000

let evaluationTimer: ReturnType<typeof setTimeout> | null = null
let missingSecretWarned = false

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
  if (!keyring || !hasDatabaseUrl()) return false
  const signals = requestSignals(input.req, input.sessionTokenHash ?? null, keyring)
  return safelyInsert({
    eventKey: input.eventKey,
    eventType: input.eventType,
    userId: input.userId,
    profileId: input.profileId,
    jobId: input.jobId,
    uidHmac: input.uid ? hashSignal(keyring, 'uid', input.uid.trim()) : null,
    outputHash: input.outputHash,
    pageCategory: input.pageCategory,
    optimizerVersion: input.optimizerVersion,
    structureSummary: input.structureSummary,
    activityClaimedAt: input.activityClaimedAt,
    declarationVersion: input.declarationVersion,
    declarationAcceptedAt: input.declarationAcceptedAt,
    occurredAt: input.occurredAt,
    keyVersion: keyring.version,
    ...signals,
  }, shouldEvaluateImmediately(input.eventType))
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
  return safelyInsert({
    eventKey: `generate:${input.jobId}`,
    eventType: 'generate',
    userId: input.userId,
    profileId: input.profileId,
    jobId: input.jobId,
    uidHmac: input.uid ? hashSignal(keyring, 'uid', input.uid.trim()) : null,
    outputHash: createHash('sha256').update(bytes, 'utf8').digest('hex'),
    keyVersion: keyring.version,
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
    keyVersion: keyring.version,
    occurredAt,
  }, false)
}

function requestSignals(
  req: Request,
  sessionTokenHash: string | null,
  keyring: { secret: string; version: string },
): Pick<BehaviorRiskEventInput, 'browserHmac' | 'sessionHmac' | 'networkHmac' | 'uaHmac'> {
  const browserInstance = normalizeBrowserInstance(req.headers.get(BEHAVIOR_RISK_BROWSER_HEADER))
  const clientIp = getRequestClientIp(req)
  const userAgent = req.headers.get('user-agent')?.trim() ?? ''
  return {
    browserHmac: browserInstance ? hashSignal(keyring, 'browser', browserInstance) : null,
    sessionHmac: sessionTokenHash ? hashSignal(keyring, 'session', sessionTokenHash) : null,
    networkHmac: clientIp !== 'unknown' ? hashSignal(keyring, 'network', clientIp) : null,
    uaHmac: userAgent ? hashSignal(keyring, 'ua', userAgent) : null,
  }
}

function getBehaviorRiskKeyring(): { secret: string; version: string } | null {
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
  return { secret, version: process.env.BEHAVIOR_RISK_HMAC_KEY_VERSION?.trim() || DEFAULT_KEY_VERSION }
}

function hashSignal(keyring: { secret: string; version: string }, namespace: string, value: string): string {
  return createHmac('sha256', keyring.secret).update(`${keyring.version}:${namespace}:${value}`).digest('hex')
}

function normalizeBrowserInstance(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim()
  return /^[A-Za-z0-9_-]{16,128}$/.test(normalized) ? normalized : null
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
