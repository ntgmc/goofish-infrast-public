import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { LicenseOperator } from '../../src/lib/types'

const APP_CODE = '4ca99fa6b56cc2ba'
const HYPERGRYPH_BASE = 'https://as.hypergryph.com'
const SKLAND_BASE = 'https://zonai.skland.com'
const REQUEST_TIMEOUT_MS = 25000
const SKLAND_USER_AGENT = 'Skland/1.21.0 (com.hypergryph.skland; build:102100065; iOS 17.6.0; ) Alamofire/5.7.1'

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
    logSklandImportDebug('missing data.chars', gamePlayerInfo)
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
    const rarity = numberValue(raw.rarity ?? meta?.rarity)
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

  if (operators.length === 0) {
    logSklandImportDebug('no convertible operators', gamePlayerInfo)
    throw new Error('森空岛干员数据无法转换为当前系统格式，请稍后重试。')
  }
  return operators.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
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
  if (!payload) throw new Error('森空岛绑定凭据格式无效，请重新扫码绑定。')
  const raw = Buffer.from(payload, 'base64')
  if (raw.length <= 28) throw new Error('森空岛绑定凭据格式无效，请重新扫码绑定。')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encryptedBody = raw.subarray(28)
  const key = createHash('sha256').update(secret).digest()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encryptedBody), decipher.final()]).toString('utf8')
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

class SklandClient {
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
      const first = item.bindingList.find(isRecord)
      const uid = stringValue(item.defaultUid ?? first?.uid)
      const nickname = stringValue(first?.nickName ?? first?.nickname ?? uid)
      const channel = stringValue(first?.channelName ?? first?.channel ?? '官方')
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

  private async refreshToken(): Promise<void> {
    const timestamp = `${Math.floor(Date.now() / 1000)}`
    const sign = generateSklandSign('', '/api/v1/auth/refresh', '', timestamp)
    const data = await fetchJson<ApiEnvelope>(`${SKLAND_BASE}/api/v1/auth/refresh`, {
      method: 'GET',
      headers: {
        ...this.baseHeaders(timestamp, sign),
        cred: this.cred,
      },
    })
    if (data.code !== 0 || data.message !== 'OK' || !isRecord(data.data) || typeof data.data.token !== 'string') {
      throw new Error('森空岛凭据已失效，请重新扫码绑定。')
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
    throw new Error(`鹰角或森空岛接口请求失败: HTTP ${response.status}`)
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

function logSklandImportDebug(reason: string, gamePlayerInfo: unknown): void {
  if (process.env.SKLAND_DEBUG_IMPORT !== '1') return
  const data = isRecord(gamePlayerInfo) && isRecord(gamePlayerInfo.data) ? gamePlayerInfo.data : null
  const chars = data && Array.isArray(data.chars) ? data.chars : null
  const charInfoMap = data && isRecord(data.charInfoMap) ? data.charInfoMap : null
  const summary = {
    reason,
    root_keys: isRecord(gamePlayerInfo) ? Object.keys(gamePlayerInfo).slice(0, 30) : [],
    data_keys: data ? Object.keys(data).slice(0, 50) : [],
    chars_length: chars?.length ?? null,
    char_info_map_size: charInfoMap ? Object.keys(charInfoMap).length : null,
    chars_sample: chars?.slice(0, 5).map(summarizeSklandCharacter) ?? null,
    char_info_sample: charInfoMap
      ? Object.entries(charInfoMap).slice(0, 5).map(([id, value]) => ({ id, ...summarizeSklandCharacter(value) }))
      : null,
  }
  console.warn('[skland import debug]', safeJson(summary))
}

function summarizeSklandCharacter(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: typeof value }
  return {
    keys: Object.keys(value).slice(0, 30),
    charId: stringValue(value.charId ?? value.id) || undefined,
    name: stringValue(value.name) || undefined,
    evolvePhase: numberValue(value.evolvePhase),
    level: numberValue(value.level),
    potentialRank: numberValue(value.potentialRank),
    rarity: numberValue(value.rarity),
  }
}

function safeJson(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length > 8000 ? `${text.slice(0, 8000)}...[truncated]` : text
}
