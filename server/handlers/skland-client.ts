import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { LicenseOperator } from '../../src/lib/types'

const APP_CODE = '4ca99fa6b56cc2ba'
const HYPERGRYPH_BASE = 'https://as.hypergryph.com'
const SKLAND_BASE = 'https://zonai.skland.com'
const REQUEST_TIMEOUT_MS = 25000
const SKLAND_USER_AGENT = 'Skland/1.21.0 (com.hypergryph.skland; build:102100065; iOS 17.6.0; ) Alamofire/5.7.1'

export type SklandClientErrorCode = 'credential_invalid' | 'credential_format_invalid' | 'request_failed'

export class SklandClientError extends Error {
  constructor(
    readonly code: SklandClientErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'SklandClientError'
  }
}

export interface SklandBindingSummary {
  uid: string
  nickname: string
  channel_name: string
}

export interface SklandImportSummary extends SklandBindingSummary {
  status: 'imported'
  operator_count: number
  imported_at: string
}

type ApiEnvelope = {
  code?: number
  status?: number
  message?: string
  msg?: string
  data?: unknown
  timestamp?: number
}

export async function createHypergryphScan(): Promise<{ scanId: string; scanUrl: string; expiresAt: string }> {
  const data = await fetchJson<ApiEnvelope>(`${HYPERGRYPH_BASE}/general/v1/gen_scan/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify({ appCode: APP_CODE }),
  })
  if (data.status !== 0 || data.msg !== 'OK' || !isRecord(data.data) || typeof data.data.scanId !== 'string') {
    throw new Error('生成鹰角扫码登录二维码失败，请稍后重试。')
  }
  const scanId = data.data.scanId
  return {
    scanId,
    scanUrl: `hypergryph://scan_login?scanId=${encodeURIComponent(scanId)}`,
    expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  }
}

export async function getScanCode(scanId: string): Promise<string | null> {
  const url = `${HYPERGRYPH_BASE}/general/v1/scan_status?scanId=${encodeURIComponent(scanId)}`
  const data = await fetchJson<ApiEnvelope>(url, { method: 'GET' })
  if (data.status !== 0) return null
  if (!isRecord(data.data) || typeof data.data.scanCode !== 'string') return null
  return data.data.scanCode
}

export async function getHypergryphTokenByScanCode(scanCode: string): Promise<string> {
  const data = await fetchJson<ApiEnvelope>(`${HYPERGRYPH_BASE}/user/auth/v1/token_by_scan_code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify({ scanCode }),
  })
  if (data.status !== 0 || data.msg !== 'OK' || !isRecord(data.data) || typeof data.data.token !== 'string') {
    throw new Error('鹰角扫码授权已确认，但获取登录凭据失败，请重新扫码。')
  }
  return data.data.token
}

export async function getCredByHypergryphToken(token: string): Promise<string> {
  const oauth = await fetchJson<ApiEnvelope>(`${HYPERGRYPH_BASE}/user/oauth2/v2/grant`, {
    method: 'POST',
    headers: {
      'User-Agent': SKLAND_USER_AGENT,
      'Content-Type': 'application/json;charset=utf-8',
    },
    body: JSON.stringify({ appCode: APP_CODE, type: 0, token }),
  })
  if (oauth.msg !== 'OK' || !isRecord(oauth.data) || typeof oauth.data.code !== 'string') {
    throw new Error('鹰角授权换取森空岛 code 失败，请重新扫码。')
  }

  const cred = await fetchJson<ApiEnvelope>(`${SKLAND_BASE}/web/v1/user/auth/generate_cred_by_code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      Referer: 'https://www.skland.com/',
      Origin: 'https://www.skland.com',
      dId: randomUUID(),
      platform: '3',
      timestamp: `${Math.floor(Date.now() / 1000)}`,
      vName: '1.0.0',
    },
    body: JSON.stringify({ kind: 1, code: oauth.data.code }),
  })
  if (cred.message !== 'OK' || !isRecord(cred.data) || typeof cred.data.cred !== 'string') {
    throw new Error('森空岛凭据生成失败，请重新扫码。')
  }
  return cred.data.cred
}

export async function importSklandOperatorsByCred(cred: string): Promise<{
  binding: SklandBindingSummary
  operators: LicenseOperator[]
  importedAt: string
}> {
  const client = new SklandClient(cred)
  const binding = await client.getArknightsBinding()
  const playerInfo = await client.getGamePlayerInfo(binding.uid)
  const operators = convertSklandCharactersToOperators(playerInfo)
  return {
    binding,
    operators,
    importedAt: new Date().toISOString(),
  }
}

