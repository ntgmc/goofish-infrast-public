import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  OperatorUpdateGrant,
  PermissionMode,
  ProductPermissionMode,
  RawPermissionMode,
} from '../../src/lib/types'
import { createPostgresCdkRecordStore } from '../storage/cdk-store'
import {
  createPostgresRiskControlSettingsStore,
  DEFAULT_RISK_CONTROL_SETTINGS,
  normalizeRiskControlSettings,
  type RiskControlSettings,
  type RiskControlSettingsPatch,
  type RiskControlSettingsStore,
} from '../storage/risk-settings-store'

const OBFUSCATE_KEY_SEED = 'maa-obfuscate-v1'
const REQUIRED_OPERATOR_KEYS = ['id', 'name', 'own', 'elite', 'rarity'] as const
const VALID_PERMISSION_MODES: RawPermissionMode[] = [
  'recommended',
  'growth',
  'advanced',
  'ultimate',
  'basic',
  'premium',
  'admin',
]
export const CDK_PRODUCT_PERMISSIONS: ProductPermissionMode[] = ['recommended', 'growth', 'advanced', 'ultimate']
export type CdkStatus = 'unused' | 'used' | 'frozen' | 'revoked'

export interface OperatorFingerprint {
  hash: string;
  owned_count: number;
  operators: Record<string, { name: string; own: boolean; elite: number; rarity: number }>;
}

export interface TimedHashEvent {
  hash: string;
  at: string;
}

export interface OperatorUpdateEvent {
  at: string;
  operator_count: number;
  fingerprint_hash: string;
}

