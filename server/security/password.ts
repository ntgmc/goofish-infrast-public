import {
  Algorithm,
  Version,
  hash as argon2Hash,
  verify as argon2Verify,
} from '@node-rs/argon2'
import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'

export const MAX_ACTIVE_PASSWORD_JOBS = 2
export const MAX_QUEUED_PASSWORD_JOBS = 32

const LEGACY_PBKDF2_DIGEST = 'sha256'
const LEGACY_PBKDF2_MAX_ITERATIONS = 1_000_000
const ARGON2_MEMORY_COST_KIB = 19_456
const ARGON2_TIME_COST = 2
const ARGON2_PARALLELISM = 1
const PASSWORD_HASH_BYTES = 32
const PASSWORD_SALT_BYTES = 16
const ARGON2_VERSION = 19
const DUMMY_PASSWORD_RECORD: PasswordHashRecord = Object.freeze({
  password_hash: '$argon2id$v=19$m=19456,t=2,p=1$QkJCQkJCQkJCQkJCQkJCQg$X/f/OL0vpqJp6AniVvWkTTuPcr/CwRnWrNqoQuPqlQo',
  salt: '42424242424242424242424242424242',
  iterations: ARGON2_TIME_COST,
  password_algorithm: 'argon2id',
})
const passwordWorkQueue: Array<() => void> = []
let activePasswordJobs = 0

export type PasswordAlgorithm = 'pbkdf2-sha256' | 'argon2id'

export type PasswordHashRecord = {
  password_hash: string
  salt: string
  iterations: number
  password_algorithm?: PasswordAlgorithm
}

export type PasswordVerificationResult = {
  verified: boolean
  needsRehash: boolean
}

export class PasswordWorkCapacityError extends Error {
  constructor() {
    super('Password work queue is full')
    this.name = 'PasswordWorkCapacityError'
  }
}

export async function createPasswordHash(password: string): Promise<PasswordHashRecord> {
  const salt = randomBytes(PASSWORD_SALT_BYTES)
  const passwordHash = await runPasswordWork(() => argon2Hash(password, {
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
    outputLen: PASSWORD_HASH_BYTES,
    salt,
  }))
  return {
    password_hash: passwordHash,
    salt: salt.toString('hex'),
    iterations: ARGON2_TIME_COST,
    password_algorithm: 'argon2id',
  }
}

export async function verifyPasswordHash(
  password: string,
  record: PasswordHashRecord,
): Promise<PasswordVerificationResult> {
  const algorithm = passwordAlgorithm(record)
  if (algorithm === 'argon2id') {
    const parsed = parseArgon2Phc(record.password_hash)
    if (!parsed) return invalidPasswordResult()
    const verified = await runPasswordWork(async () => {
      try {
        return await argon2Verify(record.password_hash, password)
      } catch {
        return false
      }
    })
    return {
      verified,
      needsRehash: verified && !isCurrentArgon2Hash(record, parsed),
    }
  }
  if (algorithm !== 'pbkdf2-sha256' || !isValidLegacyPbkdf2Record(record)) {
    return invalidPasswordResult()
  }

  const actual = await deriveLegacyPbkdf2(password, record.salt, record.iterations)
  const expected = Buffer.from(record.password_hash, 'hex')
  const verified = actual.length === expected.length && timingSafeEqual(actual, expected)
  return { verified, needsRehash: verified }
}

export async function verifyPasswordHashOrDummy(
  password: string,
  record: PasswordHashRecord | null | undefined,
): Promise<PasswordVerificationResult> {
  const result = await verifyPasswordHash(password, record ?? DUMMY_PASSWORD_RECORD)
  return record ? result : invalidPasswordResult()
}

export function constantTimeSecretEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

function deriveLegacyPbkdf2(password: string, salt: string, iterations: number): Promise<Buffer> {
  return runPasswordWork(() => new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, PASSWORD_HASH_BYTES, LEGACY_PBKDF2_DIGEST, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  }))
}