export function convertSklandCharactersToOperators(gamePlayerInfo: unknown): LicenseOperator[] {
  const chars = getNestedArray(gamePlayerInfo, ['data', 'chars'])
  const charInfoMap = getNestedRecord(gamePlayerInfo, ['data', 'charInfoMap'])
  if (!chars || chars.length === 0) {
    throw new Error('森空岛返回的干员数据为空，请确认账号已绑定明日方舟角色。')
  }

  const operators: LicenseOperator[] = []
  for (const raw of chars) {
    if (!isRecord(raw)) continue
    const id = stringValue(raw.charId ?? raw.id)
    if (!id || !id.startsWith('char_')) continue
    const meta = charInfoMap && isRecord(charInfoMap[id]) ? charInfoMap[id] : null
    const name = stringValue(raw.name ?? meta?.name)
    const elite = numberValue(raw.evolvePhase)
    const rarity = numberValue(meta?.rarity)
    if (!name || elite === null || rarity === null) continue
    operators.push({
      id,
      name,
      own: true,
      elite,
      level: numberValue(raw.level) ?? 0,
      potential: numberValue(raw.potentialRank) ?? 0,
      rarity,
    })
  }

  const uniqueOperators = dedupeSklandOperators(operators)
  if (uniqueOperators.length === 0) {
    throw new Error('森空岛干员数据无法转换为当前系统格式，请稍后重试。')
  }
  return uniqueOperators.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

export function encryptSklandCredential(cred: string): string {
  const secret = getCredentialSecret()
  const iv = randomBytes(12)
  const key = createHash('sha256').update(secret).digest()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(cred, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'SKLAND-V1:' + Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSklandCredential(encrypted: string): string {
  const secret = getCredentialSecret()
  const payload = encrypted.startsWith('SKLAND-V1:') ? encrypted.slice('SKLAND-V1:'.length) : ''
  if (!payload) throw new SklandClientError('credential_format_invalid', '森空岛绑定凭据格式无效，请重新扫码绑定。')
  const raw = Buffer.from(payload, 'base64')
  if (raw.length <= 28) throw new SklandClientError('credential_format_invalid', '森空岛绑定凭据格式无效，请重新扫码绑定。')
  try {
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const encryptedBody = raw.subarray(28)
    const key = createHash('sha256').update(secret).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encryptedBody), decipher.final()]).toString('utf8')
  } catch {
    throw new SklandClientError('credential_format_invalid', '森空岛绑定凭据格式无效，请重新扫码绑定。')
  }
}

export function ensureSklandCredentialSecret(): void {
  getCredentialSecret()
}

export function generateSklandSign(token: string, path: string, queryOrBody: string, timestamp: string): string {
  const headerForSign = {
    platform: '1',
    timestamp,
    dId: '',
    vName: '1.21.0',
  }
  const source = path + queryOrBody + timestamp + JSON.stringify(headerForSign)
  const hmac = createHmac('sha256', token).update(source, 'utf8').digest('hex')
  return createHash('md5').update(hmac, 'utf8').digest('hex')
}

export class SklandClient {
  private token = ''
  private timestamp = ''

  constructor(private readonly cred: string) {}

  async getArknightsBinding(): Promise<SklandBindingSummary> {
    const data = await this.getSigned<ApiEnvelope>('/api/v1/game/player/binding')
    if (data.code !== 0 || data.message !== 'OK' || !isRecord(data.data) || !Array.isArray(data.data.list)) {
      throw new Error('读取森空岛绑定角色失败，请重新扫码绑定。')
    }
    for (const item of data.data.list) {
      if (!isRecord(item) || item.appCode !== 'arknights' || !Array.isArray(item.bindingList)) continue
      const bindings = item.bindingList.filter(isRecord)
      const defaultUid = stringValue(item.defaultUid)
      const binding = defaultUid
        ? bindings.find((candidate) => stringValue(candidate.uid) === defaultUid) ?? bindings[0]
        : bindings.find((candidate) => stringValue(candidate.uid))
      const uid = defaultUid || stringValue(binding?.uid)
      const nickname = stringValue(binding?.nickName ?? binding?.nickname ?? uid)
      const channel = stringValue(binding?.channelName ?? binding?.channel ?? '官方')
      if (uid && nickname) {
        return { uid, nickname, channel_name: channel || '官方' }
      }
    }
    throw new Error('森空岛账号未找到已绑定的明日方舟角色。')
  }

  async getGamePlayerInfo(uid: string): Promise<unknown> {
    const query = `uid=${encodeURIComponent(uid)}`
    const data = await this.getSigned<ApiEnvelope>('/api/v1/game/player/info', query)
    if (data.code !== 0 || data.message !== 'OK') {
      throw new Error('读取森空岛干员数据失败，请稍后重试。')
    }
    return data
  }