export interface RiskEvent {
  at: string;
  type: string;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface OperatorUpdateLimit {
  window_days: 7;
  max_updates: 2;
  used: number;
  next_available_at?: string;
}

const PRESET_CONFIGS: LicenseConfig[] = [
  {
    layout: '2-4-3',
    desc: '243 均衡流 (2赤金/2经验)',
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 2 },
      manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  {
    layout: '2-4-3',
    desc: '243 搓玉 (2赤金/2源石)',
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 2,
    manufacturing_stations_count: 4,
    product_requirements: {
      trading_stations: { LMD: 1, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 2 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
  {
    layout: '3-3-3',
    desc: '333 搓玉流',
    schedule_mode: 'maa',
    dormitory_rule: 'fixed',
    trading_stations_count: 3,
    manufacturing_stations_count: 3,
    product_requirements: {
      trading_stations: { LMD: 2, Orundum: 1 },
      manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 1 },
    },
    Fiammetta: { enable: true },
    drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
  },
]
const TRADING_PRODUCTS = ['LMD', 'Orundum']
const MANUFACTURING_PRODUCTS = ['Pure Gold', 'Battle Record', 'Originium Shard']

installUnhandledRejectionLogger()

export interface CdkRecord {
  version: 1;
  code_hash: string;
  permission: RawPermissionMode;
  status: CdkStatus;
  created_at: string;
  used_at: string | null;
  revoked_at?: string | null;
  frozen_at?: string | null;
  freeze_reason?: string | null;
  order_note: string | null;
  license_order_hash: string | null;
  operator_count: number | null;
  config_desc: string | null;
  schedule_generate_count?: number;
  operator_update_grant_count?: number;
  operator_update_used_count?: number;
  operator_update_granted_at?: string | null;
  operator_update_consumed_at?: string | null;
  baseline_operator_fingerprint?: OperatorFingerprint;
  latest_operator_fingerprint?: OperatorFingerprint;
  operator_update_events?: OperatorUpdateEvent[];
  activation_token_hash?: string | null;
  bound_user_agent_hash?: string | null;
  user_agent_events?: TimedHashEvent[];
  ip_prefix_events?: TimedHashEvent[];
  risk_events?: RiskEvent[];
  account_id?: string | null;
  profile_id?: string | null;
}

export interface CdkRecordStore {
  get: (key: string) => Promise<CdkRecord | null>;
  getByLicenseOrderHash: (orderHash: string) => Promise<CdkRecord | null>;
  set: (key: string, record: CdkRecord) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<CdkRecord[]>;
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

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  })
}

export async function getCdkRecordStore(): Promise<CdkRecordStore> {
  const testingStore = getTestingCdkRecordStore()
  if (testingStore) return testingStore
  return createPostgresCdkRecordStore()
}

export async function getRiskControlSettings(): Promise<RiskControlSettings> {
  try {
    const store = getRiskControlSettingsStore()
    return normalizeRiskControlSettings(await store.get())
  } catch (error) {
    console.warn('risk settings unavailable, using defaults:', error)
    return { ...DEFAULT_RISK_CONTROL_SETTINGS }
  }
}

export async function saveRiskControlSettings(patch: RiskControlSettingsPatch): Promise<RiskControlSettings> {
  const store = getRiskControlSettingsStore()
  const current = normalizeRiskControlSettings(await store.get())
  const next = normalizeRiskControlSettings({ ...current, ...patch })
  return store.set(next)
}

export function setCdkRecordStoreForTesting(store: CdkRecordStore | null): void {
  ;(globalThis as unknown as { __maaCdkRecordStoreForTesting?: CdkRecordStore }).__maaCdkRecordStoreForTesting =
    store ?? undefined
}

export function setRiskControlSettingsStoreForTesting(store: RiskControlSettingsStore | null): void {
  ;(globalThis as unknown as { __maaRiskControlSettingsStoreForTesting?: RiskControlSettingsStore }).__maaRiskControlSettingsStoreForTesting =
    store ?? undefined
}

function getTestingCdkRecordStore(): CdkRecordStore | null {
  if (process.env.NODE_ENV === 'production') return null
  return (
    (globalThis as unknown as { __maaCdkRecordStoreForTesting?: CdkRecordStore })
      .__maaCdkRecordStoreForTesting ?? null
  )
}

function getRiskControlSettingsStore(): RiskControlSettingsStore {
  const testingStore = getTestingRiskControlSettingsStore()
  if (testingStore) return testingStore
  return createPostgresRiskControlSettingsStore()
}

function getTestingRiskControlSettingsStore(): RiskControlSettingsStore | null {
  if (process.env.NODE_ENV === 'production') return null
  return (
    (globalThis as unknown as { __maaRiskControlSettingsStoreForTesting?: RiskControlSettingsStore })
      .__maaRiskControlSettingsStoreForTesting ?? null
  )
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function verifyLicenseSignature(license: unknown, adminSecret: string): license is LicenseFile {
  if (!isRecord(license)) return false
  const sig = license.sig
  if (typeof sig !== 'string' || sig.length === 0) return false
  const unsigned = { ...license }
  delete unsigned.sig
  const expected = formatSig(hmacSha256(adminSecret, canonicalJson(unsigned)))
  return sig === expected
}

export function validateLicenseForRequest(license: unknown): { ok: true; license: LicenseFile } | { ok: false; message: string } {
  if (!isRecord(license)) {
    return { ok: false, message: '授权信息不能为空。' }
  }
  const candidate = license as Partial<LicenseFile>
  if (
    candidate.version !== 1 ||
    typeof candidate.order_hash !== 'string' ||
    !Array.isArray(candidate.operators) ||
    !candidate.config ||
    typeof candidate.config !== 'object' ||
    typeof candidate.issued_at !== 'string' ||
    typeof candidate.sig !== 'string'
  ) {
    return { ok: false, message: '授权信息格式不正确。' }
  }
  if (candidate.permission !== undefined && !isRawPermissionMode(candidate.permission)) {
    return { ok: false, message: '授权信息包含未知权限类型。' }
  }
  return { ok: true, license: candidate as LicenseFile }
}

export function normalizePermissionMode(permission?: RawPermissionMode): PermissionMode {
  switch (permission) {
    case 'recommended':
    case 'growth':
    case 'advanced':
    case 'ultimate':
    case 'admin':
      return permission
    case 'premium':
      return 'advanced'
    case 'basic':
    default:
      return 'growth'
  }
}

export function getPermissionMode(license: LicenseFile): PermissionMode {
  return normalizePermissionMode(license.permission)
}

export function canUseUpgradeFeatures(license: LicenseFile): boolean {
  return getPermissionMode(license) !== 'recommended'
}

export function canEditConfig(license: LicenseFile): boolean {
  return canEditConfigForPermission(getPermissionMode(license))
}

export function canEditConfigForPermission(permission: PermissionMode): boolean {
  return permission === 'advanced' || permission === 'ultimate' || permission === 'admin'
}

export function isIntermediateAutoConfig(config: LicenseConfig | null | undefined): boolean {
  return config?.auto_balance_source === 'intermediate_inventory' || config?.auto_balance_source === 'limited_config'
}

export function canUseIntermediateAutoConfig(
  license: LicenseFile,
  config: LicenseConfig | null | undefined,
): boolean {
  const permission = getPermissionMode(license)
  return (permission === 'recommended' || permission === 'growth') && isIntermediateAutoConfig(config)
}

export function resolveConfigForPermission(
  permission: PermissionMode,
  config: LicenseConfig,
): { ok: true; config: LicenseConfig } | { ok: false; message: string } {
  if (canEditConfigForPermission(permission)) {
    return { ok: true, config }
  }
  const preset = PRESET_CONFIGS.find((item) => isPresetConfigMatch(config, item))
  if (!preset) {
    return { ok: false, message: '当前 CDK 版本仅支持 243 均衡、243 搓玉或 333 搓玉预设配置。' }
  }
  return { ok: true, config: resolvePresetMode(config, preset) }
}

export function resolveFreePreviewConfig(
  config: LicenseConfig,
): { ok: true; config: LicenseConfig } | { ok: false; message: string } {
  if (config.optimizer_search) {
    return { ok: false, message: '免费个人排班不允许设置 optimizer_search。' }
  }
  if (hasForbiddenFreePreviewDroneConfig(config)) {
    return { ok: false, message: '免费个人排班仅允许预设无人机策略或中间产物库存派生的自动无人机策略。' }
  }
  const preset = PRESET_CONFIGS.find((item) =>
    isPresetConfigMatch(config, item) || isLegacyFreePreviewMaaConfigMatch(config, item)
  )
  if (!preset) {
    return { ok: false, message: '免费个人排班仅支持 243 均衡、243 搓玉和 333 搓玉预设。' }
  }
  return { ok: true, config: resolveFreePreviewPresetMode(config, preset) }
}

function isRawPermissionMode(value: string): value is RawPermissionMode {
  return (VALID_PERMISSION_MODES as string[]).includes(value)
}

function cloneConfig(config: LicenseConfig): LicenseConfig {
  return JSON.parse(JSON.stringify(config)) as LicenseConfig
}

function resolvePresetMode(config: LicenseConfig, preset: LicenseConfig): LicenseConfig {
  const resolved = cloneConfig(preset)
  resolved.dormitory_rule = normalizeDormitoryRule(config.dormitory_rule)
  if (normalizeScheduleMode(config.schedule_mode) === 'rotation') {
    resolved.schedule_mode = 'rotation'
  } else if (isIntermediateAutoConfig(config)) {
    resolved.intermediate_inventory = config.intermediate_inventory
    resolved.auto_balance_source = config.auto_balance_source
    resolved.drones = cloneConfig(config).drones
  }
  return resolved
}

function resolveFreePreviewPresetMode(config: LicenseConfig, preset: LicenseConfig): LicenseConfig {
  const resolved = cloneConfig(preset)
  resolved.dormitory_rule = normalizeDormitoryRule(config.dormitory_rule)
  delete resolved.optimizer_search
  if (normalizeScheduleMode(config.schedule_mode) === 'rotation') {
    resolved.schedule_mode = 'rotation'
  } else if (isIntermediateAutoConfig(config)) {
    resolved.intermediate_inventory = config.intermediate_inventory
    resolved.auto_balance_source = config.auto_balance_source
    resolved.drones = {
      ...(resolved.drones ?? { order: 'pre', targets: [] }),
      enable: true,
      auto: true,
      auto_strategy: 'trading_priority',
      order: resolved.drones?.order ?? 'pre',
      targets: Array.isArray(resolved.drones?.targets) ? resolved.drones.targets : [],
    }
    delete resolved.drones.auto_target_product
  }
  return resolved
}

function hasForbiddenFreePreviewDroneConfig(config: LicenseConfig): boolean {
  if (normalizeScheduleMode(config.schedule_mode) === 'rotation') return false
  const drones = config.drones
  if (!drones) return false
  const strategy = typeof drones.auto_strategy === 'string' ? drones.auto_strategy : ''
  const target = typeof drones.auto_target_product === 'string' ? drones.auto_target_product : ''
  if (target) return true
  if (!strategy) return false
  return !(isIntermediateAutoConfig(config) && strategy === 'trading_priority')
}

function isPresetConfigMatch(config: LicenseConfig, preset: LicenseConfig): boolean {
  const scheduleMode = normalizeScheduleMode(config.schedule_mode)
  const presetMode = normalizeScheduleMode(preset.schedule_mode)
  const scheduleMatches = scheduleMode === presetMode || (scheduleMode === 'rotation' && presetMode === 'maa')
  return config.layout === preset.layout
    && scheduleMatches
    && config.trading_stations_count === preset.trading_stations_count
    && config.manufacturing_stations_count === preset.manufacturing_stations_count
    && countsMatch(config.product_requirements?.trading_stations, preset.product_requirements.trading_stations, TRADING_PRODUCTS)
    && countsMatch(config.product_requirements?.manufacturing_stations, preset.product_requirements.manufacturing_stations, MANUFACTURING_PRODUCTS)
    && (scheduleMode === 'rotation' || Boolean(config.Fiammetta?.enable) === Boolean(preset.Fiammetta?.enable))
    && (scheduleMode === 'rotation' || dronesMatch(config.drones, preset.drones))
}

function isLegacyFreePreviewMaaConfigMatch(config: LicenseConfig, preset: LicenseConfig): boolean {
  if (normalizeScheduleMode(config.schedule_mode) !== 'maa') return false
  if (config.Fiammetta?.enable !== false || config.drones?.enable !== false) return false

  const restored = cloneConfig(config)
  restored.Fiammetta = { ...(restored.Fiammetta ?? {}), enable: Boolean(preset.Fiammetta?.enable) }
  restored.drones = { ...(restored.drones ?? { order: 'pre', targets: [] }), enable: Boolean(preset.drones?.enable) }
  return isPresetConfigMatch(restored, preset)
}

function normalizeScheduleMode(mode: unknown): string {
  const modeText = String(mode ?? 'maa').trim().toLowerCase()
  return ['rotation', 'rotate', 'game_rotation', 'in_game_rotation', '轮换', '轮换模式', '游戏内轮换'].includes(modeText)
    ? 'rotation'
    : 'maa'
}

function countsMatch(
  actual: Record<string, number> | undefined,
  expected: Record<string, number>,
  products: string[],
): boolean {
  const keys = new Set([...products, ...Object.keys(actual ?? {}), ...Object.keys(expected)])
  for (const key of keys) {
    if ((actual?.[key] ?? 0) !== (expected[key] ?? 0)) return false
  }
  return true
}

function dronesMatch(actual: LicenseConfig['drones'], expected: LicenseConfig['drones']): boolean {
  if (Boolean(actual?.enable) !== Boolean(expected?.enable)) return false
  if (Boolean(actual?.auto) !== Boolean(expected?.auto)) return false
  if ((actual?.order ?? 'pre') !== (expected?.order ?? 'pre')) return false
  const actualTargets = actual?.targets ?? []
  const expectedTargets = expected?.targets ?? []
  return actualTargets.length === expectedTargets.length
    && actualTargets.every((target, index) => target === expectedTargets[index])
}

export async function findCdkRecordByLicenseOrderHash(orderHash: string): Promise<CdkRecord | null> {
  const store = await getCdkRecordStore()
  return store.getByLicenseOrderHash(orderHash)
}

export async function findCdkRecordByCode(code: string, hashSecret: string): Promise<CdkRecord | null> {
  const codeHash = hashCdk(normalizeCode(code), hashSecret)
  const store = await getCdkRecordStore()
  return store.get(`cdk/${codeHash}.json`)
}

export async function incrementCdkScheduleGenerateCount(record: CdkRecord): Promise<void> {
  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, {
    ...record,
    schedule_generate_count: (record.schedule_generate_count ?? 0) + 1,
  })
}

export function getOperatorUpdateGrantRemaining(record: CdkRecord | null | undefined): number {
  if (!record) return 0
  return Math.max(0, (record.operator_update_grant_count ?? 0) - (record.operator_update_used_count ?? 0))
}

export function getOperatorUpdateGrant(record: CdkRecord | null | undefined): OperatorUpdateGrant | null {
  const remaining = getOperatorUpdateGrantRemaining(record)
  if (remaining <= 0) return null
  return {
    remaining,
    granted_at: record?.operator_update_granted_at ?? null,
  }
}

export function hasOperatorUpdateGrant(record: CdkRecord | null | undefined): boolean {
  return getOperatorUpdateGrantRemaining(record) > 0
}

export async function consumeOperatorUpdateGrant(record: CdkRecord, operatorCount: number): Promise<CdkRecord> {
  const consumedAt = new Date().toISOString()
  const updated: CdkRecord = {
    ...record,
    operator_count: operatorCount,
    operator_update_used_count: (record.operator_update_used_count ?? 0) + 1,
    operator_update_consumed_at: consumedAt,
  }
  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, updated)
  return updated
}

