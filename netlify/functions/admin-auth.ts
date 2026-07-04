import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { requireEnv } from './license-utils'
import { createPostgresAdminUserStore } from '../../server/storage/admin-user-store'

export interface AdminUserRecord {
  version: 1;
  username: string;
  password_hash: string;
  salt: string;
  iterations: number;
  created_at: string;
  updated_at: string;
}

interface AdminUserStore {
  get: (username: string) => Promise<AdminUserRecord | null>;
  set: (username: string, user: AdminUserRecord) => Promise<void>;
  delete: (username: string) => Promise<void>;
  list: () => Promise<AdminUserRecord[]>;
}

const PASSWORD_ITERATIONS = 120_000
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

export async function authenticateAdminRequest(req: Request, body?: { admin_password?: unknown; admin_user?: unknown }): Promise<boolean> {
  const rootPassword = requireEnv('MAA_ADMIN_PASSWORD')
  const headerPassword = req.headers.get('X-Admin-Password') ?? ''
  const bodyPassword = typeof body?.admin_password === 'string' ? body.admin_password : ''
  const headerUser = req.headers.get('X-Admin-User') ?? ''
  const bodyUser = typeof body?.admin_user === 'string' ? body.admin_user : ''

  if (!headerUser && !bodyUser && (headerPassword === rootPassword || bodyPassword === rootPassword)) {
    return true
  }

  const username = normalizeUsername(headerUser || bodyUser)
  const password = headerPassword || bodyPassword
  if (!username || !password) return false
  return verifyAdminUser(username, password)
}

export async function requireRootAdminPassword(value: unknown): Promise<boolean> {
  return typeof value === 'string' && value === requireEnv('MAA_ADMIN_PASSWORD')
}

export async function createAdminUser(usernameValue: unknown, passwordValue: unknown): Promise<{ ok: true; user: AdminUserRecord } | { ok: false; message: string }> {
  const username = normalizeUsername(usernameValue)
  if (!username) return { ok: false, message: '账号名需为 3-32 位字母、数字、下划线或短横线。' }
  if (typeof passwordValue !== 'string' || passwordValue.length < 8) {
    return { ok: false, message: '账号密码至少需要 8 位。' }
  }

  const now = new Date().toISOString()
  const salt = randomBytes(16).toString('hex')
  const user: AdminUserRecord = {
    version: 1,
    username,
    password_hash: hashPassword(passwordValue, salt, PASSWORD_ITERATIONS),
    salt,
    iterations: PASSWORD_ITERATIONS,
    created_at: now,
    updated_at: now,
  }
  const store = await getAdminUserStore()
  await store.set(username, user)
  return { ok: true, user }
}

export async function listAdminUsers(): Promise<Array<Pick<AdminUserRecord, 'username' | 'created_at' | 'updated_at'>>> {
  const store = await getAdminUserStore()
  return (await store.list())
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(({ username, created_at, updated_at }) => ({ username, created_at, updated_at }))
}

export async function deleteAdminUser(usernameValue: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const username = normalizeUsername(usernameValue)
  if (!username) return { ok: false, message: '账号名格式不正确。' }
  const store = await getAdminUserStore()
  await store.delete(username)
  return { ok: true }
}

async function verifyAdminUser(username: string, password: string): Promise<boolean> {
  const store = await getAdminUserStore()
  const user = await store.get(username)
  if (!user) return false
  const actual = Buffer.from(hashPassword(password, user.salt, user.iterations), 'hex')
  const expected = Buffer.from(user.password_hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function hashPassword(password: string, salt: string, iterations: number): string {
  return pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex')
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const username = value.trim()
  return USERNAME_PATTERN.test(username) ? username : null
}

async function getAdminUserStore(): Promise<AdminUserStore> {
  return createPostgresAdminUserStore()
}