  async getCultivateInfo(): Promise<unknown> {
    const data = await this.getSigned<ApiEnvelope>('/api/v1/game/cultivate/info')
    return getEnvelopeData(data, '读取森空岛养成通用数据失败，请稍后重试。')
  }

  async getCultivatePlayer(uid: string): Promise<unknown> {
    const query = `uid=${encodeURIComponent(uid)}`
    const data = await this.getSigned<ApiEnvelope>('/api/v1/game/cultivate/player', query)
    return getEnvelopeData(data, '读取森空岛养成库存失败，请稍后重试。')
  }

  async getCultivateCharacter(characterId: string): Promise<unknown> {
    const query = `characterId=${encodeURIComponent(characterId)}`
    const data = await this.getSigned<ApiEnvelope>('/api/v1/game/cultivate/character', query)
    return getEnvelopeData(data, '读取森空岛干员养成材料失败，请稍后重试。')
  }

  private async refreshToken(): Promise<void> {
    const timestamp = `${Math.floor(Date.now() / 1000)}`
    const sign = generateSklandSign('', '/api/v1/auth/refresh', '', timestamp)
    const data = await fetchSklandRefreshToken(timestamp, sign, this.cred, this.baseHeaders(timestamp, sign))
    if (data.code !== 0 || data.message !== 'OK' || !isRecord(data.data) || typeof data.data.token !== 'string') {
      throw new SklandClientError('credential_invalid', '森空岛凭据已失效，请重新扫码绑定。')
    }
    this.token = data.data.token
    this.timestamp = stringValue(data.timestamp) || timestamp
  }

  private async getSigned<T>(path: string, query = ''): Promise<T> {
    if (!this.token) await this.refreshToken()
    const timestamp = this.timestamp || `${Math.floor(Date.now() / 1000)}`
    const sign = generateSklandSign(this.token, path, query, timestamp)
    const url = `${SKLAND_BASE}${path}${query ? `?${query}` : ''}`
    return fetchJson<T>(url, {
      method: 'GET',
      headers: {
        ...this.baseHeaders(timestamp, sign),
        cred: this.cred,
        token: this.token,
      },
    })
  }

  private baseHeaders(timestamp: string, sign: string): Record<string, string> {
    return {
      'User-Agent': SKLAND_USER_AGENT,
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
      platform: '1',
      'Accept-Language': 'zh-Hans-CN;q=1.0',
      dId: '',
      vName: '1.21.0',
      language: 'zh-hans-CN',
      sign,
      timestamp,
    }
  }
}

async function fetchSklandRefreshToken(
  timestamp: string,
  sign: string,
  cred: string,
  baseHeaders: Record<string, string>,
): Promise<ApiEnvelope> {
  try {
    return await fetchJson<ApiEnvelope>(`${SKLAND_BASE}/api/v1/auth/refresh`, {
      method: 'GET',
      headers: {
        ...baseHeaders,
        cred,
        sign,
        timestamp,
      },
    })
  } catch (error) {
    if (error instanceof SklandClientError && (error.httpStatus === 401 || error.httpStatus === 403)) {
      throw new SklandClientError('credential_invalid', '森空岛凭据已失效，请重新扫码绑定。')
    }
    throw error
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new SklandClientError('request_failed', `鹰角或森空岛接口请求失败: HTTP ${response.status}`, response.status)
  }
  return data as T
}

function getCredentialSecret(): string {
  const secret = process.env.SKLAND_CREDENTIAL_SECRET?.trim()
  if (!secret || secret.length < 16) {
    throw new Error('SKLAND_CREDENTIAL_SECRET 未配置或长度不足，无法保存森空岛绑定。')
  }
  return secret
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getEnvelopeData(envelope: ApiEnvelope, message: string): unknown {
  if (envelope.code !== 0 || envelope.message !== 'OK' || envelope.data === undefined || envelope.data === null) {
    throw new Error(message)
  }
  return envelope.data
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function dedupeSklandOperators(operators: LicenseOperator[]): LicenseOperator[] {
  const byKey = new Map<string, LicenseOperator>()
  for (const operator of operators) {
    const key = sklandOperatorDedupKey(operator)
    if (!byKey.has(key)) {
      byKey.set(key, operator)
    }
  }
  return [...byKey.values()]
}

function sklandOperatorDedupKey(operator: LicenseOperator): string {
  const normalizedName = operator.name.replace(/\s+/g, '').toLowerCase()
  if (normalizedName.includes('阿米娅') || operator.id.includes('amiya')) return 'skland:amiya'
  return operator.id
}

function getNestedArray(value: unknown, path: string[]): unknown[] | null {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return Array.isArray(current) ? current : null
}

function getNestedRecord(value: unknown, path: string[]): Record<string, unknown> | null {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return isRecord(current) ? current : null
}