const ADVANCED_UPDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const ADVANCED_UPDATE_MAX_COUNT = 2
const CLIENT_SIGNAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const SOFT_BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000
const SOFT_BLOCK_FREEZE_COUNT = 3

export function buildOperatorFingerprint(operators: LicenseOperator[]): OperatorFingerprint {
  const normalized = operators
    .map((operator) => ({
      key: String(operator.id || operator.name),
      name: operator.name,
      own: Boolean(operator.own),
      elite: Number(operator.elite) || 0,
      rarity: Number(operator.rarity) || 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  const snapshot: OperatorFingerprint['operators'] = {}
  for (const operator of normalized) {
    snapshot[operator.key] = {
      name: operator.name,
      own: operator.own,
      elite: operator.elite,
      rarity: operator.rarity,
    }
  }

  return {
    hash: createHash('sha256').update(canonicalJson(normalized)).digest('hex'),
    owned_count: normalized.filter((operator) => operator.own).length,
    operators: snapshot,
  }
}

export function checkAdvancedOperatorUpdateLimit(
  record: CdkRecord,
  now = new Date(),
): { ok: true; limit: OperatorUpdateLimit } | { ok: false; limit: OperatorUpdateLimit } {
  const cutoff = now.getTime() - ADVANCED_UPDATE_WINDOW_MS
  const recentEvents = (record.operator_update_events ?? [])
    .filter((event) => Date.parse(event.at) > cutoff)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const limit: OperatorUpdateLimit = {
    window_days: 7,
    max_updates: ADVANCED_UPDATE_MAX_COUNT,
    used: recentEvents.length,
  }
  if (recentEvents.length < ADVANCED_UPDATE_MAX_COUNT) return { ok: true, limit }

  const oldest = Date.parse(recentEvents[0].at)
  if (Number.isFinite(oldest)) {
    limit.next_available_at = new Date(oldest + ADVANCED_UPDATE_WINDOW_MS).toISOString()
  }
  return { ok: false, limit }
}

export function evaluateOperatorRisk(
  record: CdkRecord,
  operators: LicenseOperator[],
): { ok: true; fingerprint: OperatorFingerprint } | { ok: false; fingerprint: OperatorFingerprint; event: RiskEvent } {
  const fingerprint = buildOperatorFingerprint(operators)
  const baseline = record.baseline_operator_fingerprint
  const latest = record.latest_operator_fingerprint ?? baseline
  if (!baseline) return { ok: true, fingerprint }

  const now = new Date().toISOString()
  for (const [key, previous] of Object.entries(baseline.operators)) {
    const next = fingerprint.operators[key]
    if (previous.own && previous.rarity >= 4 && (!next || !next.own)) {
      return {
        ok: false,
        fingerprint,
        event: {
          at: now,
          type: 'operator_ownership_regression',
          reason: `高星干员 ${previous.name} 从绑定账号中消失。`,
          detail: { operator_key: key, operator_name: previous.name },
        },
      }
    }
  }

  if (latest) {
    for (const [key, previous] of Object.entries(latest.operators)) {
      const next = fingerprint.operators[key]
      if (previous.own && next?.own && next.elite < previous.elite) {
        return {
          ok: false,
          fingerprint,
          event: {
            at: now,
            type: 'operator_elite_regression',
            reason: `干员 ${previous.name} 练度从精${previous.elite} 回退到精${next.elite}。`,
            detail: { operator_key: key, operator_name: previous.name, previous_elite: previous.elite, next_elite: next.elite },
          },
        }
      }
    }

    if (fingerprint.owned_count < latest.owned_count - 2) {
      return {
        ok: false,
        fingerprint,
        event: {
          at: now,
          type: 'operator_count_regression',
          reason: `拥有干员数从 ${latest.owned_count} 下降到 ${fingerprint.owned_count}。`,
          detail: { previous_owned_count: latest.owned_count, next_owned_count: fingerprint.owned_count },
        },
      }
    }
  }

  return { ok: true, fingerprint }
}

export function formatRiskFreezeMessage(reason: string): string {
  const trimmed = reason.trim() || '授权触发风控。'
  if (trimmed.includes('冻结') || trimmed.includes('被冻结')) return trimmed
  return `授权已被冻结：${trimmed} 请联系卖家人工核验后解冻。`
}

export function formatOperatorRiskBlockMessage(reason: string): string {
  return `本次操作已拦截：${reason} 这通常是误选了其他账号或旧版 operators.json，请确认文件后重新上传。`
}

export function shouldFreezeBindingRisk(event: RiskEvent): boolean {
  return event.type !== 'device_token_missing'
}

export function formatBindingBlockMessage(event: RiskEvent): string {
  if (event.type === 'device_token_missing') {
    return '本次操作已拦截：缺少设备绑定信息。请回到首次激活授权的浏览器，或重新上传当前授权文件后再试。'
  }
  return formatRiskFreezeMessage(event.reason)
}

export async function recordSoftBlockedRiskEvent(
  record: CdkRecord,
  event: RiskEvent,
  message: string,
): Promise<{ frozen: false; record: CdkRecord; message: string } | { frozen: true; record: CdkRecord; message: string }> {
  const now = event.at || new Date().toISOString()
  const softEvent: RiskEvent = {
    ...event,
    at: now,
    detail: {
      ...(event.detail ?? {}),
      soft_block: true,
    },
  }
  const riskEvents = [...(record.risk_events ?? []), softEvent].slice(-20)
  const cutoff = Date.parse(now) - SOFT_BLOCK_WINDOW_MS
  const softBlockCount = riskEvents.filter((item) => {
    const at = Date.parse(item.at)
    return Number.isFinite(at) && at > cutoff && item.detail?.soft_block === true
  }).length
  const updated: CdkRecord = {
    ...record,
    risk_events: riskEvents,
  }

  if (softBlockCount >= SOFT_BLOCK_FREEZE_COUNT) {
    const thresholdEvent: RiskEvent = {
      at: now,
      type: 'soft_block_threshold',
      reason: `24 小时内第 ${SOFT_BLOCK_FREEZE_COUNT} 次尝试被拦截。最近原因：${event.reason}`,
      detail: {
        soft_block_count: softBlockCount,
        latest_block_type: event.type,
      },
    }
    const thresholdUpdated: CdkRecord = {
      ...updated,
      risk_events: [...(updated.risk_events ?? []), thresholdEvent].slice(-20),
    }
    const store = await getCdkRecordStore()
    await store.set(`cdk/${record.code_hash}.json`, thresholdUpdated)
    return {
      frozen: true,
      record: thresholdUpdated,
      message: formatRiskFreezeMessage(thresholdEvent.reason),
    }
  }

  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, updated)
  return {
    frozen: false,
    record: updated,
    message,
  }
}

export function evaluateClientBindingRisk(
  record: CdkRecord,
  activationToken: unknown,
  req: Request,
): { ok: true; record: CdkRecord } | { ok: false; record: CdkRecord; event: RiskEvent } {
  const now = new Date().toISOString()
  const tokenHash = hashActivationToken(activationToken)
  let next: CdkRecord = { ...record }

  if (!next.activation_token_hash) {
    if (!tokenHash) {
      return {
        ok: false,
        record: next,
        event: { at: now, type: 'device_token_missing', reason: '缺少设备绑定 Token。' },
      }
    }
    next.activation_token_hash = tokenHash
  } else if (!tokenHash || tokenHash !== next.activation_token_hash) {
    return {
      ok: false,
      record: next,
      event: { at: now, type: 'device_token_mismatch', reason: '设备绑定 Token 与首次激活设备不一致。' },
    }
  }

  const userAgentHash = hashHeaderValue(req.headers.get('user-agent'))
  if (userAgentHash) {
    if (!next.bound_user_agent_hash) next.bound_user_agent_hash = userAgentHash
    next.user_agent_events = appendTimedHashEvent(next.user_agent_events, userAgentHash, now, CLIENT_SIGNAL_WINDOW_MS)
    if (countUniqueRecentHashes(next.user_agent_events, now, CLIENT_SIGNAL_WINDOW_MS) > 2) {
      return {
        ok: false,
        record: next,
        event: { at: now, type: 'user_agent_churn', reason: '同一授权近期使用了过多浏览器环境。' },
      }
    }
  }

  const ipPrefixHash = hashIpPrefix(req)
  if (ipPrefixHash) {
    next.ip_prefix_events = appendTimedHashEvent(next.ip_prefix_events, ipPrefixHash, now, CLIENT_SIGNAL_WINDOW_MS)
    if (countUniqueRecentHashes(next.ip_prefix_events, now, CLIENT_SIGNAL_WINDOW_MS) > 3) {
      return {
        ok: false,
        record: next,
        event: { at: now, type: 'ip_prefix_churn', reason: '同一授权近期使用了过多网络位置。' },
      }
    }
  }

  return { ok: true, record: next }
}

export async function createAdvancedRiskBinding(
  record: CdkRecord,
  operators: LicenseOperator[],
  req: Request,
  activationToken: unknown,
): Promise<{ ok: true; record: CdkRecord } | { ok: false; event: RiskEvent }> {
  const settings = await getRiskControlSettings()
  const binding: { ok: true; record: CdkRecord } | { ok: false; record: CdkRecord; event: RiskEvent } = settings.device_risk_enabled
    ? evaluateClientBindingRisk(record, activationToken, req)
    : { ok: true, record }
  if (!binding.ok) return { ok: false, event: binding.event }
  const fingerprint = buildOperatorFingerprint(operators)
  return {
    ok: true,
    record: {
      ...binding.record,
      baseline_operator_fingerprint: binding.record.baseline_operator_fingerprint ?? fingerprint,
      latest_operator_fingerprint: fingerprint,
    },
  }
}

export async function syncAdvancedCdkBinding(
  record: CdkRecord,
  operators: LicenseOperator[],
  req: Request,
  activationToken: unknown,
): Promise<{ ok: true; record: CdkRecord } | { ok: false; status: number; message: string; record: CdkRecord }> {
  const binding = await createAdvancedRiskBinding(record, operators, req, activationToken)
  if (!binding.ok) {
    if (!shouldFreezeBindingRisk(binding.event)) {
      return { ok: false, status: 403, message: formatBindingBlockMessage(binding.event), record }
    }
    const frozen = await freezeCdkRecord(record, binding.event.reason, binding.event)
    return { ok: false, status: 403, message: frozen.freeze_reason || formatRiskFreezeMessage(binding.event.reason), record: frozen }
  }
  if (binding.record === record) return { ok: true, record }
  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, binding.record)
  return { ok: true, record: binding.record }
}

export async function recordAdvancedOperatorUpdate(
  record: CdkRecord,
  operators: LicenseOperator[],
  req: Request,
  activationToken: unknown,
): Promise<
  | { ok: true; record: CdkRecord; limit: OperatorUpdateLimit }
  | { ok: false; status: 403 | 409 | 429; message: string; record: CdkRecord; limit?: OperatorUpdateLimit; profile_freeze_required?: boolean }
> {
  const settings = await getRiskControlSettings()
  let bindingRecord = record

  if (settings.device_risk_enabled) {
    const binding = evaluateClientBindingRisk(record, activationToken, req)
    if (!binding.ok) {
      if (!shouldFreezeBindingRisk(binding.event)) {
        if (binding.event.type === 'device_token_missing') {
          return { ok: false, status: 403, message: formatBindingBlockMessage(binding.event), record: binding.record }
        }
        const blocked = await recordSoftBlockedRiskEvent(binding.record, binding.event, formatBindingBlockMessage(binding.event))
        return { ok: false, status: 403, message: blocked.message, record: blocked.record }
      }
      const frozen = await freezeCdkRecord(binding.record, binding.event.reason, binding.event)
      return { ok: false, status: 403, message: frozen.freeze_reason || formatRiskFreezeMessage(binding.event.reason), record: frozen }
    }
    bindingRecord = binding.record
  }

  const operatorRisk = settings.operator_data_risk_enabled
    ? evaluateOperatorRisk(bindingRecord, operators)
    : { ok: true as const, fingerprint: buildOperatorFingerprint(operators) }
  if (!operatorRisk.ok) {
    const blocked = await recordSoftBlockedRiskEvent(bindingRecord, operatorRisk.event, formatOperatorRiskBlockMessage(operatorRisk.event.reason))
    return {
      ok: false,
      status: blocked.frozen ? 403 : 409,
      message: blocked.message,
      record: blocked.record,
      profile_freeze_required: blocked.frozen,
    }
  }

  const limitCheck = checkAdvancedOperatorUpdateLimit(bindingRecord)
  if (!limitCheck.ok) {
    return {
      ok: false,
      status: 429,
      message: limitCheck.limit.next_available_at
? `单账号终身卡每 7 天最多更新 2 次干员数据，请在 ${limitCheck.limit.next_available_at} 后再试。`
: '单账号终身卡每 7 天最多更新 2 次干员数据，请稍后再试。',
      record: bindingRecord,
      limit: limitCheck.limit,
    }
  }

  const now = new Date().toISOString()
  const cutoff = Date.now() - ADVANCED_UPDATE_WINDOW_MS
  const updateEvents = [
    ...(bindingRecord.operator_update_events ?? []).filter((event) => Date.parse(event.at) > cutoff),
    {
      at: now,
      operator_count: operators.length,
      fingerprint_hash: operatorRisk.fingerprint.hash,
    },
  ]
  const updated: CdkRecord = {
    ...bindingRecord,
    operator_count: operators.length,
    baseline_operator_fingerprint: bindingRecord.baseline_operator_fingerprint ?? operatorRisk.fingerprint,
    latest_operator_fingerprint: operatorRisk.fingerprint,
    operator_update_events: updateEvents,
  }
  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, updated)
  return { ok: true, record: updated, limit: checkAdvancedOperatorUpdateLimit(updated).limit }
}

