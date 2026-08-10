import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  PermissionMode,
  ProductPermissionMode,
  RawPermissionMode,
} from '../../src/lib/types'
import {
  hasCapability,
  listAdminIssuablePermissions,
  normalizeRuntimePermission,
  productPolicies,
} from '../../src/lib/product-catalog'
import { createPostgresCdkRecordStore } from '../storage/cdk-store'
import { licenseConfigSchema, licenseOperatorsSchema } from '../../src/lib/workspace-validation'
import {
  createPostgresRiskControlSettingsStore,
  DEFAULT_RISK_CONTROL_SETTINGS,
  normalizeRiskControlSettings,
  type RiskControlSettings,
  type RiskControlSettingsPatch,
  type RiskControlSettingsStore,
} from '../storage/risk-settings-store'

export const CDK_PRODUCT_PERMISSIONS: ProductPermissionMode[] = listAdminIssuablePermissions()
export type CdkStatus = 'unused' | 'claiming' | 'used' | 'frozen' | 'revoked'
export type CdkType = 'profile' | 'balance' | 'item'
export type ItemCdkCode = 'lifetime_profile_voucher' | 'limited_profile_voucher'
export type ProfileCdkDuration = 'lifetime' | 'month' | 'half_year' | 'year'

export const PROFILE_CDK_DURATION_DAYS: Record<Exclude<ProfileCdkDuration, 'lifetime'>, number> = {
  month: 30,
  half_year: 90,
  year: 365,
}

export interface OperatorFingerprint {
  hash: string;
  owned_count: number;
  operators: Record<string, { name: string; own: boolean; elite: number; rarity: number }>;
}

export function getCdkScheduleQuotaLimit(record: CdkRecord): number | null {
  if (!isProfileCdkRecord(record)) return null
  const duration = getCdkProfileDuration(record)
  return productPolicies.metered_billing.schedule_quotas[duration]
}

export function getCdkScenarioQuotaLimit(record: CdkRecord): number | null {
  if (!isProfileCdkRecord(record)) return null
  const duration = getCdkProfileDuration(record)
  return productPolicies.metered_billing.scenario_quotas[duration]
}

export type OperatorBaselineSource = 'latest' | 'workspace' | 'next_import'

interface AdminOperatorBaselineOptions {
  source: OperatorBaselineSource;
  reason: string;
  fingerprint?: OperatorFingerprint;
  unfreeze: boolean;
  eventType?: 'admin_operator_baseline_changed' | 'admin_operator_baseline_reset';
  reviewed?: boolean;
}

