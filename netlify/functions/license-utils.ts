import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LicenseConfig, LicenseFile, LicenseOperator, PermissionMode } from '../../src/lib/types'

const OBFUSCATE_KEY_SEED = 'maa-obfuscate-v1'
const REQUIRED_OPERATOR_KEYS = ['id', 'name', 'own', 'elite', 'rarity'] as const

installUnhandledRejectionLogger()

export interface CdkRecord {
  version: 1;
  code_hash: string;
  permission: PermissionMode;
  status: 'unused' | 'used';
  created_at: string;
  used_at: string | null;
  order_note: string | null;
  license_order_hash: string | null;
  operator_count: number | null;
  config_desc: string | null;
}

export interface CdkRecordStore {
  get: (key: string) => Promise<CdkRecord | null>;
  set: (key: string, record: CdkRecord) => Promise<void>;
}

function installUnhandledRejectionLogger(): void {
  const marker = '__maaUnhandledRejectionLoggerInstalled'
  const globalWithMarker = globalThis as unknown as Record<string, boolean>
  if (globalWithMarker[marker]) return
  globalWithMarker[marker] = true
  process.on('unhandledRejection', (reason) => {
    console.error('unhandled function rejection:', formatUnknownError(reason))
  })
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function getCdkRecordStore(): Promise<CdkRecordStore> {
  if (hasNetlifyBlobsContext()) {
    const { getStore } = await import('@netlify/blobs')
    const store = getStore('maa-cdks')
    return {
      get: async (key) => await store.get(key, { type: 'json' }) as CdkRecord | null,
      set: async (key, record) => {
        await store.setJSON(key, record)
      },
    }
  }

  return {
    get: async (key) => readLocalCdkRecord(key),
    set: async (key, record) => writeLocalCdkRecord(key, record),
  }
}

function hasNetlifyBlobsContext(): boolean {
  if (process.env.NETLIFY_DEV || process.env.NODE_ENV === 'development') {
    return false
  }

  const globalContext = (globalThis as unknown as { netlifyBlobsContext?: unknown }).netlifyBlobsContext
  if (hasUsableBlobsContext(globalContext)) return true

  const encodedContext = process.env.NETLIFY_BLOBS_CONTEXT
  if (!encodedContext) return false
  try {
    const decoded = JSON.parse(Buffer.from(encodedContext, 'base64').toString('utf8')) as unknown
    return hasUsableBlobsContext(decoded)
  } catch {
    return false
  }
}

function hasUsableBlobsContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const context = value as Record<string, unknown>
  return typeof context.siteID === 'string' &&
    context.siteID.length > 0 &&
    typeof context.token === 'string' &&
    context.token.length > 0
}

function localCdkPath(key: string): string {
  const safeParts = key.split('/').filter((part) => part && part !== '.' && part !== '..')
  return join(process.cwd(), '.netlify', 'local-cdks', ...safeParts)
}

function readLocalCdkRecord(key: string): CdkRecord | null {
  const path = localCdkPath(key)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as CdkRecord
}

function writeLocalCdkRecord(key: string, record: CdkRecord): void {
  const path = localCdkPath(key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8')
}

export function requireEnv(name: string): string {
  const value = process.env[name] || readLocalEnv(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function readLocalEnv(name: string): string | undefined {
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) return undefined
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || match[1] !== name) continue
    return match[2].replace(/^["']|["']$/g, '')
  }
  return undefined
}

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj)
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']'
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort()
  return '{' + sortedKeys
    .map((key) => JSON.stringify(key) + ':' + canonicalJson((obj as Record<string, unknown>)[key]))
    .join(',') + '}'
}