export async function freezeCdkRecord(record: CdkRecord, reason: string, event: RiskEvent): Promise<CdkRecord> {
  const frozenAt = event.at || new Date().toISOString()
  const freezeReason = formatRiskFreezeMessage(reason)
  const updated: CdkRecord = {
    ...record,
    status: 'frozen',
    frozen_at: frozenAt,
    freeze_reason: freezeReason,
    risk_events: [...(record.risk_events ?? []), event].slice(-20),
  }
  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, updated)
  return updated
}

export async function unfreezeCdkRecord(record: CdkRecord): Promise<CdkRecord> {
  const updated: CdkRecord = {
    ...record,
    status: 'used',
    frozen_at: null,
    freeze_reason: null,
  }
  const store = await getCdkRecordStore()
  await store.set(`cdk/${record.code_hash}.json`, updated)
  return updated
}

function hashActivationToken(value: unknown): string | null {
  const token = normalizeLicenseActivationToken(value)
  if (!token) return null
  return createHash('sha256').update(token).digest('hex')
}

function normalizeLicenseActivationToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  return token.length >= 16 ? token : null
}

function hashHeaderValue(value: string | null): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex')
}

function appendTimedHashEvent(
  events: TimedHashEvent[] | undefined,
  hash: string,
  at: string,
  windowMs: number,
): TimedHashEvent[] {
  const cutoff = Date.parse(at) - windowMs
  const recent = (events ?? []).filter((event) => Date.parse(event.at) > cutoff)
  if (recent[recent.length - 1]?.hash !== hash) recent.push({ hash, at })
  return recent.slice(-30)
}