export interface RiskEvent {
  at: string;
  type: string;
  reason: string;
  detail?: Record<string, unknown>;
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

interface CdkRecordBase {
  code_hash: string;
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
  schedule_generate_reserved_count?: number;
  scenario_comparison_count?: number;
  scenario_comparison_reserved_count?: number;
  baseline_operator_fingerprint?: OperatorFingerprint;
  latest_operator_fingerprint?: OperatorFingerprint;
  risk_events?: RiskEvent[];
  account_id?: string | null;
  profile_id?: string | null;
}

export type LegacyProfileCdkRecord = CdkRecordBase & {
  version: 1;
  cdk_type?: undefined;
  permission: RawPermissionMode;
  balance_amount?: null;
  profile_duration?: ProfileCdkDuration;
  profile_duration_days?: number | null;
  profile_expires_at?: string | null;
}
export type ProfileCdkRecord = CdkRecordBase & {
  version: 2;
  cdk_type: 'profile';
  permission: RawPermissionMode;
  balance_amount: null;
  profile_duration?: ProfileCdkDuration;
  profile_duration_days?: number | null;
  profile_expires_at?: string | null;
}
export type BalanceCdkRecord = CdkRecordBase & { version: 2; cdk_type: 'balance'; permission: null; balance_amount: string }
export type LegacyItemCdkRecord = CdkRecordBase & { version: 2; cdk_type: 'item'; permission: null; balance_amount: null; item_code?: null; item_expires_at?: null }
export type ItemCdkRecord = CdkRecordBase & { version: 3; cdk_type: 'item'; permission: null; balance_amount: null; item_code: ItemCdkCode; item_expires_at: string | null }
export type CdkRecord = LegacyProfileCdkRecord | ProfileCdkRecord | BalanceCdkRecord | LegacyItemCdkRecord | ItemCdkRecord

export function getCdkType(record: CdkRecord): CdkType {
  return record.cdk_type ?? 'profile'
}

export function getCdkBalanceAmount(record: CdkRecord): string | null {
  return getCdkType(record) === 'balance' && typeof record.balance_amount === 'string'
    ? record.balance_amount
    : null
}

export function getCdkItemCode(record: CdkRecord): ItemCdkCode | null {
  if (getCdkType(record) !== 'item') return null
  return record.item_code === 'lifetime_profile_voucher' || record.item_code === 'limited_profile_voucher'
    ? record.item_code
    : null
}

export function getCdkItemExpiresAt(record: CdkRecord): string | null {
  return getCdkType(record) === 'item' && typeof record.item_expires_at === 'string'
    ? record.item_expires_at
    : null
}

export function getCdkProfileDuration(record: CdkRecord): ProfileCdkDuration {
  if (!isProfileCdkRecord(record)) return 'lifetime'
  if (record.profile_duration === 'month' || record.profile_duration === 'half_year' || record.profile_duration === 'year') {
    return record.profile_duration
  }
  return 'lifetime'
}

export function getCdkProfileDurationDays(record: CdkRecord): number | null {
  const duration = getCdkProfileDuration(record)
  return duration === 'lifetime' ? null : PROFILE_CDK_DURATION_DAYS[duration]
}

export function getCdkProfileExpiresAt(record: CdkRecord): string | null {
  return isProfileCdkRecord(record) && typeof record.profile_expires_at === 'string'
    ? record.profile_expires_at
    : null
}

export function addProfileCdkDuration(now: string, duration: ProfileCdkDuration): string | null {
  if (duration === 'lifetime') return null
  const days = PROFILE_CDK_DURATION_DAYS[duration]
  return new Date(Date.parse(now) + days * 86_400_000).toISOString()
}

export function isProfileCdkRecord(record: CdkRecord): record is LegacyProfileCdkRecord | ProfileCdkRecord {
  return getCdkType(record) === 'profile'
}

export interface CdkRecordStore {
  get: (key: string) => Promise<CdkRecord | null>;
  create: (key: string, record: CdkRecord) => Promise<void>;
  createBatch: (entries: Array<{ key: string; record: CdkRecord }>) => Promise<void>;
  mutate: (
    key: string,
    mutate: (current: CdkRecord) => CdkRecord | null,
    options?: { allowedStatuses?: CdkStatus[] },
  ) => Promise<CdkRecord | null>;
  incrementScheduleGenerateCount: (key: string, jobId?: string) => Promise<boolean>;
  deleteUnused: (key: string) => Promise<boolean>;
  list: (prefix: string) => Promise<CdkRecord[]>;
  listAdminPage?: (options: AdminCdkPageOptions) => Promise<AdminCdkPageResult>;
}

export interface AdminCdkPageOptions {
  page: number;
  pageSize: number;
  search: string;
  status: CdkStatus | 'all';
  permission: ProductPermissionMode | 'all';
  cdkType: CdkType | 'all';
  risk: 'all' | 'yes' | 'no';
  generated: 'all' | 'yes' | 'no';
  riskOnly?: boolean;
}

export interface AdminCdkPageResult {
  records: CdkRecord[];
  total: number;
  page: number;
  totalPages: number;
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

export async function saveRiskControlSettings(input: {
  patch: RiskControlSettingsPatch
  expectedRevision: number
  adminUsername: string
  reason: string
  requestId: string
}): Promise<RiskControlSettings> {
  const store = getRiskControlSettingsStore()
  return store.set(input)
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
  const value = readOptionalEnv(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name] || readLocalEnv(name)
  const normalized = value?.trim()
  return normalized || undefined
}

export function getSecretKeyring(name: string): string[] {
  const active = requireEnv(name)
  const previous = readOptionalEnv(`${name}_PREVIOUS`)
  return previous && previous !== active ? [active, previous] : [active]
}

function getCdkHashSecretKeyring(): string[] {
  return getSecretKeyring('CDK_HASH_SECRET')
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

export function normalizePermissionMode(permission?: RawPermissionMode): PermissionMode {
  return normalizeRuntimePermission(permission)
}

export function getPermissionMode(license: LicenseFile): PermissionMode {
  return normalizePermissionMode(license.permission)
}

export function canUseUpgradeFeatures(license: LicenseFile): boolean {
  return hasCapability({ permission: license.permission }, 'view_upgrade_suggestions')
}

function canEditConfigForPermission(permission: PermissionMode): boolean {
  return hasCapability({ permission }, 'edit_full_config')
}

function isIntermediateAutoConfig(config: LicenseConfig | null | undefined): boolean {
  return config?.auto_balance_source === 'intermediate_inventory' || config?.auto_balance_source === 'limited_config'
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

export interface CdkCodeMatch {
  record: CdkRecord;
  codeHash: string;
  key: string;
}

export function getFreePreviewDefaultConfig(): LicenseConfig {
  return cloneConfig(PRESET_CONFIGS[0])
}

export async function findCdkRecordByCode(code: string, hashSecrets = getCdkHashSecretKeyring()): Promise<CdkCodeMatch | null> {
  const store = await getCdkRecordStore()
  for (const hashSecret of hashSecrets) {
    const codeHash = hashCdk(normalizeCode(code), hashSecret)
    const key = `cdk/${codeHash}.json`
    const record = await store.get(key)
    if (record) return { record, codeHash, key }
  }
  return null
}

export async function incrementCdkScheduleGenerateCount(record: Pick<CdkRecord, 'code_hash'>, jobId?: string): Promise<boolean> {
  const store = await getCdkRecordStore()
  return store.incrementScheduleGenerateCount(`cdk/${record.code_hash}.json`, jobId)
}

const SOFT_BLOCK_WINDOW_MS = productPolicies.risk.soft_block_window_hours * 60 * 60 * 1000
const OPERATOR_ANOMALY_EVENTS_BEFORE_REVIEW = productPolicies.risk.operator_anomaly_events_before_review
const OPERATOR_RISK_DEDUP_WINDOW_MS = 5 * 60 * 1000

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
  return `本次操作已拦截：${reason} 这通常是误选了其他账号或不兼容的 operators.json，请确认文件后重新上传。`
}

export async function recordOperatorFingerprint(
  record: CdkRecord,
  fingerprint: OperatorFingerprint,
): Promise<CdkRecord> {
  const store = await getCdkRecordStore()
  return (await store.mutate(`cdk/${record.code_hash}.json`, (current) => {
    const baseline = current.baseline_operator_fingerprint ?? fingerprint
    if (
      current.baseline_operator_fingerprint?.hash === baseline.hash
      && current.latest_operator_fingerprint?.hash === fingerprint.hash
    ) return current
    return {
      ...current,
      baseline_operator_fingerprint: baseline,
      latest_operator_fingerprint: fingerprint,
    }
  }, { allowedStatuses: ['used'] })) ?? record
}

export async function recordSoftBlockedRiskEvent(
  record: CdkRecord,
  event: RiskEvent,
  message: string,
  fingerprint: OperatorFingerprint,
): Promise<
  | { frozen: false; reviewRecommended: boolean; record: CdkRecord; message: string }
  | { frozen: true; reviewRecommended: boolean; record: CdkRecord; message: string }
> {
  const now = event.at || new Date().toISOString()
  const softEvent: RiskEvent = {
    ...event,
    at: now,
    detail: {
      ...(event.detail ?? {}),
      soft_block: true,
      fingerprint_hash: fingerprint.hash,
      owned_count: fingerprint.owned_count,
    },
  }
  const store = await getCdkRecordStore()
  let reviewRecommended = false
  const updated = await store.mutate(`cdk/${record.code_hash}.json`, (current) => {
    const existingEvents = current.risk_events ?? []
    const nowMs = Date.parse(now)
    const duplicate = existingEvents.some((item) => (
      item.type === event.type
      && item.detail?.fingerprint_hash === fingerprint.hash
      && Number.isFinite(Date.parse(item.at))
      && Math.abs(nowMs - Date.parse(item.at)) < OPERATOR_RISK_DEDUP_WINDOW_MS
    ))
    let riskEvents = duplicate ? existingEvents : [...existingEvents, softEvent].slice(-20)
    const cutoff = Date.parse(now) - SOFT_BLOCK_WINDOW_MS
    const recentAnomalies = riskEvents.filter((item) => {
      const at = Date.parse(item.at)
      return Number.isFinite(at) && at > cutoff && item.detail?.soft_block === true
    })
    const recentFingerprints = new Set(recentAnomalies.flatMap((item) => {
      const fingerprintHash = item.detail?.fingerprint_hash
      return typeof fingerprintHash === 'string' ? [fingerprintHash] : []
    }))
    reviewRecommended = recentAnomalies.length >= OPERATOR_ANOMALY_EVENTS_BEFORE_REVIEW && recentFingerprints.size >= 2
    const recommendationExists = riskEvents.some((item) => (
      item.type === 'operator_review_recommended'
      && Number.isFinite(Date.parse(item.at))
      && Date.parse(item.at) > cutoff
    ))
    if (reviewRecommended && !recommendationExists) {
      riskEvents = [...riskEvents, {
        at: now,
        type: 'operator_review_recommended',
        reason: `24 小时内检测到 ${recentAnomalies.length} 次异常干员提交，涉及 ${recentFingerprints.size} 份不同快照，已进入人工复核。`,
        detail: {
          reviewed: false,
          anomaly_event_count: recentAnomalies.length,
          distinct_fingerprint_count: recentFingerprints.size,
          latest_block_type: event.type,
        },
      }].slice(-20)
    }
    return {
      ...current,
      latest_operator_fingerprint: fingerprint,
      risk_events: riskEvents,
    }
  }, { allowedStatuses: ['used'] })
  if (!updated || updated.status === 'revoked') {
    return { frozen: true, reviewRecommended, record: updated ?? record, message: updated?.freeze_reason || '授权已撤销。' }
  }
  if (updated.status === 'frozen') {
    return { frozen: true, reviewRecommended, record: updated, message: updated.freeze_reason || formatRiskFreezeMessage(event.reason) }
  }
  return {
    frozen: false,
    reviewRecommended,
    record: updated,
    message,
  }
}

export async function unfreezeCdkRecord(record: CdkRecord): Promise<CdkRecord> {
  const store = await getCdkRecordStore()
  return (await store.mutate(`cdk/${record.code_hash}.json`, (current) => ({
    ...current,
    status: 'used',
    frozen_at: null,
    freeze_reason: null,
  }), { allowedStatuses: ['frozen'] })) ?? record
}

export async function setOperatorBaselineByAdmin(
  record: CdkRecord,
  options: AdminOperatorBaselineOptions,
): Promise<CdkRecord | null> {
  if (options.source === 'latest' && !record.latest_operator_fingerprint) return null
  if (options.source === 'workspace' && !options.fingerprint) return null
  const at = new Date().toISOString()
  const store = await getCdkRecordStore()
  let sourceUnavailable = false
  const updated = await store.mutate(`cdk/${record.code_hash}.json`, (current) => {
    const previousBaseline = current.baseline_operator_fingerprint
    const previousLatest = current.latest_operator_fingerprint
    const selected = options.source === 'latest'
      ? current.latest_operator_fingerprint
      : options.source === 'workspace'
        ? options.fingerprint
        : null
    if (options.source !== 'next_import' && !selected) {
      sourceUnavailable = true
      return current
    }

    const next: CdkRecord = { ...current }
    if (selected) {
      next.baseline_operator_fingerprint = selected
      next.latest_operator_fingerprint = selected
    } else {
      delete next.baseline_operator_fingerprint
      delete next.latest_operator_fingerprint
    }
    if (options.unfreeze) {
      next.status = 'used'
      next.frozen_at = null
      next.freeze_reason = null
    }
    next.risk_events = [...(current.risk_events ?? []), {
      at,
      type: options.eventType ?? 'admin_operator_baseline_changed',
      reason: options.reason,
      detail: {
        reviewed: options.reviewed ?? true,
        source: options.source,
        previous_baseline_hash: previousBaseline?.hash ?? null,
        previous_baseline_owned_count: previousBaseline?.owned_count ?? null,
        previous_latest_hash: previousLatest?.hash ?? null,
        previous_latest_owned_count: previousLatest?.owned_count ?? null,
        selected_fingerprint_hash: selected?.hash ?? null,
        selected_owned_count: selected?.owned_count ?? null,
      },
    }].slice(-20)
    return next
  }, { allowedStatuses: ['used', 'frozen'] })
  if (sourceUnavailable || !updated || (updated.status !== 'used' && updated.status !== 'frozen')) return null
  return updated
}

export async function acceptLatestOperatorBaselineAndUnfreeze(record: CdkRecord, reason: string): Promise<CdkRecord | null> {
  return setOperatorBaselineByAdmin(record, {
    source: 'latest',
    reason,
    unfreeze: true,
  })
}

export function validateOperators(value: unknown): { ok: true; operators: LicenseOperator[] } | { ok: false; message: string } {
  const parsed = licenseOperatorsSchema.safeParse(value)
  if (!parsed.success) return { ok: false, message: formatWorkspaceValidationMessage('干员数据', parsed.error.issues[0]?.message) }
  return { ok: true, operators: parsed.data }
}

export function validateConfig(value: unknown): { ok: true; config: LicenseConfig } | { ok: false; message: string } {
  const parsed = licenseConfigSchema.safeParse(value)
  if (!parsed.success) return { ok: false, message: formatWorkspaceValidationMessage('基建配置', parsed.error.issues[0]?.message) }
  const config: LicenseConfig = {
    ...parsed.data,
    dormitory_rule: normalizeDormitoryRule(parsed.data.dormitory_rule),
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

function formatWorkspaceValidationMessage(subject: string, detail: string | undefined): string {
  return detail ? `${subject}不正确：${detail}` : `${subject}不正确。`
}

function isCountRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every((item) => Number.isInteger(item) && item >= 0)
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

function normalizeDormitoryRule(rule: unknown): 'fixed' | 'maa_autofill' | 'maa_pure_autofill' {
  const ruleText = String(rule ?? 'fixed').trim().toLowerCase()
  if (['maa_pure_autofill', 'maa-pure-autofill', 'pure_autofill', 'pure-autofill', '纯maa自动填满', '纯自动填满'].includes(ruleText)) {
    return 'maa_pure_autofill'
  }
  return ['maa_autofill', 'maa-autofill', 'autofill', 'auto', 'maa自动填满', '自动填满'].includes(ruleText)
    ? 'maa_autofill'
    : 'fixed'
}