export function generateCdk(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(12)
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
  return `MAA-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

export function hashCdk(code: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(normalizeCode(code))
    .digest('hex')
}

function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex')
}

function formatSig(hexDigest: string): string {
  return `skadi-${hexDigest.slice(0, 8)}-${hexDigest.slice(8, 16)}`
}

function encryptLicensePayload(payload: string): string {
  const key = createHash('sha256').update(OBFUSCATE_KEY_SEED).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'MAA-V1:' + Buffer.concat([iv, encrypted, tag]).toString('base64')
}

export function createSignedLicenseFile({
  adminSecret,
  operators,
  config,
  permission,
  codeHash,
}: {
  adminSecret: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  permission: PermissionMode;
  codeHash: string;
}): { license: LicenseFile; licenseFileContent: string } {
  const issuedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const orderHash = createHash('sha256')
    .update(`${codeHash}:${issuedAt}:${randomUUID()}`)
    .digest('hex')
    .slice(0, 16)

  const unsigned = {
    version: 1,
    order_hash: orderHash,
    operators,
    config,
    permission,
    issued_at: issuedAt,
  }
  const sig = formatSig(hmacSha256(adminSecret, canonicalJson(unsigned)))
  const license: LicenseFile = { ...unsigned, sig }
  const licenseFileContent = encryptLicensePayload(canonicalJson(license))
  return { license, licenseFileContent }
}

export function validateOperators(value: unknown): { ok: true; operators: LicenseOperator[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: '干员数据不能为空。' }
  }
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: `第 ${index + 1} 个干员不是对象。` }
    }
    const op = raw as Record<string, unknown>
    const missing = REQUIRED_OPERATOR_KEYS.filter((key) => !(key in op))
    if (missing.length > 0) {
      return { ok: false, message: `干员 ${String(op.name ?? index + 1)} 缺少字段: ${missing.join(', ')}。` }
    }
    if (typeof op.id !== 'string' || typeof op.name !== 'string' || typeof op.own !== 'boolean') {
      return { ok: false, message: `干员 ${String(op.name ?? index + 1)} 的 id/name/own 格式不正确。` }
    }
    if (!Number.isFinite(op.elite) || !Number.isFinite(op.rarity)) {
      return { ok: false, message: `干员 ${op.name} 的 elite/rarity 必须是数字。` }
    }
  }
  return { ok: true, operators: value as LicenseOperator[] }
}

export function validateConfig(value: unknown): { ok: true; config: LicenseConfig } | { ok: false; message: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: '基建配置不能为空。' }
  }
  const config = value as LicenseConfig
  if (!config.layout || !config.product_requirements) {
    return { ok: false, message: '基建配置缺少 layout 或 product_requirements。' }
  }
  if (
    !Number.isInteger(config.trading_stations_count) ||
    !Number.isInteger(config.manufacturing_stations_count)
  ) {
    return { ok: false, message: '贸易站和制造站数量必须是整数。' }
  }
  if (config.trading_stations_count < 1 || config.manufacturing_stations_count < 1) {
    return { ok: false, message: '贸易站和制造站数量必须大于 0。' }
  }
  if (config.trading_stations_count + config.manufacturing_stations_count !== 6) {
    return { ok: false, message: '贸易站 + 制造站需要等于 6。' }
  }
  const trading = config.product_requirements.trading_stations
  const manufacturing = config.product_requirements.manufacturing_stations
  if (!isCountRecord(trading) || !isCountRecord(manufacturing)) {
    return { ok: false, message: '产物数量格式不正确。' }
  }
  const tradingTotal = sumCounts(trading)
  if (tradingTotal !== config.trading_stations_count) {
    return { ok: false, message: `贸易产物数量合计为 ${tradingTotal}，需要等于 ${config.trading_stations_count}。` }
  }
  const manufacturingTotal = sumCounts(manufacturing)
  if (manufacturingTotal !== config.manufacturing_stations_count) {
    return { ok: false, message: `制造产物数量合计为 ${manufacturingTotal}，需要等于 ${config.manufacturing_stations_count}。` }
  }
  if (config.drones?.enable && !config.drones.auto && (!Array.isArray(config.drones.targets) || config.drones.targets.length === 0)) {
    return { ok: false, message: '启用无人机时至少需要一个加速目标。' }
  }
  return { ok: true, config }
}

function isCountRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every((item) => Number.isInteger(item) && item >= 0)
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}