function countUniqueRecentHashes(events: TimedHashEvent[] | undefined, nowIso: string, windowMs: number): number {
  const cutoff = Date.parse(nowIso) - windowMs
  return new Set((events ?? []).filter((event) => Date.parse(event.at) > cutoff).map((event) => event.hash)).size
}

function hashIpPrefix(req: Request): string | null {
  const rawIp = getClientIp(req)
  if (!rawIp) return null
  const prefix = normalizeIpPrefix(rawIp)
  if (!prefix) return null
  return createHash('sha256').update(prefix).digest('hex')
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || req.headers.get('client-ip')
    || req.headers.get('cf-connecting-ip')
  const first = forwarded?.split(',')[0]?.trim()
  return first || null
}

function normalizeIpPrefix(ip: string): string | null {
  const withoutPort = ip.replace(/^\[|\]$/g, '').split(':').length === 2 && ip.includes('.')
    ? ip.split(':')[0]
    : ip.replace(/^\[|\]$/g, '')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(withoutPort)) {
    return withoutPort.split('.').slice(0, 3).join('.') + '.0/24'
  }
  if (withoutPort.includes(':')) {
    return withoutPort.split(':').filter(Boolean).slice(0, 3).join(':') + '::/48'
  }
  return null
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
  activationToken,
}: {
  adminSecret: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  permission: PermissionMode;
  codeHash: string;
  activationToken?: unknown;
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
    activation_token: normalizeLicenseActivationToken(activationToken),
    issued_at: issuedAt,
  }
  const sig = formatSig(hmacSha256(adminSecret, canonicalJson(unsigned)))
  const license: LicenseFile = { ...unsigned, sig }
  const licenseFileContent = encryptLicensePayload(canonicalJson(license))
  return { license, licenseFileContent }
}