function passwordAlgorithm(record: PasswordHashRecord): PasswordAlgorithm | null {
  if (record.password_algorithm === 'argon2id' || record.password_algorithm === 'pbkdf2-sha256') {
    return record.password_algorithm
  }
  if (record.password_algorithm !== undefined) return null
  if (typeof record.password_hash !== 'string') return null
  return record.password_hash.startsWith('$argon2id$') ? 'argon2id' : 'pbkdf2-sha256'
}

function isValidLegacyPbkdf2Record(record: PasswordHashRecord): boolean {
  return typeof record.password_hash === 'string'
    && typeof record.salt === 'string'
    && /^[a-f0-9]{64}$/i.test(record.password_hash)
    && /^[a-f0-9]{32}$/i.test(record.salt)
    && Number.isSafeInteger(record.iterations)
    && record.iterations > 0
    && record.iterations <= LEGACY_PBKDF2_MAX_ITERATIONS
}

type ParsedArgon2Phc = {
  version: number
  memoryCost: number
  timeCost: number
  parallelism: number
  salt: Buffer
  hash: Buffer
}

function parseArgon2Phc(value: unknown): ParsedArgon2Phc | null {
  if (typeof value !== 'string') return null
  const parts = value.split('$')
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id') return null
  const versionMatch = /^v=(\d+)$/.exec(parts[2])
  const parameterMatch = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3])
  if (!versionMatch || !parameterMatch || !parts[4] || !parts[5]) return null

  const version = Number(versionMatch[1])
  const memoryCost = Number(parameterMatch[1])
  const timeCost = Number(parameterMatch[2])
  const parallelism = Number(parameterMatch[3])
  const salt = decodePhcBase64(parts[4])
  const hash = decodePhcBase64(parts[5])
  if (
    !salt
    || !hash
    || !Number.isSafeInteger(version)
    || (version !== 16 && version !== 19)
    || !Number.isSafeInteger(memoryCost)
    || memoryCost < 8
    || memoryCost > 262_144
    || !Number.isSafeInteger(timeCost)
    || timeCost < 1
    || timeCost > 10
    || !Number.isSafeInteger(parallelism)
    || parallelism < 1
    || parallelism > 4
    || salt.length < 8
    || salt.length > 64
    || hash.length < 16
    || hash.length > 64
  ) return null

  return { version, memoryCost, timeCost, parallelism, salt, hash }
}

function decodePhcBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) return null
  const decoded = Buffer.from(value, 'base64')
  return decoded.length > 0 ? decoded : null
}

function isCurrentArgon2Hash(record: PasswordHashRecord, parsed: ParsedArgon2Phc): boolean {
  const recordSalt = typeof record.salt === 'string' && /^[a-f0-9]{32}$/i.test(record.salt)
    ? Buffer.from(record.salt, 'hex')
    : null
  return record.password_algorithm === 'argon2id'
    && record.iterations === ARGON2_TIME_COST
    && parsed.version === ARGON2_VERSION
    && parsed.memoryCost === ARGON2_MEMORY_COST_KIB
    && parsed.timeCost === ARGON2_TIME_COST
    && parsed.parallelism === ARGON2_PARALLELISM
    && parsed.hash.length === PASSWORD_HASH_BYTES
    && Boolean(recordSalt && recordSalt.equals(parsed.salt))
}

function invalidPasswordResult(): PasswordVerificationResult {
  return { verified: false, needsRehash: false }
}

async function runPasswordWork<T>(work: () => Promise<T>): Promise<T> {
  await acquirePasswordWorkSlot()
  try {
    return await work()
  } finally {
    releasePasswordWorkSlot()
  }
}

function acquirePasswordWorkSlot(): Promise<void> {
  if (activePasswordJobs < MAX_ACTIVE_PASSWORD_JOBS) {
    activePasswordJobs += 1
    return Promise.resolve()
  }
  if (passwordWorkQueue.length >= MAX_QUEUED_PASSWORD_JOBS) {
    return Promise.reject(new PasswordWorkCapacityError())
  }
  return new Promise((resolve) => passwordWorkQueue.push(resolve))
}

function releasePasswordWorkSlot(): void {
  const next = passwordWorkQueue.shift()
  if (next) {
    next()
    return
  }
  activePasswordJobs -= 1
}
