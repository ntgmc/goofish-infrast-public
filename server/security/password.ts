import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'

export const PASSWORD_ITERATIONS = 120_000
export const MAX_ACTIVE_PASSWORD_JOBS = 2
export const MAX_QUEUED_PASSWORD_JOBS = 32

const PASSWORD_HASH_BYTES = 32
const PASSWORD_DIGEST = 'sha256'
const passwordWorkQueue: Array<() => void> = []
let activePasswordJobs = 0

export type PasswordHashRecord = {
  password_hash: string
  salt: string
  iterations: number
}

export class PasswordWorkCapacityError extends Error {
  constructor() {
    super('Password work queue is full')
    this.name = 'PasswordWorkCapacityError'
  }
}

export async function createPasswordHash(password: string): Promise<PasswordHashRecord> {
  const salt = randomBytes(16).toString('hex')
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS)
  return {
    password_hash: derived.toString('hex'),
    salt,
    iterations: PASSWORD_ITERATIONS,
  }
}

export async function verifyPasswordHash(password: string, record: PasswordHashRecord): Promise<boolean> {
  const actual = await derivePassword(password, record.salt, record.iterations)
  const expected = Buffer.from(record.password_hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function constantTimeSecretEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

function derivePassword(password: string, salt: string, iterations: number): Promise<Buffer> {
  return runPasswordWork(() => new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, PASSWORD_HASH_BYTES, PASSWORD_DIGEST, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  }))
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