export function reissueSignedLicenseFile(
  license: LicenseFile,
  permission: PermissionMode,
  adminSecret: string,
  overrides: {
    operators?: LicenseOperator[];
    operatorUpdateGrant?: OperatorUpdateGrant | null;
    activationToken?: unknown;
  } = {},
): { license: LicenseFile; licenseFileContent: string } {
  const activationToken = normalizeLicenseActivationToken(overrides.activationToken)
  const unsigned = {
    ...license,
    permission,
    ...(overrides.operators ? { operators: overrides.operators } : {}),
    ...(activationToken ? { activation_token: activationToken } : {}),
    operator_update_grant: overrides.operatorUpdateGrant ?? null,
    issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
  delete (unsigned as Partial<LicenseFile>).sig
  const sig = formatSig(hmacSha256(adminSecret, canonicalJson(unsigned)))
  const nextLicense: LicenseFile = { ...unsigned, sig }
  const licenseFileContent = encryptLicensePayload(canonicalJson(nextLicense))
  return { license: nextLicense, licenseFileContent }
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
  config.dormitory_rule = normalizeDormitoryRule(config.dormitory_rule)
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

function normalizeDormitoryRule(rule: unknown): 'fixed' | 'maa_autofill' {
  const ruleText = String(rule ?? 'fixed').trim().toLowerCase()
  return ['maa_autofill', 'maa-autofill', 'autofill', 'auto', 'maa自动填满', '自动填满'].includes(ruleText)
    ? 'maa_autofill'
    : 'fixed'
}
